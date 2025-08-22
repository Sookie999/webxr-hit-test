import * as THREE from 'three';
import React from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { XR, ARButton, Controllers, Hands } from "@react-three/xr";
import { Environment, useGLTF } from "@react-three/drei";

function Helmet(props){
  const { scene } = useGLTF("/assets/models/DamagedHelmet.glb");
  return <primitive object={scene} {...props} />;
}

function ARScene(){
  return (
    <XR>
      <ambientLight intensity={0.2} />
      <directionalLight intensity={0.8} position={[1,2,1]} />
      <Environment files="/assets/hdr/venice_sunset_1k.hdr" />
      <Controllers />
      <Hands />
      <Helmet position={[0,0,-0.5]} />
    </XR>
  );
}

function App(){
  return (
    <>
      <ARButton sessionInit={{ requiredFeatures:["hit-test"], optionalFeatures:["light-estimation","dom-overlay"], domOverlay:{ root: document.body } }} />
      <Canvas camera={{ fov:70 }} onCreated={({ gl })=>{ gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
        <ARScene />
      </Canvas>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
