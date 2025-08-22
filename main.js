import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";

let camera;
let scene;
let renderer;
let reticle;
let hitTestSource = null;
let viewerSpace = null;
let localSpace = null;
let pmrem;
let hdrTexture = null;
let gltfScene = null;
let lightProbeXR = null;
let dirLight;

init();
animate();

async function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 2, 1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  pmrem = new THREE.PMREMGenerator(renderer);

  // Reticle
  const ring = new THREE.RingGeometry(0.08, 0.1, 32);
  ring.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  const button = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["light-estimation", "dom-overlay"],
    domOverlay: { root: document.getElementById("overlay") }
  });
  document.body.appendChild(button);

  window.addEventListener("resize", onWindowResize);
  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  // Preload assets
  hdrTexture = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
  const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
  scene.environment = envMap;

  const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
  gltfScene = gltf.scene;
  gltfScene.scale.setScalar(1);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function onSessionStart() {
  const session = renderer.xr.getSession();
  session.requestReferenceSpace("viewer").then(space => {
    viewerSpace = space;
    session.requestHitTestSource({ space: viewerSpace }).then(source => {
      hitTestSource = source;
    });
  });
  localSpace = renderer.xr.getReferenceSpace();

  // Optional: light estimation
  if (session.requestLightProbe) {
    try {
      lightProbeXR = await session.requestLightProbe();
    } catch (e) {
      lightProbeXR = null;
    }
  }
}

function onSessionEnd() {
  hitTestSource = null;
  viewerSpace = null;
  localSpace = null;
  lightProbeXR = null;
  reticle.visible = false;
}

function onSelect() {
  if (!reticle.visible || !gltfScene) return;
  const placed = gltfScene.clone(true);
  placed.position.setFromMatrixPosition(reticle.matrix);
  placed.quaternion.setFromRotationMatrix(reticle.matrix);
  scene.add(placed);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame && hitTestSource && localSpace) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(localSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      reticle.visible = false;
    }

    // Light estimation (best-effort)
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
