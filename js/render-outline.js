// render-outline.js — ui-2:**輪廓線身分標記**(`?mark=outline`;使用者 2026-08-03 提案,參考百變恰吉
// 「連箭頭都不給,只留身體輪廓線」)。
//
// 為什麼可行:開場結束後 `updateCamRig` 的目標是 `fighters[LOCAL]` → **你永遠在畫面中央**,
// 「誰是我」有一半由鏡頭本身回答;輪廓線只要再補一層確認就夠,不需要浮在頭上的 UI。
//
// ⚠⚠ **Fresnel 邊緣光試過、量測後否決**(別再走回頭路):`onBeforeCompile` 注入 rim 是最省成本的做法
//   (零 draw call),但實測**在實戰機位 dist 630 讀不出來**——角色只有 ~90px 高,fresnel 那條邊隨距離
//   一起縮;把強度推到讀得到(str 2.6)時角色整隻泛白、**反而把「隊伍色」這個真正的身分訊號洗掉**。
//   反殼描邊的線寬是**世界空間常數**,遠鏡頭下才活得下來,所以最後走這條。
//
// 做法:每個身體網格加一個**同心放大的子網格**(共用 geometry、`side: BackSide`、不吃光的 MeshBasic)。
// 背面在原網格之後才通過深度測試 → 只會從剪影邊緣露出一圈 = 輪廓線。方塊人是 ~20 個獨立方塊,
// 所以連關節內縫也會描一圈(線稿模型組的味道),這是這個做法的必然,不是 bug。
// perf:+~20 draw call/角色(只給有 pid 的 v2 角色);FX_LOW(手機)整組關掉。
//
// ⚠ **avatar(蒙皮)不套**:反殼要沿法線外推,SkinnedMesh 的子網格不會跟著骨頭走,得複製骨架+改 shader,
//   成本與風險都跳一級。方塊人是預設角色(ugc-6),A/B 先只做這條;avatar 模式維持頭頂浮標。
// ⚠ 跳過裝備/特效網格(火帽/手套/電鞭/冰塊/影子…):它們有自己的視覺語言,描邊只會變吵。

// ⚠ DAG:render 家族**不 import v2-state**(沒有先例,會讓 render 依賴 v2 模擬家族)。隊伍色/本機 pid
//   由 v2.js 開機注入,照 `setGroundMarkers`/`setStationsPowered` 那套 setter 慣例。
let _teams = ['#6fb7ff', '#ff6b6b'], _local = 0;
export function setRimTeams(colors, local) { if (colors) _teams = colors; _local = local | 0; }

const q = new URLSearchParams(location.search).get('mark');
export const MARK_MODE = q === 'outline' || q === 'none' || q === 'arrow' ? q : 'arrow'; // 預設維持頭頂浮標(ui-1)
export const RIM_ON = MARK_MODE === 'outline';

// 旋鈕:width=**世界空間固定線寬**(px)、color=線色(null=用隊伍色)、alpha、maxGrow=薄片夾制。
// ⚠ 四個踩過的坑,都會讓線「明明建出來了卻看不見」:
//   ① **線寬不能用百分比放大**(scale×1.17):粗軀幹 22px 撐出 1.9px、細肢 6px 只撐出 0.5px=次像素。
//      要照父網格的實際尺寸反算每軸的放大率,線寬才會處處一致。
//   ② **線色不能跟身體同明度**:第一版往白色拉 85% → 角色本身就是近白的淺藍,線貼在身上等於沒對比
//      (使用者 2026-08-03 回報「輪廓線不太明顯」)。線是畫在**剪影外面**,要同時贏過兩個東西:
//      深色地板(所以不能用暗線)+ 淺色身體(所以不能用白線)→ **飽和的隊伍色**才兩邊都跳得出來。
//   ③ **描邊材質要 `toneMapped = false`**:lab 是 ACES+曝光 1.16,飽和亮色會被 tone map 洗掉
//      (ugc-5 量過:l .82 只剩 14% 飽和)。關掉 tone map 才是「所見即所填」的 UI 級純色。
//   ④ 細肢只有 6px 寬,線寬 3.2 就等於半條腿=白霧;2 左右是「明顯但仍是線」的甜蜜點。
//   對手預設不描(width 0)——「只有你有線」這個不對稱本身就是最省事的身分訊號(恰吉即此路)。
export const RIM = {
  me: { width: 2.0, color: '#2f6bff', alpha: 1, maxGrow: 1.7 },   // 飽和藍:比地板亮、比身體濃
  foe: { width: 0, color: null, alpha: 0.6, maxGrow: 1.7 },
};

