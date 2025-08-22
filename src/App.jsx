import React, { useState } from "react";
import ARWebGL from "./components/ARWebGL.jsx";
import ARWebGPU from "./components/ARWebGPU.jsx";

export default function App(){
  const [mode, setMode] = useState("webgl");
  return (
    <>
      <div className="toolbar" style={{ position:"fixed", top:10, left:10, zIndex:10, display:"flex", gap:8 }}>
        <button onClick={()=>setMode("webgl")}>AR(WebGL)</button>
        <button onClick={()=>setMode("webgpu")}>AR(WebGPU, 실험)</button>
      </div>
      {mode === "webgl" ? <ARWebGL /> : <ARWebGPU />}
    </>
  );
}
