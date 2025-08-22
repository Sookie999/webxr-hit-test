import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three-stdlib";
import { RGBELoader } from "three-stdlib";

export default function ARWebGPU(){
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let renderer; let scene; let camera; let reticle;
    let hitTestSource = null; let viewerSpace = null; let localSpace = null;
    let dirLight; let hdrTex = null; let model = null; let disposed = false;

    (async () => {
      try {
        if (!("gpu" in navigator)) { setError("이 브라우저는 WebGPU를 지원하지 않습니다."); return; }

        const { WebGPURenderer } = await import("three/examples/jsm/renderers/webgpu/WebGPURenderer.js");
        renderer = new WebGPURenderer({ antialias: true, canvas: canvasRef.current });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        await renderer.init();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

        dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1,2,1);
        scene.add(new THREE.AmbientLight(0xffffff, 0.2));
        scene.add(dirLight);

        // HDR environment (WebGPU: use equirect mapping)
        hdrTex = await new RGBELoader().loadAsync("/assets/hdr/venice_sunset_1k.hdr");
        hdrTex.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdrTex;

        // Model
        const gltf = await new GLTFLoader().loadAsync("/assets/models/DamagedHelmet.glb");
        model = gltf.scene;

        // Reticle
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
          domOverlay: { root: containerRef.current || document.body }
        });
        (containerRef.current || document.body).appendChild(button);

        const onResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", onResize);

        const onSessionStart = async () => {
          const session = renderer.xr.getSession();
          const space = await session.requestReferenceSpace("viewer");
          viewerSpace = space;
          hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
          localSpace = renderer.xr.getReferenceSpace();
        };
        const onSessionEnd = () => { hitTestSource = null; viewerSpace = null; localSpace = null; reticle.visible = false; };
        renderer.xr.addEventListener("sessionstart", onSessionStart);
        renderer.xr.addEventListener("sessionend", onSessionEnd);

        renderer.setAnimationLoop((_, frame) => {
          if (disposed) return;
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
        });

        return () => {
          disposed = true;
          window.removeEventListener("resize", onResize);
          try { renderer.setAnimationLoop(null); } catch(e) {}
          try { renderer.dispose(); } catch(e) {}
          try { hdrTex && hdrTex.dispose && hdrTex.dispose(); } catch(e) {}
        };
      } catch (e) {
        setError("AR(WebGPU) 초기화 실패: " + (e?.message || e));
      }
    })();
  }, []);

  return (
    <div ref={containerRef} style={{ width:"100vw", height:"100vh", background:"#000" }}>
      {error && <div style={{ position:"fixed", top:10, left:10, color:"#ddd" }}>{error}</div>}
      <canvas ref={canvasRef} />
    </div>
  );
}
