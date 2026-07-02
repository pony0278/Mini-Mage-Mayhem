// render-core.js — 渲染核心 (docs/render-module-boundaries.md):renderer/場景/攝影機/燈光、
// ART 調色盤、共用幾何+材質快取、project()/滑鼠 raycast、共用顯示旗標。
// 子模組(world/actors/entities)與門面(render.js)都從這裡拿工具;外部請走 render.js 門面。
import { W, H } from './constants.js';
import { clamp } from './utils.js';
import { mouse, CAM } from './state.js';

const canvas = document.getElementById('game');
// 視圖尺寸(畫布內部解析度)由 HTML 殼的 canvas 屬性決定,與世界尺寸(W/H,模擬座標)解耦:
// v2.html 用 960×540(16:9,CrazyGames responsive);index.html 維持 960×640(3:2)。
export const VIEW_W = canvas.width, VIEW_H = canvas.height;

  export function project(wx, wy, wz = 0) {
    const v = _projV.set(wx, wz, wy).project(camera);
    return { x: (v.x * 0.5 + 0.5) * VIEW_W, y: (-v.y * 0.5 + 0.5) * VIEW_H, behind: v.z > 1 };
  }

  // ===================================================================
  //  3D RENDERER (Three.js) — voxel world, fixed 45° follow camera.
  //  Game logic is unchanged; this replaces the old 2D world drawing.
  // ===================================================================
  export const mouseScreen = { x: VIEW_W / 2, y: VIEW_H / 2 };
  const _projV = new THREE.Vector3();

  let renderer = null, gl3dOk = false;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(VIEW_W, VIEW_H, false);
    renderer.shadowMap.enabled = false;
    gl3dOk = true;
  } catch (err) {
    console.warn('WebGL unavailable:', err);
  }

  export const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100e18);
  scene.fog = new THREE.Fog(0x100e18, 820, 1580);

  // Tuned in the camera sandbox: telephoto, low diagonal follow cam.
  export const camera = new THREE.PerspectiveCamera(CAM.fov, VIEW_W / VIEW_H, 1, 5000);

  const hemi = new THREE.HemisphereLight(0xfff2d2, 0x1c1630, 0.92);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd88a, 1.18);
  sun.position.set(-0.6, 1.25, 0.55);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7ddcff, 0.42);
  rim.position.set(0.55, 0.6, -0.75);
  scene.add(rim);
  const magicFill = new THREE.PointLight(0xaa72ff, 0.52, 980);
  magicFill.position.set(W / 2, 260, H / 2);
  scene.add(magicFill);

  export const ART = {
    ink: '#15101c', parchment: '#f1d8aa', gold: '#ffd36d', violet: '#9b6cff', cyan: '#9fe7ff',
    floorA: '#4b3b45', floorB: '#40313d', floorEdge: '#6a5463', grass: '#416e38', grassHi: '#94df62',
    burnt: '#2a1c18', water: '#1d5771', ice: '#bdf5ff', wall: 0x625563, wallTop: 0x887780,
    thin: 0xa77b4e, thinTop: 0xd1a06a
  };

  // --- shared geometry / material caches ---
  export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  export const sphereGeo = new THREE.SphereGeometry(1, 14, 12);
  export const circleGeo = new THREE.CircleGeometry(1, 36);
  export const coneGeo = new THREE.ConeGeometry(1, 2, 4);
  export const octaGeo = new THREE.OctahedronGeometry(1, 0);
  export const tetraGeo = new THREE.TetrahedronGeometry(1, 0);
  export const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  export const torusGeo = new THREE.TorusGeometry(1, 0.08, 6, 24);
  export const colorHex = (s) => {
    if (typeof s === 'number') return s;
    if (!s) return 0xffffff;
    if (s[0] === '#') return parseInt(s.slice(1), 16);
    return 0xffffff;
  };
  const _matCache = new Map();
  export const basicMat = (hex) => {
    let m = _matCache.get(hex);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: hex }); _matCache.set(hex, m); }
    return m;
  };
  const lightMat = new THREE.LineBasicMaterial({ color: 0xe5fcff });

  export function matLambert(color, emissive = 0x000000, intensity = 0) {
    return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });
  }
  export function makeBox(w, h, d, color, emissive = 0x000000, intensity = 0) {
    const m = new THREE.Mesh(boxGeo, matLambert(color, emissive, intensity));
    m.scale.set(w, h, d);
    return m;
  }
  export function makeGlowSphere(r, color, opacity = 0.32) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(sphereGeo, mat);
    m.scale.setScalar(r);
    return m;
  }
  export function tmpMat(color, opacity = 1, additive = false) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    if (additive) mat.blending = THREE.AdditiveBlending;
    mat.__tmp = true;
    return mat;
  }

// 實驗室氛圍(v2 lab 主題):背景/霧/燈光切換成暗藍紫冷色調(參考 arcane containment 原型)。
// 亮度刻意比原型高一截 —— 角色是 Lambert 受光的,太暗會吃掉藍/紅身分色的可讀性。
export function setLabAtmosphere(on) {
  if (on) {
    scene.background = new THREE.Color(0x0a0818);
    scene.fog = new THREE.Fog(0x0d0a20, 820, 1580);
    hemi.color.setHex(0xbfb4ff); hemi.groundColor.setHex(0x0e0b1c); hemi.intensity = 0.85;
    sun.color.setHex(0x9a8fe0); sun.intensity = 0.95;
    rim.color.setHex(0x53e0ff); rim.intensity = 0.4;
    magicFill.color.setHex(0xaa72ff); magicFill.intensity = 0.9;
  } else {
    scene.background = new THREE.Color(0x100e18);
    scene.fog = new THREE.Fog(0x100e18, 820, 1580);
    hemi.color.setHex(0xfff2d2); hemi.groundColor.setHex(0x1c1630); hemi.intensity = 0.92;
    sun.color.setHex(0xffd88a); sun.intensity = 1.18;
    rim.color.setHex(0x7ddcff); rim.intensity = 0.42;
    magicFill.color.setHex(0xaa72ff); magicFill.intensity = 0.52;
  }
}

// --- 共用顯示旗標(v2 開機經門面設定;actors/entities 讀) ---
  export let actorShadow = false; export function setActorShadow(on) { actorShadow = on; }   // 角色/箱子 腳下橢圓陰影
  export let vividFx = false; export function setVividFx(on) { vividFx = on; }                // 魔法特效高亮(環外框)
  export let groundMarkers = []; export function setGroundMarkers(list) { groundMarkers = list || []; } // 青綠實驗艙光 / 橘紫危險區

  // --- mouse -> world ground point via camera raycast ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _ndc = new THREE.Vector2();
  const _hit = new THREE.Vector3();
  export function updateMouseWorld() {
    _ndc.set(mouseScreen.x / VIEW_W * 2 - 1, -(mouseScreen.y / VIEW_H * 2 - 1));
    raycaster.setFromCamera(_ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, _hit)) {
      mouse.x = clamp(_hit.x, 0, W);
      mouse.y = clamp(_hit.z, 0, H);
    }
  }

export { renderer, gl3dOk };
