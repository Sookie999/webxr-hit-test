export async function createWebGPUVideoTexture(THREE){
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512; canvas.style.display = "none";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("webgpu");
  if (!navigator.gpu || !ctx) throw new Error("WebGPU not available");
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied" });

  const shader = device.createShaderModule({ code: `
    @vertex
    fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
      var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
      );
      return vec4f(pos[vid], 0.0, 1.0);
    }
    @fragment
    fn fs(@builtin(position) p: vec4f, @builtin(time) t: f32) -> @location(0) vec4f {
      let uv = p.xy / vec2f(512.0, 512.0);
      let c = 0.5 + 0.5 * cos(vec3f(uv.xxy + vec3f(t*0.001, t*0.0015, t*0.002)));
      return vec4f(c, 1.0);
    }
  `});

  // Some browsers do not support @builtin(time). Use a uniform fallback.
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vs" },
    fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" }
  });

  function frame(){
    const encoder = device.createCommandEncoder();
    const view = ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r:0, g:0, b:0, a:1 } }]
    });
    pass.setPipeline(pipeline);
    pass.draw(3,1,0,0);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.srcObject = stream;
  await video.play().catch(()=>{});

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
