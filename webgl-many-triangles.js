import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
camera.position.z = 1.2;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const geom = new THREE.BufferGeometry();
const vertices = new Float32Array([
  0.0,  0.025, 0.0,
 -0.025,-0.025, 0.0,
  0.025,-0.025, 0.0
]);
geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
geom.computeVertexNormals();

const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

// Instanced attributes
const count = 1024;
const instGeom = geom.clone();
const offsets = new Float32Array(count * 3);
const colors = new Float32Array(count * 3);
let i = 0;
for (let iy = 0; iy < 32; iy++) {
  for (let ix = 0; ix < 32; ix++) {
    const idx = i * 3;
    offsets[idx + 0] = (ix - 16) * 0.02;
    offsets[idx + 1] = (iy - 16) * 0.02;
    offsets[idx + 2] = - (i) * 0.0005;
    colors[idx + 0] = (ix % 8) / 8;
    colors[idx + 1] = (iy % 8) / 8;
    colors[idx + 2] = 1.0 - ((ix + iy) % 8) / 8;
    i++;
  }
}

instGeom.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
instGeom.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));

material.onBeforeCompile = (shader) => {
  shader.vertexShader = `
    attribute vec3 offset;
    attribute vec3 instanceColor;
    varying vec3 vColor;
  ` + shader.vertexShader.replace(
    '#include <begin_vertex>',
    'vec3 transformed = position + offset;'
  );
  shader.vertexShader = shader.vertexShader.replace(
    '#include <color_vertex>',
    'vColor = instanceColor;'
  );
  shader.fragmentShader = `
    varying vec3 vColor;
  ` + shader.fragmentShader.replace(
    'vec4 diffuseColor = vec4( diffuse, opacity );',
    'vec4 diffuseColor = vec4( vColor, opacity );'
  );
};

const mesh = new THREE.InstancedMesh(instGeom, material, count);
scene.add(mesh);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  mesh.rotation.y += 0.003;
  renderer.render(scene, camera);
});


