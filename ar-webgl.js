import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";
import { createWebGPUVideoTexture } from "./webgpu_panel.js";

let renderer, scene, camera, reticle, pmrem;
let hitTestSource = null, viewerSpace = null, localSpace = null;
let dirLight, hdrTexture, model;
let cleanupFns = [];

export async function startARWebGL(root){
  await stop();
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  root.appendChild(renderer.domElement);

  pmrem = new THREE.PMREMGenerator(renderer);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1,2,1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  scene.add(dirLight);

  hdrTexture = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
  const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
  scene.environment = envMap;

  const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
  model = gltf.scene;

  // WebGPU 패널을 비디오 텍스처로 만들어 AR 공간에 표시 (XR + WebGPU 하이브리드)
  try {
    const panelTex = await createWebGPUVideoTexture(THREE);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ map: panelTex }));
    plane.position.set(0, 0.2, -0.6);
    scene.add(plane);
  } catch (e) {
    console.warn("WebGPU panel init failed:", e);
  }

  const ring = new THREE.RingGeometry(0.08, 0.1, 32);
  ring.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
  reticle.matrixAutoUpdate = false; reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    if (!reticle.visible || !model) return;
    const placed = model.clone(true);
    placed.position.setFromMatrixPosition(reticle.matrix);
    placed.quaternion.setFromRotationMatrix(reticle.matrix);
    scene.add(placed);
  });
  scene.add(controller);

  const button = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "light-estimation"],
    domOverlay: { root: document.getElementById("overlay") || document.body }
  });
  root.appendChild(button);

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);
  cleanupFns.push(() => window.removeEventListener("resize", onResize));

  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);
  cleanupFns.push(() => {
    renderer.xr.removeEventListener("sessionstart", onSessionStart);
    renderer.xr.removeEventListener("sessionend", onSessionEnd);
  });

  renderer.setAnimationLoop(render);
}

async function onSessionStart(){
  const session = renderer.xr.getSession();
  const space = await session.requestReferenceSpace("viewer");
  viewerSpace = space;
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  localSpace = renderer.xr.getReferenceSpace();
}

function onSessionEnd(){
  hitTestSource = null; viewerSpace = null; localSpace = null; reticle && (reticle.visible = false);
}

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
  cleanupFns.forEach((fn)=>{ try { fn(); } catch(e) {} });
  cleanupFns = [];
  try { renderer.dispose(); } catch(e) {}
  try { hdrTexture && hdrTexture.dispose && hdrTexture.dispose(); } catch(e) {}
  const root = document.getElementById("root-vanilla");
  if (root) {
    // remove AR button and canvas
    [...root.querySelectorAll("canvas, button")].forEach(el=>el.remove());
  }
  renderer = null; scene = null; camera = null; reticle = null; pmrem = null;
  hitTestSource = null; viewerSpace = null; localSpace = null; dirLight = null; hdrTexture = null; model = null;
}
