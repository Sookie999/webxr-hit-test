 // Because we are not using the 'secondary-views' feature we can be sure
      // that WebXR will never provide more than two views.
      const MAX_VIEWS = 2;
      // We have two matrices per view, which is only 32 floats, but we're going
      // to allocate 64 of them because uniform buffers bindings must be aligned
      // to 256-bytes.
      const UNIFORM_FLOATS_PER_VIEW = 64;

      // A simple shader that draws a single triangle
      const SHADER_SRC = `
        struct Camera {
          projection: mat4x4f,
          view: mat4x4f,
        }
        @group(0) @binding(0) var<uniform> camera: Camera;

        struct VertexOut {
          @builtin(position) pos: vec4f,
          @location(0) color: vec4f,
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) vert_index: u32,
                      @builtin(instance_index) instance: u32) -> VertexOut {
          var pos = array<vec4f, 3>(
            vec4f(0.0, 0.25, -0.5, 1),
            vec4f(-0.25, -0.25, -0.5, 1),
            vec4f(0.25, -0.25, -0.5, 1)
          );

          var color = array<vec4f, 3>(
            vec4f(1, 0, 0, 1),
            vec4f(0, 1, 0, 1),
            vec4f(0, 0, 1, 1)
          );

          // Give each instance a small offset to help with the sense of depth.
          let instancePos = pos[vert_index] + vec4f(0, 0, f32(instance) * -0.1, 0);
          let posOut = camera.projection * camera.view * instancePos;

          return VertexOut(posOut, color[vert_index]);
        }

        @fragment
        fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
          return in.color;
        }
      `;

      // XR globals.
      let xrButton = document.getElementById('xr-button');
      let xrSession = null;
      let xrRefSpace = null;

      // WebGPU scene globals.
      let gpuDevice = null;
      let gpuContext = null;
      let gpuUniformBuffer = null;
      let gpuUniformArray = new Float32Array(UNIFORM_FLOATS_PER_VIEW * MAX_VIEWS);
      let gpuBindGroupLayout = null;
      let gpuBindGroups = [];
      let gpuModule = null;
      let gpuPipeline = null;
      let gpuDepthTexture = null;
      let colorFormat = null;
      let depthStencilFormat = 'depth24plus';

      // Overlay (clip-space) pipeline for reticle/anchors
      let overlayPipeline = null;
      let overlayLayout = null;
      let overlayBuf = null;


      // WebXR/WebGPU interop globals.
      let xrGpuBinding = null;
      let projectionLayer = null;
      let viewerSpace = null;
      let hitSource = null;
      const anchors = [];
      let lastHit = null;

      // Generate a projection matrix, borrowed from gl-matrix.
      function perspectiveZO(out, fovy, aspect, near, far = Infinity) {
        const f = 1.0 / Math.tan(fovy / 2);
        out[0] = f / aspect;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[5] = f;
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[11] = -1;
        out[12] = 0;
        out[13] = 0;
        out[15] = 0;
        if (far != null && far !== Infinity) {
          const nf = 1 / (near - far);
          out[10] = far * nf;
          out[14] = far * near * nf;
        } else {
          out[10] = -1;
          out[14] = -near;
        }
        return out;
      }

      // Checks to see if WebXR and WebGPU is available and, if so, requests an
      // tests to ensure it supports the desired session type.
      async function initXR() {
        // Is WebXR, WebGPU, and WebXR/WebGPU interop available on this UA?
        if (!navigator.xr) {
          xrButton.textContent = 'WebXR not supported';
          return;
        }

        if (!navigator.gpu) {
          xrButton.textContent = 'WebGPU not supported';
          return;
        }

        if (!('XRGPUBinding' in window)) {
          xrButton.textContent = 'WebXR/WebGPU interop not supported';
          return;
        }

        // If the UA allows creation of immersive AR sessions enable the
        // target of the 'Enter XR' button.
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!supported) {
          xrButton.textContent = 'Immersive AR not supported';
          return;
        }

        // Updates the button to start an XR session when clicked.
        xrButton.addEventListener('click', onButtonClicked);
        xrButton.textContent = 'Enter AR';
        xrButton.disabled = false;

        await initWebGPU();
        requestAnimationFrame(onFrame);
      }

      // Initializes WebGPU resources
      async function initWebGPU() {
        if (!gpuDevice) {
          // Create a WebGPU adapter and device to render with, initialized to be
          // compatible with the XRDisplay we're presenting to. Note that a canvas
          // is not necessary if we are only rendering to the XR device.
          const adapter = await navigator.gpu.requestAdapter({
            xrCompatible: true
          });
          gpuDevice = await adapter.requestDevice();
          colorFormat = navigator.gpu.getPreferredCanvasFormat();

          gpuContext = webgpu_canvas.getContext('webgpu');
          gpuContext.configure({
            format: colorFormat,
            device: gpuDevice,
          });

          // A depth texture to use when not in an immersive session.
          gpuDepthTexture = gpuDevice.createTexture({
            size: { width: webgpu_canvas.width, height: webgpu_canvas.height },
            format: depthStencilFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });

          // Allocate a uniform buffer with enough space for two uniforms per-view
          gpuUniformBuffer = gpuDevice.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT * UNIFORM_FLOATS_PER_VIEW * MAX_VIEWS,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });

          // Set the uniform buffer to contain valid matrices initially so
          // that we can see something.
          let mat = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
          ];
          gpuUniformArray.set(mat, 16);

          perspectiveZO(mat, Math.PI * 0.5, webgpu_canvas.offsetWidth / webgpu_canvas.offsetHeight, 0.1);
          gpuUniformArray.set(mat, 0);

          gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, gpuUniformArray);

          // Create a bind group layout for the uniforms
          gpuBindGroupLayout = gpuDevice.createBindGroupLayout({
            entries: [{
              binding: 0,
              visibility: GPUShaderStage.VERTEX,
              buffer: {},
            }]
          });

          // Create a bind group for each potential view
          for (let i = 0; i < MAX_VIEWS; ++i) {
            gpuBindGroups.push(gpuDevice.createBindGroup({
              layout: gpuBindGroupLayout,
              entries: [{
                binding: 0,
                resource: {
                  buffer: gpuUniformBuffer,
                  offset: Float32Array.BYTES_PER_ELEMENT * UNIFORM_FLOATS_PER_VIEW * i
                }
              }]
            }));
          }

          gpuModule = gpuDevice.createShaderModule({ code: SHADER_SRC });
        }

        gpuPipeline = gpuDevice.createRenderPipeline({
          layout: gpuDevice.createPipelineLayout({ bindGroupLayouts: [ gpuBindGroupLayout ]}),
          vertex: {
            module: gpuModule,
            entryPoint: 'vertexMain',
          },
          depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true,
            depthCompare: 'less-equal',
          },
          fragment: {
            module: gpuModule,
            entryPoint: 'fragmentMain',
            targets: [{
              format: colorFormat,
            }]
          }
        });

        // Create overlay pipeline (clip-space triangle)
        if (!overlayPipeline) {
          const overlayShader = gpuDevice.createShaderModule({ code: `
            struct Overlay { center: vec2f, size: vec2f };
            @group(0) @binding(0) var<uniform> u: Overlay;
            struct VOut { @builtin(position) pos: vec4f };
            @vertex fn vs(@builtin(vertex_index) i:u32)->VOut {
              var offs = array<vec2f,3>(
                vec2f(0.0, 1.0), vec2f(-0.866, -0.5), vec2f(0.866, -0.5)
              );
              let p = (offs[i] * u.size) + u.center;
              return VOut(vec4f(p, 0.0, 1.0));
            }
            @fragment fn fs()->@location(0) vec4f { return vec4f(0.0,1.0,0.6,1.0); }
          `});
          overlayLayout = gpuDevice.createBindGroupLayout({
            entries:[{ binding:0, visibility: GPUShaderStage.VERTEX, buffer:{} }]
          });
          overlayPipeline = gpuDevice.createRenderPipeline({
            layout: gpuDevice.createPipelineLayout({ bindGroupLayouts:[ overlayLayout ]}),
            vertex:{ module: overlayShader, entryPoint: 'vs' },
            fragment:{ module: overlayShader, entryPoint: 'fs', targets:[{ format: colorFormat }] }
          });
          overlayBuf = gpuDevice.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        }
      }

      // Called when the user clicks the button to enter XR. If we don't have a
      // session we'll request one, and if we do have a session we'll end it.
      async function onButtonClicked() {
        if (!xrSession) {
          navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['webgpu','layers'],
            optionalFeatures: ['hit-test','anchors']
          }).then(onSessionStarted);
        } else {
          xrSession.end();
        }
      }

      // Called when we've successfully acquired a XRSession. In response we
      // will set up the necessary session state and kick off the frame loop.
      async function onSessionStarted(session) {
        xrSession = session;
        xrButton.textContent = 'Exit AR';

        // Listen for the sessions 'end' event so we can respond if the user
        // or UA ends the session for any reason.
        session.addEventListener('end', onSessionEnded);

        // Create the WebXR/WebGPU binding, and with it create a projection
        // layer to render to.
        xrGpuBinding = new XRGPUBinding(xrSession, gpuDevice);

        // If the preferred color format doesn't match what we've been rendering
        // with so far, rebuild the pipeline
        if (colorFormat != xrGpuBinding.getPreferredColorFormat()) {
          colorFormat = xrGpuBinding.getPreferredColorFormat();
          await initWebGPU();
        }

        projectionLayer = xrGpuBinding.createProjectionLayer({
          colorFormat,
          depthStencilFormat,
        });

        // Set the session's layers to display the projection layer. This allows
        // any content rendered to the layer to be displayed on the XR device.
        session.updateRenderState({ layers: [projectionLayer] });

        // Get a reference space, which is required for querying poses. In this
        // case an 'local' reference space means that all poses will be relative
        // to the location where the XR device was first detected.
        session.requestReferenceSpace('local').then(async (refSpace) => {
          xrRefSpace = refSpace;

          // Setup hit-test (viewer space)
          try {
            viewerSpace = await xrSession.requestReferenceSpace('viewer');
            hitSource = await xrSession.requestHitTestSource({ space: viewerSpace });
          } catch {}

          // Tap to create anchors at last hit
          xrSession.addEventListener('select', async () => {
            if (lastHit && lastHit.createAnchor) {
              try {
                const a = await lastHit.createAnchor(xrRefSpace);
                if (a) anchors.push(a);
              } catch {}
            }
          });

          // Inform the session that we're ready to begin drawing.
          session.requestAnimationFrame(onXRFrame);
        });
      }

      // Called either when the user has explicitly ended the session by calling
      // session.end() or when the UA has ended the session for any reason.
      // At this point the session object is no longer usable and should be
      // discarded.
      async function onSessionEnded(event) {
        xrSession = null;
        xrGpuBinding = null;
        xrButton.textContent = 'Enter AR';

        // If the canvas color format is different than the XR one, rebuild the
        // pipeline again upon switching back.
        if (colorFormat != navigator.gpu.getPreferredCanvasFormat()) {
          colorFormat = navigator.gpu.getPreferredCanvasFormat();
          await initWebGPU();
        }

        requestAnimationFrame(onFrame);
      }

      // Called every time the XRSession requests that a new frame be drawn.
      function onXRFrame(time, frame) {
        let session = frame.session;

        // Inform the session that we're ready for the next frame.
        session.requestAnimationFrame(onXRFrame);

        // Get the XRDevice pose relative to the reference space we created
        // earlier.
        let pose = frame.getViewerPose(xrRefSpace);

        // Getting the pose may fail if, for example, tracking is lost. So we
        // have to check to make sure that we got a valid pose before attempting
        // to render with it. If not in this case we'll just leave the
        // framebuffer cleared, so tracking loss means the scene will simply
        // disappear.
        if (pose) {

          // If we do have a valid pose, begin recording GPU commands.
          const commandEncoder = gpuDevice.createCommandEncoder();

          // First loop through each view and write it's projection and view
          // matrices into the uniform buffer.
          for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
            const view = pose.views[viewIndex];
            const offset = UNIFORM_FLOATS_PER_VIEW * viewIndex;
            gpuUniformArray.set(view.projectionMatrix, offset);
            gpuUniformArray.set(view.transform.inverse.matrix, offset + 16);
          }
          gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, gpuUniformArray);

          // Now loop through each of the views and draw into the corresponding
          // sub image of the projection layer.
          for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
            const view = pose.views[viewIndex];
            let subImage = xrGpuBinding.getViewSubImage(projectionLayer, view);

            // Start a render pass which uses the textures of the view's sub
            // image as render targets.
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                  view: subImage.colorTexture.createView(subImage.getViewDescriptor()),
                  // Clear the color texture to a solid color.
                  loadOp: 'clear',
                  storeOp: 'store',
                  // Clear the canvas to transparent black so the user's environment
                  // shows through.
                  clearValue: [0.0, 0.0, 0.0, 0.0],
                }],
                depthStencilAttachment: {
                  view: subImage.depthStencilTexture.createView(subImage.getViewDescriptor()),
                  // Clear the depth texture
                  depthLoadOp: 'clear',
                  depthStoreOp: 'store',
                  depthClearValue: 1.0,
                }
              });

            let vp = subImage.viewport;
            renderPass.setViewport(vp.x, vp.y, vp.width, vp.height, 0.0, 1.0);

            drawScene(renderPass, viewIndex);

            // Overlay reticle at latest hit pose (project to clip space)
            // Compute PV = projection * inverseView
            const invView = view.transform.inverse.matrix;
            const proj = view.projectionMatrix;
            const mulMat = (a,b)=>{
              const o=new Float32Array(16);
              for(let r=0;r<4;r++) for(let c=0;c<4;c++) o[c*4+r]=a[r]*b[c*4]+a[r+4]*b[c*4+1]+a[r+8]*b[c*4+2]+a[r+12]*b[c*4+3];
              return o;
            };
            const mulVec = (m,v)=>{
              const x=m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3];
              const y=m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3];
              const w=m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3];
              return [x,y,w];
            };
            const PV = mulMat(proj, invView);

            // Update lastHit
            if (hitSource && frame.getHitTestResults) {
              const hits = frame.getHitTestResults(hitSource);
              if (hits.length>0) lastHit = hits[0];
            }

            const drawOverlayAt = (position)=>{
              const p4 = new Float32Array([position.x, position.y, position.z, 1]);
              const [cx, cy, cw] = mulVec(PV, p4);
              if (!cw) return;
              const ndcX = cx/cw, ndcY = cy/cw;
              const ov = new Float32Array([ndcX, ndcY, 0.03, 0.03]);
              gpuDevice.queue.writeBuffer(overlayBuf, 0, ov.buffer);
              const bg = gpuDevice.createBindGroup({ layout: overlayLayout, entries:[{ binding:0, resource:{ buffer: overlayBuf }}]});
              renderPass.setPipeline(overlayPipeline);
              renderPass.setBindGroup(0, bg);
              renderPass.draw(3);
            };

            // Reticle at last hit
            if (lastHit) {
              const hp = lastHit.getPose(xrRefSpace);
              if (hp) drawOverlayAt(hp.transform.position);
            }

            // Anchors
            for (const a of anchors) {
              const as = a.anchorSpace || a;
              const ap = frame.getPose(as, xrRefSpace);
              if (ap) drawOverlayAt(ap.transform.position);
            }

            renderPass.end();
          }

          // Submit the rendering commands to the GPU.
          gpuDevice.queue.submit([commandEncoder.finish()]);
        }
      }

      // Does a standard render to the canvas
      function onFrame(time) {
        // If a session has started since the last frame don't request a new one.
        if (!xrSession) {
          requestAnimationFrame(onFrame);
        }

        const commandEncoder = gpuDevice.createCommandEncoder();

        // Start a render pass which uses the textures of the view's sub
        // image as render targets.
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: gpuContext.getCurrentTexture().createView(),
            // Clear the color texture to a solid color.
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0.1, 0.1, 0.4, 1.0],
          }],
          depthStencilAttachment: {
            view: gpuDepthTexture.createView(),
            // Clear the depth texture
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
          }
        });

        drawScene(renderPass);

        renderPass.end();

        // Submit the rendering commands to the GPU.
        gpuDevice.queue.submit([commandEncoder.finish()]);
      }

      function drawScene(renderPass, viewIndex = 0) {
        // Renders the scene using the uniforms saved for view[viewIndex], which
        // are accessible in gpuBindGroups[viewIndex].
        renderPass.setPipeline(gpuPipeline);
        renderPass.setBindGroup(0, gpuBindGroups[viewIndex]);
        // Draw 5 instances of the triangle so that our scene has some depth
        renderPass.draw(3, 5);
      }

      // Start the XR application.
      initXR();