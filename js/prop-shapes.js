// prop-shapes.js — ugc-5:**程序化道具外觀**(用 three.js 基本幾何堆出來,不吃 GLB)。
//
// 為什麼(使用者 2026-08-01 試玩回饋「客製化角色非常醜,還是最喜歡原本的方塊人,很可愛」的延伸):
// 角色是低多邊形色塊,GLB 道具是照相寫實貼圖的華麗模型——實測風格差距是可量的:
//   角色:MeshStandardMaterial + vertexColors + roughness .85 + metalness 0 + **無貼圖**,
//         配色 s .60~.75 / l .38~.69,全身 24641 面
//   火帽:1 材質 + **照相 JPEG map + emissiveMap**,比頭還小的物件卻 6028 面
//   手套:同上,10140 面
// 戴在角色身上=兩個美術世界硬拼。這裡把「戴/拿的道具」改成跟角色同一份語言的程序化幾何。
//
// **風格契約**(改道具照這條走,別破):
//   ① MeshStandardMaterial、roughness 0.85、metalness 0 —— 霧面、非金屬
//   ② **無 map / 無 emissiveMap** —— 只有平塗色;要發光用 emissive 純色(火口/渦輪核心)
//   ③ 低多邊形:radialSegments ≤ 10、球用 (8,4)、環用 (6,8);大塊少件,遠鏡頭讀得出剪影
//   ④ **配色要選在 l 0.30~0.50、s ≥ 0.70**——這條是量出來的,不是品味:
//      lab 是 ACESFilmic + 曝光 1.16,實測 source→rendered 的飽和保留率隨明度暴跌
//      (scratchpad/curve.mjs:l .31→留 68%、l .50→61%、l .58→43%、l .69→32%、l .82→**只留 14%**),
//      而暗色明度被提亮約 +0.14。所以**亮色一律渲成灰**(f2dcae 奶油 → b8b6a8 灰、46b0d6 天藍 → 79a9af 灰藍),
//      第一版就是踩這個變成一排米黃泥巴。要「亮點/高光」只能用 **emissive**(自發光不吃 tone map 的洗白)。
//
// **正規化慣例**(與 render-core 的 GLB proto 完全相同 → 所有掛載/校準/測試不用改一行):
//   · 戴/放類(帽/桶/瓶):高度正規化到 1、**底貼 y=0**、xz 置中
//   · 繞腕類(手套):最大維度正規化到 1、**正中置心**
//
// perf 鐵則:材質/幾何**建一次快取**(同型道具共用),絕不每幀 new;proto 建好後 caller clone。

// ---- 快取(同一把材質/幾何給所有 clone 共用)----
const _mats = new Map(), _geos = new Map();
function mat(hex, emissiveHex, emissiveInt) {
  const key = `${hex}|${emissiveHex || 0}|${emissiveInt || 0}`;
  let m = _mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0 });
    if (emissiveInt) { m.emissive = new THREE.Color(emissiveHex ?? hex); m.emissiveIntensity = emissiveInt; }
    _mats.set(key, m);
  }
  return m;
}
// 幾何工廠:key 化參數 → 同規格只建一次
function geo(key, make) { let g = _geos.get(key); if (!g) { g = make(); _geos.set(key, g); } return g; }
const cyl = (rt, rb, h, seg) => geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (w, h, d) => geo(`bx${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const sph = (r) => geo(`sp${r}`, () => new THREE.SphereGeometry(r, 8, 4));
const tor = (r, t) => geo(`to${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 8));

