import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";

const info = document.getElementById("info");
const btnWebGL = document.getElementById("btn-webgl");
const btnWebGPU = document.getElementById("btn-webgpu");

let renderer;
let scene;
let camera;
let pmrem;
let currentBackend = "webgl";
let hdrTexture = null;
let model = null;

init();
load();

btnWebGL.addEventListener("click", () => switchBackend("webgl"));
btnWebGPU.addEventListener("click", () => switchBackend("webgpu"));

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.25, 1.5);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  scene.add(hemi);

  createRenderer("webgl");
  window.addEventListener("resize", onResize);
}

async function createRenderer(backend) {
  if (renderer) {
    document.body.removeChild(renderer.domElement);
    renderer.dispose();
  }

  if (backend === "webgpu") {
    if (!("gpu" in navigator)) {
      alert("이 브라우저는 WebGPU를 지원하지 않습니다. WebGL로 전환합니다.");
      backend = "webgl";
    }
  }

  if (backend === "webgpu") {
    const { WebGPURenderer } = await import("three/examples/jsm/renderers/webgpu/WebGPURenderer.js");
    renderer = new WebGPURenderer({ antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    await renderer.init();
  } else {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  pmrem = new THREE.PMREMGenerator(renderer);
  currentBackend = backend;
  applyEnvironment();
  updateInfo();
}

function updateInfo() {
  info.textContent = `Renderer: ${currentBackend.toUpperCase()} | DPR: ${Math.round(renderer.getPixelRatio()*100)/100}`;
}

async function load() {
  hdrTexture = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
  const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
  model = gltf.scene;
  model.position.set(0, -0.05, 0);
  scene.add(model);
  animate();
}

function applyEnvironment() {
  if (!hdrTexture) return;
  if (currentBackend === "webgpu") {
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrTexture;
  } else {
    const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
    scene.environment = envMap;
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateInfo();
}

async function switchBackend(backend) {
  if (backend === currentBackend) return;
  await createRenderer(backend);
}

function animate() {
  renderer.setAnimationLoop(() => {
    scene.rotation.y += 0.002;
    renderer.render(scene, camera);
  });
}
