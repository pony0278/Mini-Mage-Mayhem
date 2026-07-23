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

// 手機/平板偵測(可觸控+粗指針或行動 UA;觸控筆電=fine pointer、UA 非行動 → 不算):
// 2026-07 手機卡頓診斷的依據——FX 自動降級(render-lab FX_LOW)+ 下方 dpr 夾低都吃這個旗標。
export const IS_MOBILE = (navigator.maxTouchPoints || 0) > 0 &&
  (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2)); // 手機夾 1.5(填充率省 ~44%;960×540 → 最多 1440×810)
    renderer.setSize(VIEW_W, VIEW_H, false);
    renderer.shadowMap.enabled = false;
    gl3dOk = true;
    window.__gl = { renderer, info: () => renderer.info }; // debug hook(headless 效能診斷用,比照 __v2/__lab;info=programs/calls/memory)
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

  // 道具 GLB(item-1:使用者的冰霜瓶 Meshy 模型;之後其他道具照同一 helper 加）。
  // 載一次→存正規化 proto(外層 group 高度 1、底部貼 y=0、xz 置中）→ 每個瓶實例 clone(true)（geometry/material 共用=clone 便宜，
  // 可每幀重建也不心疼)。三狀態消費:握持(actor-brawler)/地面+飛行(render-entities);未載成 clone 回 null=呼叫端退方塊。
  // **入庫規範(2026-07-20 踩三坑)**:①GLB 若 Draco 壓縮(Meshy 預設)遊戲 loader 會炸(無 DRACOLoader)→ 離線 gltf-transform 解壓。
  // ②**貼圖必須外部化**:GLTFLoader 的內嵌 JPEG 在 SwiftShader(headless 測試/低端機)下上傳成全黑,外部 TextureLoader 就正常
  //   →離線把貼圖抽成 frost-bottle-tex.jpg、GLB 去圖只留幾何,這裡 TextureLoader 載回指派(flipY=false=GLB 慣例、sRGB)。
  // ③**去圖時千萬別 prune()**:gltf-transform prune 見「沒貼圖引用」就把 UV(TEXCOORD_0)一併砍掉 → 遊戲裡貼圖無 UV 可對=渲成素色。
  //   去圖只 setBaseColorTexture(null)+tex.dispose(),**不 prune**(保 UV)。見 assets/README。
  let _frostProto = null;
  export function loadFrostBottleGlb() {
    if (_frostProto || !THREE.GLTFLoader) { if (!THREE.GLTFLoader) console.warn('[core] GLTFLoader 未載入,冰瓶退方塊'); return; }
    const tex = new THREE.TextureLoader().load('assets/scene/frost-bottle-tex.jpg'); // 外部貼圖(繞過內嵌黑圖坑)
    tex.flipY = false; tex.encoding = THREE.sRGBEncoding;
    fetch('assets/scene/frost-bottle.glb')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
      .then(gltf => {
        const s = gltf.scene;
        s.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material.map = tex;
          o.material.emissiveMap = tex; o.material.emissive = new THREE.Color(0x6ab8e0); o.material.emissiveIntensity = 0.6; // 冰藍自發光(比照 lab 元素色 boost:ACES 暗場會把貼圖洗灰,emissiveMap=同貼圖=藥水藍處發冷光、銀框處弱)
          o.material.needsUpdate = true; } }); // 貼外部圖
        s.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(s);
        const h = (box.max.y - box.min.y) || 1, cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
        s.scale.multiplyScalar(1 / h);                     // 高度正規化到 1
        s.position.set(-cx / h, -box.min.y / h, -cz / h);  // 底部貼 y=0、xz 置中(scale 後座標)
        _frostProto = new THREE.Group(); _frostProto.add(s); _frostProto.userData.__frost = true; // 外層 group=掛載端 setScalar(目標高) 不會蓋掉正規化;__frost 旗=clone 繼承(測試精準計數用)
        if (renderer) renderer.compile(scene, camera);       // perf-1 預熱:新材質載入期預編譯,免首次入鏡卡頓
        console.log('[core] 冰霜瓶 GLB 就位');
      })
      .catch(e => console.warn('[core] 冰霜瓶 GLB 載入失敗,退方塊', e));
  }
  // 統一道具視覺高度(item-1;使用者拍板 2026-07-20:道具 GLB 一律等人物高度——1.7× 仍看不清,
  // 且本作本來就是「把人扛頭上丟」的卡通比例,道具=地標級才讀得出)。**純視覺、不動碰撞**(sim 維持 pr.r):
  // 所有道具 GLB 三狀態(握持/地面/飛行)都正規化到此世界高度;量測角色 standH≈78。之後每顆新道具模型自動吃這個值。
  export const ITEM_VIS_H = 78;
  // 回傳一個掛載用 clone(高度 1、底貼地、xz 置中);未載成回 null。呼叫端 setScalar(目標高)+定位+轉向。
  export function frostBottleClone() { return _frostProto ? _frostProto.clone(true) : null; }
  export function frostBottleReady() { return !!_frostProto; } // 測試/除錯 hook

  // 爆桶 GLB(item-2:使用者的 Violet Arcane Vessel = 紫色魔能桶;game.barrels 爆炸桶)。
  // 同冰瓶四步入庫(解 Draco/去 Draco 擴充/貼圖外部化不 prune/quantize)+同一 helper 慣例:載一次存正規化 proto、三狀態 clone。
  // 桶本體固定紫,充能/引信狀態靠呼叫端疊加 makeGlowSphere 光暈表達(使用者拍板 2026-07-20:疊加光暈,不換貼圖)。
  let _barrelProto = null;
  export function loadBarrelGlb() {
    if (_barrelProto || !THREE.GLTFLoader) { if (!THREE.GLTFLoader) console.warn('[core] GLTFLoader 未載入,爆桶退方塊'); return; }
    const tex = new THREE.TextureLoader().load('assets/scene/barrel-tex.jpg'); // 外部貼圖(繞過內嵌黑圖坑)
    tex.flipY = false; tex.encoding = THREE.sRGBEncoding;
    fetch('assets/scene/barrel.glb')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
      .then(gltf => {
        const s = gltf.scene;
        s.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material.map = tex;
          o.material.emissiveMap = tex; o.material.emissive = new THREE.Color(0x8a4ad0); o.material.emissiveIntensity = 0.55; // 紫魔能自發光(ACES 暗場貼圖洗灰→emissiveMap 同貼圖=符文/閃電紋處發紫冷光)
          o.material.needsUpdate = true; } }); // 貼外部圖
        s.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(s);
        const h = (box.max.y - box.min.y) || 1, cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
        s.scale.multiplyScalar(1 / h);                     // 高度正規化到 1
        s.position.set(-cx / h, -box.min.y / h, -cz / h);  // 底部貼 y=0、xz 置中(scale 後座標)
        _barrelProto = new THREE.Group(); _barrelProto.add(s); _barrelProto.userData.__barrel = true; // __barrel 旗=clone 繼承(測試精準計數用)
        if (renderer) renderer.compile(scene, camera);       // perf-1 預熱
        console.log('[core] 爆桶 GLB 就位');
      })
      .catch(e => console.warn('[core] 爆桶 GLB 載入失敗,退方塊', e));
  }
  export function barrelClone() { return _barrelProto ? _barrelProto.clone(true) : null; }
  export function barrelReady() { return !!_barrelProto; } // 測試/除錯 hook

  // 火帽 GLB(item-3:使用者的 The Golden Maw 金色大嘴帽;持有噴火帽時戴頭上)。同冰瓶四步入庫+同 helper 慣例。
  let _hatProto = null;
  export function loadFireHatGlb() {
    if (_hatProto || !THREE.GLTFLoader) { if (!THREE.GLTFLoader) console.warn('[core] GLTFLoader 未載入,火帽不顯示'); return; }
    const tex = new THREE.TextureLoader().load('assets/scene/fire-hat-tex.jpg'); // 外部貼圖(繞過內嵌黑圖坑)
    tex.flipY = false; tex.encoding = THREE.sRGBEncoding;
    fetch('assets/scene/fire-hat.glb')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
      .then(gltf => {
        const s = gltf.scene;
        s.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material.map = tex;
          o.material.emissiveMap = tex; o.material.emissive = new THREE.Color(0xd8a24a); o.material.emissiveIntensity = 0.5; // 金色自發光 boost(ACES 暗場防洗灰)
          o.material.needsUpdate = true; } });
        s.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(s);
        const h = (box.max.y - box.min.y) || 1, cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
        s.scale.multiplyScalar(1 / h);                     // 高度正規化到 1
        s.position.set(-cx / h, -box.min.y / h, -cz / h);  // 底部貼 y=0、xz 置中
        _hatProto = new THREE.Group(); _hatProto.add(s); _hatProto.userData.__hat = true; // __hat 旗=clone 繼承(測試計數)
        if (renderer) renderer.compile(scene, camera);       // perf-1 預熱
        console.log('[core] 火帽 GLB 就位');
      })
      .catch(e => console.warn('[core] 火帽 GLB 載入失敗', e));
  }
  export function fireHatClone() { return _hatProto ? _hatProto.clone(true) : null; }
  export function fireHatReady() { return !!_hatProto; } // 測試/除錯 hook

  // 風壓手套 GLB(item-4:使用者的 Azure Turbine Gauntlet 渦輪手套;持風壓手套 item='wind' 時戴右手)。
  // 同冰瓶四步入庫+同 helper 慣例。手套=裝備(掛右腕跟手動),非道具地標→不吃 ITEM_VIS_H,由 updateGauntlet 的
  // WIND_CAL 縮到貼手大小。emissive=azure 冷光(ACES 暗場防洗灰;渦輪扇/管線發青光)。
  let _gauntletProto = null;
  export function loadWindGauntletGlb() {
    if (_gauntletProto || !THREE.GLTFLoader) { if (!THREE.GLTFLoader) console.warn('[core] GLTFLoader 未載入,風壓手套不顯示'); return; }
    const tex = new THREE.TextureLoader().load('assets/scene/wind-gauntlet-tex.jpg'); // 外部貼圖(繞過內嵌黑圖坑)
    tex.flipY = false; tex.encoding = THREE.sRGBEncoding;
    fetch('assets/scene/wind-gauntlet.glb')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
      .then(gltf => {
        const s = gltf.scene;
        s.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material.map = tex;
          o.material.emissiveMap = tex; o.material.emissive = new THREE.Color(0x4aa8d8); o.material.emissiveIntensity = 0.5; // azure 自發光 boost(ACES 暗場防洗灰)
          o.material.needsUpdate = true; } });
        s.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(s);
        const h = (box.max.y - box.min.y) || 1, cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2, cz = (box.max.z + box.min.z) / 2;
        s.scale.multiplyScalar(1 / h);                     // 最大維度正規化到 1(掛端 setScalar 目標大小)
        s.position.set(-cx / h, -cy / h, -cz / h);         // 正中置心(裝備繞腕,非底貼地=不用 box.min.y)
        _gauntletProto = new THREE.Group(); _gauntletProto.add(s); _gauntletProto.userData.__gauntlet = true; // __gauntlet 旗=clone 繼承(測試計數)
        if (renderer) renderer.compile(scene, camera);       // perf-1 預熱
        console.log('[core] 風壓手套 GLB 就位');
      })
      .catch(e => console.warn('[core] 風壓手套 GLB 載入失敗', e));
  }
  export function windGauntletClone() { return _gauntletProto ? _gauntletProto.clone(true) : null; }
  export function windGauntletReady() { return !!_gauntletProto; } // 測試/除錯 hook

// lab 場景(render-lab)接管燈光時,關掉單機的四盞常設燈(避免疊加過曝)
export function setStockLights(on) {
  hemi.intensity = on ? 0.92 : 0;
  sun.intensity = on ? 1.18 : 0;
  rim.intensity = on ? 0.42 : 0;
  magicFill.intensity = on ? 0.52 : 0;
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