// 擺一塊:幾何 + 色 + 位置/旋轉。回傳 mesh(caller add 進 group)。
function part(g, color, x, y, z, rx, ry, rz, emiHex, emiInt) {
  const m = new THREE.Mesh(g, mat(color, emiHex, emiInt));
  m.position.set(x || 0, y || 0, z || 0);
  m.rotation.set(rx || 0, ry || 0, rz || 0);
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

// 正規化到 proto 慣例。mode:'stand'=高=1 底貼 y0 xz 置中 / 'center'=最大維度=1 正中置心。
// 回傳 { group, protoW }(protoW=高=1 基準下的 xz 最大寬;火帽的包覆規則要讀)。
// 註:proto 的 `userData.__*` 辨識旗由 render-core(註冊處)設,與 GLB 那條路同一個位置。
const _nb = new THREE.Box3(), _nv = new THREE.Vector3();
function normalize(inner, mode) {
  const wrap = new THREE.Group();
  wrap.add(inner);
  inner.updateMatrixWorld(true);
  _nb.setFromObject(inner);
  _nb.getSize(_nv);
  const h = _nv.y || 1;
  const cx = (_nb.max.x + _nb.min.x) / 2, cy = (_nb.max.y + _nb.min.y) / 2, cz = (_nb.max.z + _nb.min.z) / 2;
  inner.scale.multiplyScalar(1 / h);
  if (mode === 'center') inner.position.set(-cx / h, -cy / h, -cz / h);
  else inner.position.set(-cx / h, -_nb.min.y / h, -cz / h);
  wrap.updateMatrixWorld(true);
  return { group: wrap, protoW: Math.max(_nv.x, _nv.z) / h };
}

// ===== 噴火帽(item='fire' 戴頭上)=====
// 讀法:橘色圓頂盔 + 奶油帽簷 + 頭頂短煙囪(火從這裡噴)。GLB 版是蒸汽龐克金屬盔,細節多到在
// 3 頭身角色頭上像異物;這版只留「盔+簷+煙囪+火口」四個訊息。
// ⚠ **剪影長寬比要貼齊 GLB 版**:掛載端 item-3c 的包覆規則三取 max,其中「寬度包覆」讀 protoW
//(=高=1 基準下的 xz 最大寬)。GLB 版 protoW≈1.01(近正方),第一版做了大帽簷 protoW=1.275
//   → 世界寬 63.6px vs GLB 51.6(高度兩者都 51=規則③主導),戴上去像大香菇把角色吃掉。
//   所以帽簷最寬處 ≈ 總高,protoW 才會落回 ~1.0。
const FIRE = { body: 0xc44a10, dark: 0x7a2a08, trim: 0xc98a1c, pipe: 0x2b2630, glow: 0xffb04a };
export function makeFireHat() {
  const g = new THREE.Group();
  g.add(part(cyl(0.50, 0.50, 0.07, 10), FIRE.trim, 0, 0.06));             // 帽簷(最寬處=0.5r → protoW≈1)
  g.add(part(cyl(0.41, 0.44, 0.11, 10), FIRE.dark, 0, 0.15));             // 帽帶
  g.add(part(cyl(0.39, 0.42, 0.34, 10), FIRE.body, 0, 0.27));             // 盔身(直筒微下寬)
  g.add(part(cyl(0.32, 0.39, 0.14, 10), FIRE.body, 0, 0.51));             // 收頂
  g.add(part(cyl(0.34, 0.34, 0.05, 10), FIRE.trim, 0, 0.60));             // 頂環(金色細邊)
  g.add(part(cyl(0.10, 0.13, 0.36, 8), FIRE.pipe, 0, 0.81));              // 煙囪(細長才讀得出是噴口)
  g.add(part(cyl(0.13, 0.13, 0.05, 8), FIRE.trim, 0, 0.96));              // 噴口箍
  g.add(part(cyl(0.14, 0.14, 0.05, 8), FIRE.glow, 0, 1.01, 0, 0, 0, 0, FIRE.glow, 1.2)); // 火口(自發光)
  g.add(part(box(0.12, 0.10, 0.11), FIRE.dark, 0.38, 0.27, 0.15));        // 側扣件 ×2
  g.add(part(box(0.12, 0.10, 0.11), FIRE.dark, -0.38, 0.27, 0.15));
  return normalize(g, 'stand');
}

// ===== 風壓手套(item='wind' 戴右手)=====
// 讀法(gaunt-2 重建,對照 GLB Azure Turbine Gauntlet 的三個訊息):①**有手指的拳**(手套=套在手上,
// 不是綁在臂上的方塊)②**手背仰躺的大渦輪**(金環+青色扇葉+發光轂=招牌,面朝 +y)③喇叭袖口。
// ⚠ **軸系要照 GLB proto**:−z=袖口、+z=指節(指尖往 −y 垂)、+y=手背——掛載旋轉(WIND_CAL rot.x=90°)
//   是照 GLB 軸系調的;第一版沿 y 軸搭=軸系錯位,戴上像一根綁在手臂上的管子(使用者抓到)。
// ⚠ 剪影長寬比貼齊 GLB(實測 1.13×1.00×1.78,z=最長軸)——同火帽 protoW 教訓,差太多=尺寸感全錯。
const WIND = { body: 0x1785b0, dark: 0x0d556f, trim: 0x2fa8cc, gold: 0xc08a2a, glow: 0x8fe8ff };
export function makeWindGauntlet() {
  const g = new THREE.Group();
  // 拳(主塊=手背+掌;+z 端)
  g.add(part(box(0.74, 0.52, 0.72), WIND.body, 0, 0.02, 0.28));
  // 四指(沿 x 排開,+z 前緣往 −y 垂;兩節=根+尖)
  for (let i = 0; i < 4; i++) {
    const x = -0.27 + i * 0.18;
    g.add(part(box(0.15, 0.32, 0.20), WIND.dark, x, -0.24, 0.70));         // 指根(垂下)
    g.add(part(box(0.13, 0.16, 0.15), WIND.body, x, -0.44, 0.74));         // 指尖
    g.add(part(box(0.14, 0.10, 0.07), WIND.gold, x, 0.00, 0.82));          // 指節金牌(GLB 招牌細節)
  }
  // 拇指(−x 側貼著拳側)
  g.add(part(box(0.18, 0.22, 0.32), WIND.dark, -0.48, -0.10, 0.26));
  g.add(part(box(0.15, 0.18, 0.16), WIND.body, -0.50, -0.24, 0.44));
  // 手背大渦輪(仰躺面朝 +y:金環 + 四葉青色扇 + 發光轂)
  g.add(part(tor(0.30, 0.07), WIND.gold, 0, 0.34, 0.22, Math.PI / 2));     // 金屬環(環面朝上)
  for (let i = 0; i < 4; i++) {                                             // 扇葉(躺平,繞 y 排)
    const a = i * Math.PI / 2 + 0.5;
    g.add(part(box(0.26, 0.05, 0.11), WIND.trim, Math.cos(a) * 0.14, 0.33, 0.22 + Math.sin(a) * 0.14, 0, -a, 0, WIND.glow, 0.8));
  }
  g.add(part(cyl(0.09, 0.09, 0.10, 8), WIND.gold, 0, 0.36, 0.22));          // 轂
  g.add(part(sph(0.06), WIND.glow, 0, 0.42, 0.22, 0, 0, 0, WIND.glow, 1.5)); // 轂心(自發光)
  // 腕橋 + 喇叭袖口(−z 端;沿 z 的錐筒=rx 90° 後 rBottom 端朝 −z=粗口在後)
  g.add(part(cyl(0.26, 0.29, 0.24, 8), WIND.body, 0, 0.04, -0.18, Math.PI / 2));
  g.add(part(cyl(0.28, 0.40, 0.42, 8), WIND.dark, 0, 0.06, -0.52, Math.PI / 2));
  g.add(part(cyl(0.42, 0.42, 0.09, 8), WIND.gold, 0, 0.06, -0.76, Math.PI / 2)); // 袖口金箍
  g.add(part(box(0.10, 0.24, 0.28), WIND.trim, 0.31, 0.06, -0.52, 0, 0, 0, WIND.glow, 0.5)); // 袖筒發光縱條 ×2(GLB 的青色格柵)
  g.add(part(box(0.10, 0.24, 0.28), WIND.trim, -0.31, 0.06, -0.52, 0, 0, 0, WIND.glow, 0.5));
  return normalize(g, 'center');
}

// ===== 爆桶(扛/丟)=====
// 讀法:橘桶 + 上下箍 + 中央警示帶。
const BARREL = { body: 0xd15c1c, hoop: 0x8c3312, cap: 0xc98a1c, warn: 0x241f28 };
export function makeBarrelProp() {
  const g = new THREE.Group();
  g.add(part(cyl(0.36, 0.36, 0.88, 10), BARREL.body, 0, 0.44));
  g.add(part(cyl(0.385, 0.385, 0.08, 10), BARREL.hoop, 0, 0.16));         // 下箍
  g.add(part(cyl(0.385, 0.385, 0.08, 10), BARREL.hoop, 0, 0.72));         // 上箍
  g.add(part(cyl(0.375, 0.375, 0.16, 10), BARREL.warn, 0, 0.44));         // 警示帶
  g.add(part(cyl(0.37, 0.37, 0.07, 10), BARREL.cap, 0, 0.90));            // 頂蓋
  return normalize(g, 'stand');
}

// ===== 元素瓶(冰/油;扛/丟/砸碎)=====
// 讀法:元素色瓶身 + 肩 + 頸 + 奶油瓶蓋。冰瓶帶一點自發光(場上要看得見)。
// 冰瓶靠 emissive 撐「冰藍發光」(平塗亮藍會被洗成灰);油瓶是暗色本來就吃得住。
const BOTTLE = {
  ice: { body: 0x2596bd, dark: 0x11536e, glow: 0x9fe4f7, emi: 0.55 },
  oil: { body: 0x6b5a2c, dark: 0x3d3316, glow: 0x000000, emi: 0 },
};
export function makeBottleProp(elem) {
  const C = BOTTLE[elem] || BOTTLE.ice;
  const g = new THREE.Group();
  g.add(part(cyl(0.27, 0.29, 0.54, 8), C.body, 0, 0.27, 0, 0, 0, 0, C.glow, C.emi));  // 瓶身
  g.add(part(cyl(0.13, 0.27, 0.18, 8), C.body, 0, 0.63, 0, 0, 0, 0, C.glow, C.emi));  // 肩
  g.add(part(cyl(0.11, 0.11, 0.16, 8), C.dark, 0, 0.80));                              // 頸
  g.add(part(cyl(0.145, 0.145, 0.10, 8), BARREL.cap, 0, 0.93));                        // 瓶蓋
  g.add(part(cyl(0.30, 0.30, 0.06, 8), C.dark, 0, 0.05));                              // 底座
  return normalize(g, 'stand');
}
