const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const btn = document.getElementById('start-ar');
function log(...a){ logEl.textContent += a.join(' ') + '\n'; }

async function start(){
  try {
    if (!('xr' in navigator)) { log('WebXR unsupported'); return; }
    if (!('gpu' in navigator)) { log('WebGPU unsupported'); return; }

    const arOk = await navigator.xr.isSessionSupported('immersive-ar');
    if (!arOk) { log('immersive-ar not supported'); return; }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { log('No GPU adapter'); return; }
    const device = await adapter.requestDevice();
    log('GPU device acquired');

    // Require webgpu+layers to maximize chances of primary layer exposure; add hit-test/anchors optionally
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures:['webgpu','layers'], optionalFeatures:['hit-test','anchors'] });
      statusEl.textContent = 'Status: AR session started (webgpu+layers)';
    } catch (e) {
      log('requestSession failed:', e.message || e);
      return;
    }

    // Do not explicitly create a WebXR+WebGPU layer. Rely on UA-provided implicit primary layer
    const getPrimaryLayer = () => {
      const ls = session.renderState && session.renderState.layers;
      return (ls && ls.length > 0) ? ls[0] : null;
    };
    let layer = getPrimaryLayer();
    if (!layer) {
      log('No implicit XRWebGPU layer yet; will retry inside frame loop');
      statusEl.textContent = 'Status: waiting implicit WebGPU layer';
    }

    // Hit-test setup
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitSource = await session.requestHitTestSource({ space: viewerSpace }).catch(()=>null);
    const refSpace = await session.requestReferenceSpace('local');
    const anchors = [];
    let pendingHitForAnchor = null;
    session.addEventListener('select', async () => {
      if (pendingHitForAnchor && pendingHitForAnchor.createAnchor) {
        try {
          const a = await pendingHitForAnchor.createAnchor(refSpace);
          if (a) anchors.push(a);
        } catch {}
      }
    });

    // Pipelines: ring (fullscreen) + triangle (overlay at center)
    const format = navigator.gpu.getPreferredCanvasFormat();
    const ringShader = device.createShaderModule({ code: `
      struct Uniforms { center: vec2f, pad: vec2f };
      @group(0) @binding(0) var<uniform> u: Uniforms;
      @vertex fn vs(@builtin(vertex_index) vid:u32) -> @builtin(position) vec4f {
        var pos = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
        return vec4f(pos[vid], 0.0, 1.0);
      }
      @fragment fn fs(@builtin(position) p:vec4f) -> @location(0) vec4f {
        let res = vec2f(1.0,1.0);
        let uv = p.xy / res;
        let c = u.center; // 0..1
        let d = distance(uv, c);
        let ring = smoothstep(0.01, 0.0, abs(d-0.08));
        return vec4f(0.0,1.0,0.6, ring);
      }
    `});
    const triShader = device.createShaderModule({ code: `
      struct Uniforms { center: vec2f, pad: vec2f };
      @group(0) @binding(0) var<uniform> u: Uniforms;
      @vertex fn vs(@builtin(vertex_index) vid:u32) -> @builtin(position) vec4f {
        // small triangle around center in clip space
        let c = vec2f(u.center*2.0 - vec2f(1.0));
        var verts = array<vec2f,3>(vec2f(-0.05,-0.05), vec2f(0.06,-0.05), vec2f(-0.05,0.08));
        let v = verts[vid] + c;
        return vec4f(v, 0.0, 1.0);
      }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(1.0,0.8,0.2,1.0); }
    `});
    const uBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindLayout = device.createBindGroupLayout({ entries:[{ binding:0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer:{} }]});
    const ringPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts:[bindLayout] }),
      vertex:{ module: ringShader, entryPoint:'vs' },
      fragment:{ module: ringShader, entryPoint:'fs', targets:[{ format, blend:{ color:{ srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha' }, alpha:{ srcFactor:'one', dstFactor:'one-minus-src-alpha' } } }] },
      primitive:{ topology:'triangle-list' }
    });
    const triPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts:[bindLayout] }),
      vertex:{ module: triShader, entryPoint:'vs' },
      fragment:{ module: triShader, entryPoint:'fs', targets:[{ format }] },
      primitive:{ topology:'triangle-list' }
    });
    const bindGroup = device.createBindGroup({ layout: bindLayout, entries:[{ binding:0, resource:{ buffer: uBuf } }]});

    function projectToUV(hitPoseMat, view){
      // Compute NDC from hit pose for this view
      // matrices are column-major Float32Array length 16
      function matMul(a,b){
        var o = new Float32Array(16);
        for (var i=0;i<4;i++) for (var j=0;j<4;j++){ o[j*4+i]= a[i]*b[j*4] + a[i+4]*b[j*4+1] + a[i+8]*b[j*4+2] + a[i+12]*b[j*4+3]; }
        return o;
      }
      function matInv(m){
        // minimal inverse via gl-matrix-like (not robust, but OK for view)
        const a = m; const inv = new Float32Array(16);
        const b00 = a[0]*a[5]-a[1]*a[4]; const b01 = a[0]*a[6]-a[2]*a[4]; const b02 = a[0]*a[7]-a[3]*a[4];
        const b03 = a[1]*a[6]-a[2]*a[5]; const b04 = a[1]*a[7]-a[3]*a[5]; const b05 = a[2]*a[7]-a[3]*a[6];
        const b06 = a[8]*a[13]-a[9]*a[12]; const b07 = a[8]*a[14]-a[10]*a[12]; const b08 = a[8]*a[15]-a[11]*a[12];
        const b09 = a[9]*a[14]-a[10]*a[13]; const b10 = a[9]*a[15]-a[11]*a[13]; const b11 = a[10]*a[15]-a[11]*a[14];
        let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06; if (!det) return null; det = 1.0/det;
        inv[0] = ( a[5]*b11 - a[6]*b10 + a[7]*b09)*det;
        inv[1] = (-a[1]*b11 + a[2]*b10 - a[3]*b09)*det;
        inv[2] = ( a[13]*b05 - a[14]*b04 + a[15]*b03)*det;
        inv[3] = (-a[9]*b05 + a[10]*b04 - a[11]*b03)*det;
        inv[4] = (-a[4]*b11 + a[6]*b08 - a[7]*b07)*det;
        inv[5] = ( a[0]*b11 - a[2]*b08 + a[3]*b07)*det;
        inv[6] = (-a[12]*b05 + a[14]*b02 - a[15]*b01)*det;
        inv[7] = ( a[8]*b05 - a[10]*b02 + a[11]*b01)*det;
        inv[8] = ( a[4]*b10 - a[5]*b08 + a[7]*b06)*det;
        inv[9] = (-a[0]*b10 + a[1]*b08 - a[3]*b06)*det;
        inv[10]= ( a[12]*b04 - a[13]*b02 + a[15]*b00)*det;
        inv[11]= (-a[8]*b04 + a[9]*b02 - a[11]*b00)*det;
        inv[12]= (-a[4]*b09 + a[5]*b07 - a[6]*b06)*det;
        inv[13]= ( a[0]*b09 - a[1]*b07 + a[2]*b06)*det;
        inv[14]= (-a[12]*b03 + a[13]*b01 - a[14]*b00)*det;
        inv[15]= ( a[8]*b03 - a[9]*b01 + a[10]*b00)*det;
        return inv;
      }
      const viewInv = matInv(view.transform.matrix);
      if (!viewInv) return null;
      const vp = matMul(view.projectionMatrix, viewInv);
      const p = new Float32Array([hitPoseMat[12], hitPoseMat[13], hitPoseMat[14], 1.0]);
      const x = vp[0]*p[0]+vp[4]*p[1]+vp[8]*p[2]+vp[12]*p[3];
      const y = vp[1]*p[0]+vp[5]*p[1]+vp[9]*p[2]+vp[13]*p[3];
      const w = vp[3]*p[0]+vp[7]*p[1]+vp[11]*p[2]+vp[15]*p[3];
      if (w === 0.0) return null;
      const ndc = [x/w, y/w];
      return [0.5*ndc[0]+0.5, 0.5*-ndc[1]+0.5];
    }

    const render = (t, frame) => {
      const pose = frame.getViewerPose(refSpace);
      if (!pose) { session.requestAnimationFrame(render); return; }
      try {
        if (!layer) {
          // Try to pick up implicit primary layer
          layer = getPrimaryLayer();
          if (!layer) {
            // As a fallback, if constructors are exposed, create a layer and set renderState.layers
            const Ctor = globalThis.XRWebGPUTieredLayer || globalThis.XRWebGPULayer;
            if (Ctor) {
              try {
                layer = new Ctor(session, device);
                if (layer) {
                  await session.updateRenderState({ layers: [layer] });
                }
              } catch {}
            }
          }
          if (layer) statusEl.textContent = 'Status: implicit WebGPU layer acquired';
        }
        if (layer && (layer.getViewSubImage || layer.getViewTexture)) {
          const encoder = device.createCommandEncoder();
          for (const view of pose.views) {
            let colorView;
            // Official sample style uses getViewSubImage(view)
            if (typeof layer.getViewSubImage === 'function') {
              const sub = layer.getViewSubImage(view);
              if (!sub || !sub.colorTexture) continue;
              colorView = sub.colorTexture.createView();
            } else if (typeof layer.getViewTexture === 'function') {
              const tex = layer.getViewTexture(view);
              if (!tex) continue;
              colorView = tex.createView();
            } else {
              continue;
            }
            // Hit-test center (per view, use first hit)
            let center = null;
            if (hitSource) {
              const hits = frame.getHitTestResults(hitSource);
              if (hits.length > 0) {
                const hitPose = hits[0].getPose(refSpace);
                if (hitPose) center = projectToUV(hitPose.transform.matrix, view);
                pendingHitForAnchor = hits[0];
              }
            }
            // Default center if none
            const c = center || [0.5, 0.6];
            const data = new Float32Array([c[0], c[1], 0, 0]);
            device.queue.writeBuffer(uBuf, 0, data.buffer, 0, data.byteLength);

            const pass = encoder.beginRenderPass({
              colorAttachments: [{ view: colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
            });
            // ring
            pass.setPipeline(ringPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            // triangle
            pass.setPipeline(triPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            // render anchored triangles
            if (anchors.length > 0) {
              for (const a of anchors) {
                const as = a.anchorSpace || a; // UA differences
                const ap = frame.getPose(as, refSpace);
                if (!ap) continue;
                const uv = projectToUV(ap.transform.matrix, view);
                if (!uv) continue;
                const d2 = new Float32Array([uv[0], uv[1], 0, 0]);
                device.queue.writeBuffer(uBuf, 0, d2.buffer, 0, d2.byteLength);
                pass.setPipeline(triPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
              }
            }
            pass.end();
          }
          device.queue.submit([encoder.finish()]);
        }
      } catch (e) {
        // likely unsupported in this build
      }
      session.requestAnimationFrame(render);
    };
    session.requestAnimationFrame(render);

  } catch (e) {
    log('Error:', e.message || e);
  }
}

btn.addEventListener('click', start);
