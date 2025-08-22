const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
function log(...a){ logEl.textContent += a.join(" ") + "\n"; }

async function start(mode = 'immersive-ar'){
  try{
    if(!navigator.xr){ log("WebXR unsupported"); return; }
    if(!navigator.gpu){ log("WebGPU unsupported"); return; }

    const supported = await navigator.xr.isSessionSupported(mode);
    if(!supported){
      log(`${mode} not supported. Trying immersive-vr...`);
      mode = 'immersive-vr';
      const vrOk = await navigator.xr.isSessionSupported(mode);
      if(!vrOk){ log('immersive-vr not supported'); return; }
    }

    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter){ log("No GPU adapter"); return; }
    const device = await adapter.requestDevice();
    log("GPU device acquired");

    const opts = mode === 'immersive-ar' ? { optionalFeatures:["layers","hit-test","dom-overlay"] } : { optionalFeatures:["layers"] };
    const session = await navigator.xr.requestSession(mode, opts);
    log(`XR session started (${mode}, layers optional)`);

    // Try to construct a WebGPU-compatible XR layer (subject to browser implementation)
    let layer;
    try {
      const XRWebGPULayer = window.XRWebGPULayer || window.XRWebGPUTieredLayer || null;
      if(!XRWebGPULayer){ throw new Error("XRWebGPULayer not available"); }
      layer = new XRWebGPULayer(session, device, { alpha: true });
      log("XRWebGPULayer created");
      statusEl.textContent = 'Status: using WebXR+WebGPU binding';
    } catch(e){
      log("XRWebGPU layer creation failed:", e.message || e);
    }

    if(!layer){
      log("Falling back: cannot proceed with WebGPU binding in this browser/build");
      statusEl.textContent = 'Status: binding not available (AR)';
      // keep session alive without WebGPU layer
    }

    // Set layers if supported
    if (layer) {
      try {
        session.updateRenderState({ layers: [ layer ] });
        log("Render state updated with WebGPU layer");
      } catch(e){
        log("session.updateRenderState failed:", e.message || e);
        statusEl.textContent = 'Status: binding not available (updateRenderState)';
      }
    }

    const refSpace = await session.requestReferenceSpace("local-floor").catch(()=>session.requestReferenceSpace("local"));

    const onFrame = (time, frame)=>{
      const pose = frame.getViewerPose(refSpace);
      if(!pose){ session.requestAnimationFrame(onFrame); return; }

      try{
        const encoder = device.createCommandEncoder();
        for(const view of pose.views){
          const viewTex = layer.getViewTexture ? layer.getViewTexture(view) : null;
          if(!viewTex){ continue; }
          const colorView = viewTex.createView();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
          });
          pass.end();
        }
        device.queue.submit([encoder.finish()]);
      } catch(e){
        // Not supported in this build
      }

      session.requestAnimationFrame(onFrame);
    };
    session.requestAnimationFrame(onFrame);
  }catch(e){
    log("Error:", e.message || e);
  }
}

document.getElementById("start").addEventListener("click", () => start('immersive-ar'));
document.getElementById("start-vr").addEventListener("click", () => start('immersive-vr'));
