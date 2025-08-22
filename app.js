import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";

const btnAR = document.getElementById("mode-ar");
const btnGL = document.getElementById("mode-webgl");
const btnGPU = document.getElementById("mode-webgpu");
const info = document.getElementById("info");

let scene;
let camera;
let renderer;
let pmrem;
let hdrTexture;
let model;
let currentMode = "webgl";

// XR fields
let reticle, hitTestSource = null, viewerSpace = null, localSpace = null, lightProbeXR = null, dirLight;

btnAR.addEventListener("click", () => switchMode("ar"));
btnGL.addEventListener("click", () => switchMode("webgl"));
btnGPU.addEventListener("click", () => switchMode("webgpu"));

init();
loadAssets().then(() => { switchMode("ar"); });

function setInfo() {
  const backend = currentMode === "ar" ? "WebXR (WebGL)" : currentMode.toUpperCase();
  info.textContent = `Mode: ${backend} | DPR: ${Math.round(renderer.getPixelRatio()*100)/100}`;
}

function resetScene() {
  if (!scene) scene = new THREE.Scene();
  while (scene.children.length) scene.remove(scene.children[0]);
}

async function createRendererWebGL() {
  if (renderer) { document.body.removeChild(renderer.domElement); renderer.dispose(); }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  pmrem = new THREE.PMREMGenerator(renderer);
}

async function createRendererWebGPU() {
  if (!("gpu" in navigator)) {
    alert("이 브라우저는 WebGPU를 지원하지 않아 WebGL로 전환합니다.");
    return createRendererWebGL();
  }
  if (renderer) { document.body.removeChild(renderer.domElement); renderer.dispose(); }
  const { WebGPURenderer } = await import("three/examples/jsm/renderers/webgpu/WebGPURenderer.js");
  renderer = new WebGPURenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  pmrem = new THREE.PMREMGenerator(renderer);
}

async function loadAssets() {
  hdrTexture = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
  const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
  model = gltf.scene;
}

function addEnvironment() {
  if (!hdrTexture) return;
  if (currentMode === "webgpu") {
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrTexture;
  } else {
    const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
    scene.environment = envMap;
  }
}

async function switchMode(mode) {
  currentMode = mode;
  window.removeEventListener("resize", onResize);
  resetScene();

  const arBtn = document.querySelector("button[style*='AR']") || document.querySelector(".ar-button");
  arBtn && arBtn.remove && arBtn.remove();

  if (mode === "webgpu") {
    await createRendererWebGPU();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.25, 1.5);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.6));
    const m = model.clone(true);
    m.position.set(0, -0.05, 0);
    scene.add(m);
    addEnvironment();
    renderer.setAnimationLoop(() => {
      scene.rotation.y += 0.002;
      renderer.render(scene, camera);
    });
  } else if (mode === "webgl") {
    await createRendererWebGL();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.25, 1.5);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.6));
    const m = model.clone(true);
    m.position.set(0, -0.05, 0);
    scene.add(m);
    addEnvironment();
    renderer.setAnimationLoop(() => {
      scene.rotation.y += 0.002;
      renderer.render(scene, camera);
    });
  } else if (mode === "ar") {
    await createRendererWebGL();
    renderer.xr.enabled = true;
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1,2,1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    scene.add(dirLight);

    const ring = new THREE.RingGeometry(0.08, 0.1, 32);
    ring.rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
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
      optionalFeatures: ["light-estimation", "dom-overlay"],
      domOverlay: { root: document.getElementById("overlay") }
    });
    document.body.appendChild(button);

    addEnvironment();

    renderer.xr.addEventListener("sessionstart", onSessionStart);
    renderer.xr.addEventListener("sessionend", onSessionEnd);
    renderer.setAnimationLoop(renderAR);
  }

  window.addEventListener("resize", onResize);
  setInfo();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  setInfo();
}

function renderAR(timestamp, frame) {
  if (frame && hitTestSource && localSpace) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length > 0) {
      const hit = hits[0];
      const pose = hit.getPose(localSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      reticle.visible = false;
    }

    if (lightProbeXR) {
      const est = frame.getLightEstimate(lightProbeXR);
      if (est && est.primaryLightDirection) {
        const d = est.primaryLightDirection;
        dirLight.position.set(d.x, d.y, d.z).multiplyScalar(-1);
      }
      if (est && est.primaryLightIntensity) {
        const i = est.primaryLightIntensity;
        const intensity = Math.max(i.x, i.y, i.z);
        dirLight.intensity = THREE.MathUtils.clamp(intensity / 1000, 0.2, 2.0);
        dirLight.color.setRGB(i.x / 1000, i.y / 1000, i.z / 1000);
      }
    }
  }
  renderer.render(scene, camera);
}

async function onSessionStart() {
  const session = renderer.xr.getSession();
  session.requestReferenceSpace("viewer").then(space => {
    viewerSpace = space;
    session.requestHitTestSource({ space: viewerSpace }).then(source => { hitTestSource = source; });
  });
  localSpace = renderer.xr.getReferenceSpace();
  if (session.requestLightProbe) {
    try { lightProbeXR = await session.requestLightProbe(); } catch (e) { lightProbeXR = null; }
  }
}

function onSessionEnd() {
  hitTestSource = null; viewerSpace = null; localSpace = null; lightProbeXR = null; reticle && (reticle.visible = false);
}