const SKIP_FLAGS = ['__equip', '__hat', '__gauntlet', '__whip', '__frost', '__barrel', '__shockbone', '__burnfx', '__hatflame', '__sprayfx', '__outline'];
const _mats = new Map();                                  // 隊伍色 → 共用描邊材質(不每幀 new)
function hullMat(hex, cfg) {
  const c = cfg.color || hex;
  const key = c + '|' + cfg.alpha;
  let m = _mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide, transparent: cfg.alpha < 1, opacity: cfg.alpha, depthWrite: false });
    m.toneMapped = false;                       // ⚠ 見表頭 ③:不關掉的話 ACES 會把飽和線色洗成灰
    _mats.set(key, m);
  }
  return m;
}

let _low = false;
export function setOutlineLow(low) { _low = !!low; }      // FX_LOW(手機)整組關

// 除錯 hook(同 __lab/__hud/__shock 慣例):線上出問題時在 console 打 `__outline()` 一行問出全部答案。
// 回傳:mode=URL 旗實際收到什麼、on=有沒有開、low=是不是被 FX_LOW 關掉、hulls=場上描邊殼數量。
if (typeof window !== 'undefined') {
  window.__outline = () => {
    let hulls = 0;
    const sc = window.__lab && __lab.labGroup && __lab.labGroup.parent;
    if (sc) sc.traverse(o => { if (o.userData && o.userData.__hull) hulls++; });
    return { mode: MARK_MODE, on: RIM_ON, low: _low, hulls, raw: location.search, width: RIM.me.width };
  };
}

// 每幀由 render-actors 的 updateActor 尾端呼叫(便宜:已建好就直接 return)。
// 網格數變了(avatar/裝備非同步就緒)才重掃,同火帽/手套的 async 重掛慣例。
export function applyRimOutline(e, g) {
  if (!RIM_ON || _low || e.pid == null) return;           // 單機敵人沒有 pid=不套
  let n = 0; g.traverse(o => { if (o.isMesh) n++; });
  if (g.userData.__rimN === n) return;                    // 網格數沒變=沒有新東西要描
  g.userData.__rimN = n;
  const isMe = e.pid === _local, cfg = isMe ? RIM.me : RIM.foe;
  if (!(cfg.width > 0)) return;                           // width 0 = 這一方不描線
  const mat = hullMat(_teams[e.pid] || _teams[0], cfg);
  const targets = [];
  g.traverse(o => {
    if (!o.isMesh || !o.geometry || o.isSkinnedMesh) return;          // 蒙皮不套(見表頭)
    if (o.userData.__hull || o.userData.__outline) return;            // 自己就是描邊殼
    if (SKIP_FLAGS.some(f => o.userData[f])) return;                  // 裝備/特效不描邊
    if (o.material && o.material.transparent) return;                 // 影子橢圓/發光球
    if (o.children.some(c => c.userData.__hull)) return;              // 已經有殼
    targets.push(o);
  });
  for (const o of targets) {
    const h = new THREE.Mesh(o.geometry, mat);
    // 固定線寬:父網格每軸的世界尺寸 = |scale|(box/sphere 幾何是單位大小)→ 放大率 = 1 + 2·width/尺寸
    // ⚠ 薄片網格(眼睛/腰帶/領口那種厚度 0.02 的板)會讓 1+2w/s 爆成上千倍 → 畫面出現巨大白板;
    //   夾在 maxGrow 以內(那些薄片的線會比例上粗一點,但不會炸)。
    const G = (sc) => Math.min(cfg.maxGrow, 1 + cfg.width * 2 / (Math.abs(sc) || 1));
    h.scale.set(G(o.scale.x), G(o.scale.y), G(o.scale.z));
    h.userData.__hull = true; h.userData.__outline = true;            // 讓 tint/頭像/掃描各路跳過
    h.castShadow = false; h.receiveShadow = false; h.renderOrder = -1;
    o.add(h);
  }
}
