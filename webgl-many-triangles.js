import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ARButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/ARButton.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearAlpha(0);
document.body.appendChild(renderer.domElement);
renderer.xr.enabled = true;
document.body.appendChild(ARButton.createButton(renderer, {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['dom-overlay']
}));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
camera.position.z = 1.2;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// Base triangle geometry (small size)
const geom = new THREE.BufferGeometry();
const vertices = new Float32Array([
  0.0,  0.025, 0.0,
 -0.025,-0.025, 0.0,
  0.025,-0.025, 0.0
]);
geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Instanced mesh using per-instance transforms
const count = 1024;
const mesh = new THREE.InstancedMesh(geom, material, count);
const dummy = new THREE.Object3D();
let i = 0;
for (let iy = 0; iy < 32; iy++) {
  for (let ix = 0; ix < 32; ix++) {
    dummy.position.set((ix - 16) * 0.02, (iy - 16) * 0.02, -0.5 - i * 0.0005);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // optional coloring
    const color = new THREE.Color().setHSL(((ix+iy)%32)/32, 0.6, 0.6);
    mesh.setColorAt && mesh.setColorAt(i, color);
    i++;
  }
}
mesh.instanceMatrix.needsUpdate = true;
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
scene.add(mesh);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  mesh.rotation.y += 0.003;
  renderer.render(scene, camera);
  // FPS overlay
  const now = performance.now();
  window.__frames = (window.__frames || 0) + 1;
  if (!window.__fps_t0) window.__fps_t0 = now;
  const dt = now - window.__fps_t0;
  if (dt >= 500) { // update every 0.5s
    const fps = Math.round((window.__frames * 1000) / dt);
    const el = document.getElementById('fps');
    if (el) el.textContent = 'FPS: ' + fps;
    window.__frames = 0;
    window.__fps_t0 = now;
  }
});


