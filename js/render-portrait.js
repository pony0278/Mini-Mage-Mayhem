// render-portrait.js — 角色頭像快照(hud-1:HUD 集中下方卡片,卡上頭像=角色真臉)。
// 做法:用**現有 renderer** 對著該 fighter avatar 的頭部零件(av.by.head.meshes,rigid-part rig
// =頭髮+臉都掛頭骨)開一個小 WebGLRenderTarget 拍一張 96×96,readRenderTargetPixels 回讀進 2D
// canvas 快取——**一次性成本**(每個角色只拍一次),不進每幀;v2-hud 之後純 drawImage。
// 相機沿角色當下面向擺(actor 前方=local +Z=世界 (sin rotY, 0, cos rotY)),拍到的是正臉,
// 與頭骨的骨軸慣例無關(骨局部軸每個 GLB rig 都不一樣,走世界空間烘焙最穩)。
// 退路:?avatar=0 / GLB 載失敗 / 讀回錯誤 → 2D 風格化臉(陣營色邊框+Q 版臉),永不空白。
// perf:temp scene 的 clone 共用原幾何/材質(不 dispose 共用資源),rt 拍完即 dispose;
// 快照完成前 v2-hud 畫佔位框=不會有「第一幀卡住等拍照」的問題(拍照本身 <10ms,一次性)。
import { game } from './state.js';
import { renderer } from './render-core.js';
import { actorOf } from './render-actors.js';
import { avatarEnabled } from './actor-avatar.js';

const SZ = 96;                      // 頭像解析度(卡上顯示 ~56px,96 留 dpr 餘裕)
const FALLBACK_AFTER = 8;           // avatar 開啟但遲遲沒建好(載失敗等):game.time 超過此秒數退 2D 臉
const cache = new Map();            // pid → { canvas, kind: 'glb' | '2d' }

/* ==== 2D 風格化臉(退路;陣營色邊框 + Q 版臉) ==== */
function draw2dFace(color) {
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const x = c.getContext('2d');
  x.fillStyle = '#141a26'; x.fillRect(0, 0, SZ, SZ);
  x.fillStyle = color; x.fillRect(0, 0, SZ, SZ * 0.30);                  // 髮
  x.fillStyle = '#e8c9a8'; x.fillRect(SZ * 0.16, SZ * 0.24, SZ * 0.68, SZ * 0.56); // 臉
  x.fillStyle = '#17101c';
  x.fillRect(SZ * 0.30, SZ * 0.46, SZ * 0.10, SZ * 0.13);               // 眼
  x.fillRect(SZ * 0.60, SZ * 0.46, SZ * 0.10, SZ * 0.13);
  return c;
}

/* ==== GLB 頭部快照 ==== */
const _bb = new THREE.Box3(), _ctr = new THREE.Vector3(), _sz = new THREE.Vector3();
const _clr = new THREE.Color();
function snapshotHead(g, av) {
  // temp scene 放**整隻 avatar**(臉/眼不一定掛頭骨——實測 by.head.meshes 只有頭髮零件,
  // 臉在別的骨下;整隻放進去、相機取景框在頭部區,拍到臉+一點肩膀=自然的頭像構圖)。
  const temp = new THREE.Scene();
  let headOnly = null;
  av.wrap.traverse(m => {
    if (!m.isMesh) return;
    if (m.userData.__equip || m.userData.__shockbone) return;   // 裝備/觸電骨架不入鏡
    for (let p2 = m; p2 && p2 !== av.wrap; p2 = p2.parent) if (!p2.visible) return;   // 隱藏零件(rigged 手備料等)跳過
    const c = new THREE.Mesh(m.geometry, m.material);   // 世界矩陣烘焙 clone(共用幾何/材質,零拷貝)
    c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld);
    temp.add(c);
    if (av.by.head && av.by.head.meshes.includes(m)) (headOnly = headOnly || new THREE.Box3()).expandByObject(c);
  });
  temp.updateMatrixWorld(true);
  _bb.setFromObject(temp); if (_bb.isEmpty()) return null;
  if (headOnly && !headOnly.isEmpty()) { headOnly.getCenter(_ctr); headOnly.getSize(_sz); }
  else {                                          // 無頭骨零件:取全身 bbox 頂端 1/4 當頭部區
    _bb.getSize(_sz); _bb.getCenter(_ctr);
    _ctr.y = _bb.max.y - _sz.y * 0.125; _sz.set(_sz.x, _sz.y * 0.25, _sz.z);
  }
  const dim = Math.max(_sz.x, _sz.y, _sz.z);
  // 構圖=半身像(髮+肩;掃描 8 方位×4 俯仰實測:base-avatar 素體無五官,任何角度都是色塊,
  // 平視+取景點下移的半身構圖最像「頭像」;之後換有臉的模型,同一構圖自動拍到臉)。
  const fx = -Math.sin(g.rotation.y), fz = -Math.cos(g.rotation.y);      // 臉朝向=actor local −Z
  _ctr.y -= dim * 0.2;                                                   // 取景點下移=露肩
  const cam = new THREE.PerspectiveCamera(28, 1, dim * 0.1, dim * 20);
  cam.position.set(_ctr.x + fx * dim * 2.6, _ctr.y, _ctr.z + fz * dim * 2.6);
  cam.lookAt(_ctr);
  temp.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 0.75);
  dl.position.copy(cam.position); dl.position.y += dim; temp.add(dl);

  const rt = new THREE.WebGLRenderTarget(SZ, SZ);
  renderer.getClearColor(_clr); const pa = renderer.getClearAlpha();     // 保存主場景清色
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);                                   // 透明底(卡片自己鋪底色)
  renderer.clear();
  renderer.render(temp, cam);
  const buf = new Uint8Array(SZ * SZ * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, buf);
  renderer.setRenderTarget(null);
  renderer.setClearColor(_clr, pa);
  rt.dispose();

  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const x = c.getContext('2d');
  const img = x.createImageData(SZ, SZ);
  for (let row = 0; row < SZ; row++)                                     // GL 讀回是上下顛倒的,翻回來
    img.data.set(buf.subarray(row * SZ * 4, (row + 1) * SZ * 4), (SZ - 1 - row) * SZ * 4);
  x.putImageData(img, 0, 0);
  return c;
}

// 每幀由 v2-hud 呼叫(有快取即回;無=嘗試拍/退路)。回 null=還在等 avatar → 呼叫方畫佔位框。
export function getPortrait(e, color) {
  const hit = cache.get(e.pid);
  if (hit) return hit;
  const g = actorOf(e), av = g && g.userData.avatar;
  if (av) {
    let c = null;
    try { c = snapshotHead(g, av); } catch (err) { /* SwiftShader/讀回罕例 → 退 2D */ }
    const out = c ? { canvas: c, kind: 'glb' } : { canvas: draw2dFace(color), kind: '2d' };
    cache.set(e.pid, out); return out;
  }
  if (!avatarEnabled() || game.time > FALLBACK_AFTER) {                  // 方塊人模式/載入失敗:2D 臉
    const out = { canvas: draw2dFace(color), kind: '2d' };
    cache.set(e.pid, out); return out;
  }
  return null;                                                           // avatar 還在載:先畫佔位框
}
export function resetPortraits() { cache.clear(); }                      // 換模型/重開時清快取
