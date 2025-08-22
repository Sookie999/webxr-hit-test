import "@babylonjs/core/Engines/Extensions/engine.views.js";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, HemisphericLight } from "@babylonjs/core/Maths/math.vector";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";

const canvas = document.getElementById("c");
const log = document.getElementById("log");

function appendLog(msg){ log.textContent = msg; console.log(msg); }

async function createEngine() {
  try {
    const eng = new WebGPUEngine(canvas, { antialias: true });
    await eng.initAsync();
    appendLog("Using WebGPU");
    return eng;
  } catch (e) {
    appendLog("WebGPU failed, falling back to WebGL: " + e);
    return new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  }
}

(async function main(){
  const engine = await createEngine();
  const scene = new Scene(engine);

  const camera = new ArcRotateCamera("cam", Math.PI/2, Math.PI/2.3, 2.5, new Vector3(0,0,0), scene);
  camera.attachControl(canvas, true);
  new HemisphericLight("hemi", new Vector3(0,1,0), scene).intensity = 0.8;
  scene.clearColor = new Color3(0,0,0);

  // Load model
  await SceneLoader.AppendAsync("/assets/models/", "DamagedHelmet.glb", scene);

  // Start XR
  try {
    const xr = await WebXRDefaultExperience.CreateAsync(scene, {
      uiOptions: { sessionMode: "immersive-ar" },
      optionalFeatures: true,
      requiredFeatures: ["hit-test"],
    });
    appendLog("XR ready. Use the XR button to enter AR.");
  } catch (e) {
    appendLog("WebXR failed: " + e);
  }

  engine.runRenderLoop(() => { scene.render(); });
  window.addEventListener("resize", () => engine.resize());
})();
