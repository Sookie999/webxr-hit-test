;(async function(){
  const el = document.getElementById("status");
  const btn = document.getElementById("start-vr");
  try {
    // Load via CDN to avoid local path resolution issues
    const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
    const mod = await import('https://unpkg.com/three@0.160.0/examples/jsm/renderers/webgpu/WebGPURenderer.js');
    const WebGPURenderer = mod.default || mod.WebGPURenderer;

    const renderer = new WebGPURenderer({ antialias: true });
    await renderer.init();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.z = 3;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x44aaee }));
    scene.add(box);

    async function enterVR(){
      if (!navigator.xr) { el.textContent = 'Status: WebXR unsupported'; return; }
      const vrOk = await navigator.xr.isSessionSupported('immersive-vr');
      if (!vrOk) { el.textContent = 'Status: immersive-vr not supported'; return; }

      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures:[ 'layers' ] });
      el.textContent = 'Status: XR session started (VR)';

      if (renderer.xr && renderer.xr.setSession) {
        await renderer.xr.setSession(session);
        el.textContent = 'Status: renderer.xr.setSession done';
      } else if (renderer.setSession) {
        await renderer.setSession(session);
        el.textContent = 'Status: renderer.setSession done';
      } else {
        el.textContent = 'Status: renderer session binding not exposed';
      }
    }
    btn?.addEventListener('click', async ()=>{
      el.textContent = 'Status: requesting VR session...';
      await enterVR();
    });

    function onResize(){
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    renderer.setAnimationLoop(()=>{
      box.rotation.y += 0.01;
      renderer.render(scene, camera);
    });
  } catch (e) {
    el.textContent = 'Error: ' + (e?.message || e);
  }
})();
