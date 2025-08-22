import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";

let renderer, scene, camera, reticle;
let hitTestSource = null, viewerSpace = null, localSpace = null;
let hdrTexture, model;
let cleanupFns = [];

export async function startARWebGPU(root){
  await stop();
  if (!("gpu" in navigator)) {
    const p = document.createElement("p"); p.style.color = "#ddd"; p.textContent = "WebGPU 미지원"; root.appendChild(p); return;
  }
  const module = await import("three/examples/jsm/renderers/webgpu/WebGPURenderer.js");
  const WebGPURenderer = module.default || module.WebGPURenderer;
  renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  root.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  hdrTexture = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
  hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdrTexture;

  const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
  model = gltf.scene;

  const ring = new THREE.RingGeometry(0.08, 0.1, 32);
  ring.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
  reticle.matrixAutoUpdate = false; reticle.visible = false;
  scene.add(reticle);

  // In WebGPURenderer, controller helpers may not be available; use session 'select' event instead

  const button = ARButton.createButton(renderer, { requiredFeatures:["hit-test"], optionalFeatures:["dom-overlay","light-estimation"], domOverlay:{ root: document.getElementById("overlay") || document.body } });
  root.appendChild(button);

  // Fallback select handler via XRSession event
  renderer.xr.addEventListener('sessionstart', () => {
    try {
      const session = renderer.xr.getSession();
      session.addEventListener('select', () => {
        if (!reticle?.visible || !model) return;
        const placed = model.clone(true);
        placed.position.setFromMatrixPosition(reticle.matrix);
        placed.quaternion.setFromRotationMatrix(reticle.matrix);
        scene.add(placed);
      });
    } catch (e) {}
  });

  const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); };
  window.addEventListener("resize", onResize); cleanupFns.push(()=>window.removeEventListener("resize", onResize));

  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);
  cleanupFns.push(()=>{ renderer.xr.removeEventListener("sessionstart", onSessionStart); renderer.xr.removeEventListener("sessionend", onSessionEnd); });

  renderer.setAnimationLoop(render);
}

async function onSessionStart(){
  const session = renderer.xr.getSession();
  const space = await session.requestReferenceSpace("viewer");
  viewerSpace = space;
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  localSpace = renderer.xr.getReferenceSpace();
}

function onSessionEnd(){ hitTestSource = null; viewerSpace = null; localSpace = null; reticle && (reticle.visible = false); }

function render(_, frame){
  if (frame && hitTestSource && localSpace) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length > 0) {
      const hit = hits[0];
      const pose = hit.getPose(localSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else { reticle.visible = false; }
  }
  renderer.render(scene, camera);
}

export async function stop(){
  if (!renderer) return;
  try { renderer.setAnimationLoop(null); } catch(e) {}
  cleanupFns.forEach((fn)=>{ try { fn(); } catch(e) {} }); cleanupFns = [];
  try { renderer.dispose(); } catch(e) {}
  try { hdrTexture && hdrTexture.dispose && hdrTexture.dispose(); } catch(e) {}
  const root = document.getElementById("root-vanilla");
  if (root) { [...root.querySelectorAll("canvas, button, p")]?.forEach(el=>el.remove()); }
  renderer = null; scene = null; camera = null; reticle = null; hdrTexture = null; model = null;
  hitTestSource = null; viewerSpace = null; localSpace = null;
}
