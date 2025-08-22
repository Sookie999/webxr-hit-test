const root = document.getElementById("root-vanilla");
const info = document.getElementById("info");
const btnWebGL = document.getElementById("mode-ar-webgl");
const btnWebGPU = document.getElementById("mode-ar-webgpu");
import { startARWebGL, stop as stopGL } from "./ar-webgl.js";

let current = "";

async function switchMode(mode){
  if (mode === current) return;
  if (current === "webgl") await stopGL();
  if (current === "webgpu") {/* no-op: non-XR redirect mode */}
  current = mode;
  if (mode === "webgl") { await startARWebGL(root); info.textContent = "Mode: AR(WebGL)"; }
  if (mode === "webgpu") {
    // Use the same AR logic as WebGL for now (WebGPURenderer lacks WebXR AR support)
    await startARWebGL(root);
    info.textContent = "Mode: AR(WebGPU attempt → using WebGL XR path)";
  }
}

btnWebGL.addEventListener("click", () => switchMode("webgl"));
btnWebGPU.addEventListener("click", () => switchMode("webgpu"));

// default
switchMode("webgl");
