# WebXR AR Hit Test Demo (Vite)

## 실행 (모바일 크롬)
```bash
cd /Users/sookie/pj/techtalk/demo/webxr-hit-test
npm run dev:https
```
- 터미널에 표시되는 LAN 주소(예: https://192.168.x.x:5173)로 휴대폰 접속
- 처음 실행 시 루트 인증서 설치 안내가 뜨면 `vite-plugin-mkcert`가 생성합니다.
  - macOS: `brew install mkcert nss` 후 재시도 권장

## 뷰어(WebGL vs WebGPU) 비교 페이지
- 경로: `/viewer.html`
- 버튼으로 WebGL/WebGPU 렌더러 전환, PBR 모델(HDRI)로 품질/성능 비교

## 참고
- three.js from npm, ESM
- Vite dev server: `--host --https`
- WebXR required feature: `hit-test`

## 실험: Babylon WebXR + WebGPU (Android Chrome Canary 권장)
- 경로: `/babylon-xr.html`
- WebGPU 시도 후 실패 시 자동 WebGL 폴백
- Chrome 플래그(기기마다 상이):
  - chrome://flags/#enable-webgpu-service 
  - chrome://flags/#webgpu-developer-features 
  - chrome://flags/#webxr-incubations 
- Android Chrome Dev/Canary + WebXR ARCore 모듈 최신 권장
- 이 데모는 실험적이라 기기/드라이버 별로 실패할 수 있음

## React + R3F + @react-three/xr AR 페이지
- 경로: `/r3f/index.html`
- React/Canvas + XR 컴포넌트로 AR 세션, 동일 HDRI/모델 적용

## Experimental WebXR + WebGPU
- 경로: `/experimental-webgpu-xr.html`
- Chrome Dev/Canary + WebGPU 플래그 필요. 실패 시 안내/폴백

## Root React App (AR WebGL/WebGPU 스위치)
- 루트 `/`에서 React UI로 AR(WebGL)과 AR(WebGPU, 실험)을 전환합니다.
- AR(WebGPU)은 환경 의존성이 높아 실패 시 안내 문구가 표시됩니다.

## Root React App (AR WebGL/WebGPU 스위치)
- 루트 `/`에서 React UI로 AR(WebGL)과 AR(WebGPU, 실험)을 전환합니다.
- AR(WebGPU)은 환경 의존성이 높아 실패 시 안내 문구가 표시됩니다.

## 제한 사항 (WebGPU + WebXR)
- 현재 three.js `WebGPURenderer`는 WebXR 미지원입니다. WebGPU 비교는 `/viewer.html`에서 확인하세요.
- 참고: Three.js 포럼 답변, GitHub 이슈
  - https://discourse.threejs.org/t/webgpurenderer-vr-support/76048/2
  - https://github.com/mrdoob/three.js/issues/28968
