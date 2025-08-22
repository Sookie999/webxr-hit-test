import React, { Suspense } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { XR, ARButton } from "@react-three/xr";
import { Environment, useGLTF } from "@react-three/drei";

function Helmet(props){
  const { scene } = useGLTF("/assets/models/DamagedHelmet.glb");
  return <primitive object={scene} {...props} />;
}

export default function ARWebGL(){
  return (
    <>
      <Canvas camera={{ fov:70 }} onCreated={({ gl })=>{ gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
        <XR>
          <ARButton sessionInit={{ requiredFeatures:["hit-test"], optionalFeatures:["light-estimation","dom-overlay"], domOverlay:{ root: document.body } }} />
          <ambientLight intensity={0.2} />
          <directionalLight intensity={0.8} position={[1,2,1]} />
          <Suspense fallback={null}>
            <Environment files="/assets/hdr/venice_sunset_1k.hdr" />
            <Helmet position={[0,0,-0.5]} />
          </Suspense>
          {/* Controllers/Hands are optional and not needed for AR hit-test demo */}
        </XR>
      </Canvas>
    </>
  );
}
