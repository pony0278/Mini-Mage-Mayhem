// actor-brawler.js — v2 收容測試的關節化體素小人:骨架移植自使用者的 PUNCH STUDIO 動作編排器
// (root→pelvis→腿[髖/膝];root→spine→肩/肘/腕+headPivot),吃編排器的 47 軸姿勢格式。
// 「改模型 = 改 BRAWLER_SPEC;改動作 = 改 brawler-clips.js 的 CLIPS(編排器 JSON 直貼)」。
// 屬 render 層(由 render-actors 呼叫);模擬層透過 fighter 欄位(punchFx/punchKind/punchArm/
// flinch*/carrying/stunned...)驅動,永不 import 這裡(sim 保持 headless)。
import { game } from './state.js';
import { makeBox } from './render-core.js';
import { CLIPS, PUNCH_CLIPS, COMBAT_IDLE, POSE_KEYS, evalClip, normalizePose } from './brawler-clips.js';
import { avatarEnabled, avatarReady, buildAvatar, retargetAvatar } from './actor-avatar.js';
import { handsReady, getHandMesh } from './actor-hands.js';
import { setRiggedHandsVisible } from './actor-hands-rigged.js';

// ===== 建模規格表:尺寸/位置(世界 px)/配色。關節鏈長 Lu/Ll(腿)、Au/Al(臂)給自動踩地/組裝用 =====
export const BRAWLER_SPEC = {
  colors: { limbShade: 0.68, paleLighten: 0.42, eye: 0x17101c, glow: 0.06 },
  hipY: 14, hipX: 5.4,
  thigh: { w: 7, h: 7.5, d: 8 }, shin: { w: 6.2, h: 6.5, d: 7.2 },      // Lu=7.5, Ll=6.5
  foot: { w: 6.6, h: 2.6, d: 8.6, fwd: 1.4, shade: 0.45 },               // 腳掌(踝下小靴,略前伸;shade=底色暗度)。站高因此 +h(applyBrawlerPose 抬 root)
  torso: { w: 22, h: 18, d: 13, cy: 9 },                                 // spine-local 中心(世界 y23)
  shoulderPad: { x: 13.2, y: 16.5, w: 7, h: 5.5, d: 9 },                 // 裝飾肩甲(spine-local)
  armX: 14, armY: 15,                                                    // 肩軸(spine-local;世界 y29)
  upperArm: { w: 6, h: 7, d: 7 }, foreArm: { w: 5.2, h: 6.5, d: 6.2 },   // Au=7, Al=6.5
  fist: { w: 8.4, h: 7.2, d: 8.4, dropY: -2.8 },
  headPivotY: 18,                                                        // spine-local(世界 y32=軀幹頂)
  head: { w: 14.5, h: 13, d: 13.5, cy: 7.5 }, hair: { w: 15.2, h: 4.5, d: 14.2, cy: 15.5 },
  eye: { x: 3.5, cy: 8.5, z: 6.9, w: 3, h: 3.6, d: 1.2 },
  PX: 25,   // 編排器 1 世界單位 ≈ 25px(root_pz/root_py/head_pz 的換算)
};

// ===== 程序動作參數表(clips 之外的狀態:走路/被扛/扛人/暈眩/受擊)=====
export const ANIM = {
  blend:   { rate: 14, clipRate: 40 },                                                     // 姿勢平滑:每秒收斂速率(消除狀態切換瞬跳)。clip 播放用高檔(clip 內插已滑,低通會削掉快速關鍵幀=浮誇動作被壓扁;頭尾皆 COMBAT_IDLE 故無接縫風險)
  walk:    { minDisp: 0.25, maxDisp: 6, phaseRate: 0.18, ampEase: 0.2, legSwing: 34, armSwing: 22, kneeAdd: 18, bob: 1.6 }, // 度
  run:     { lean: 16, swingMul: 1.5, armMul: 1.7, kneeMul: 1.45, bobMul: 1.4, elbow: 78 }, // 程序跑姿(無 run_cycle clip 時):前傾+擺幅放大+屈肘泵臂(elbow=跑步手肘彎曲度,直臂甩=走路感的元兇);步頻吃位移自動變快
  // CLIPS.run_cycle 循環槽:一個循環=幾 px 位移(位移驅動相位)。**stridePx 要對齊腳的實際觸地掃程**,
  // 否則=滑步:掃程 ≈ 2×2×腿長14×sin(髖擺幅)——髖 ±60° ≈ 48px/循環。96 時滑步率 50%(看起來像溜冰,踩過的坑);
  // 60 ≈ 20% 滑步(可接受的風格化)。想要大步幅+慢步頻:studio 加大髖擺/觸地幀 lX_stretch 伸腿,再回調此值。
  // bob=踩地感彈跳(PS 單位 ×25px):循環相位驅動 root_py,觸地幀(key)低、過渡點高=每步一跳;0=關。
  runClip: { stridePx: 108, bob: 0.3 },
  breath:  { rate: 2.6, knee: 72, elbow: 45, shoulder: 7, chest: 5 },                       // 待機呼吸(浮誇單向脈動,週期≈2.4s=有活力):腿 直↔深蹲(squat 帶髖+膝)+ 手臂肘 直↔彎(ex)+ 肩微開 + 含胸;走路時淡出。rate 大=快
  carried: { kickRate: 11, legAmp: 30, armBase: -140, armAmp: 25, armRateMul: 0.7, wobRate: 7, wobAmp: 0.16 },
  carry:   { armSx: -135, armEx: 12 },                                                     // 扛人:雙臂高舉過頭
  barrelHold: { // 扛桶:雙臂舉過頭托住桶(使用者 studio 定稿的過頂 hold 姿勢;軸名→值直接蓋在站姿上,含腕/手指)
    aL_sx: -79, aL_sy: 64, aL_sz: 105, aL_ex: 0, aL_wx: 50, aL_wy: 0, aL_stretch: 1.91,
    aR_sx: -79, aR_sy: -65, aR_sz: 101, aR_ex: 0, aR_wx: 63, aR_wy: 10, aR_stretch: 1.91,
    aL_fbase: -49, aL_fmid: 0, aL_ftip: 0, aL_fthumb: 0,
    aR_fbase: -48, aR_fmid: 0, aR_ftip: 0, aR_fthumb: 0,
  },
  stun:    { wobRate: 9, wobAmp: 0.14, slump: 18 },                                        // 暈眩:搖晃+垮肩駝背
  thrown:  { lift: 8, rate: 10 },                                                          // 被丟打橫:趴姿抬高(半個身厚,免沉地)/ 站起↔趴下的平滑速率
  heldBarrel: { liftK: 0.9 },                                                              // 扛桶/瓶:物心抬高 = 邊長×此係數(0.5=底貼掌心;45° 俯視鏡頭下要再高些頭才不被蓋)
  guard: { // 按住防禦:使用者 studio 定稿的舉防定格(guard 幀非零軸→值直接蓋在戰鬥站姿上;側身含胸、右臂高舉護頭、左臂護體、屈膝穩樁)
    spine_x: -13, spine_y: -86, pelvis_y: -63,
    aL_sx: 20, aL_sy: 8, aL_sz: 13, aL_ex: 96,
    aR_sx: -66, aR_sy: 60, aR_sz: 68, aR_ex: 145, aR_wx: -5, aR_wy: 105, aR_stretch: 2.18,
    lL_hy: 56, lL_hz: -30, lL_kx: 81, lL_ax: 60, lL_ty: -22, lL_scale: 1.09, lL_stretch: 1.09,
    lR_hx: 27, lR_hy: -67, lR_hz: 9, lR_kx: -11, lR_ax: 32,
  },
  flinch:  { window: 0.22, tip: 0.55, squashXZ: 0.15, squashY: 0.2 },
};

function shadeHex(h, m) {
  const r = Math.min(255, Math.round((h >> 16 & 255) * m)), g = Math.min(255, Math.round((h >> 8 & 255) * m)), b = Math.min(255, Math.round((h & 255) * m));
  return (r << 16) | (g << 8) | b;
}
function lightenHex(h, t) {
  const r = Math.round((h >> 16 & 255) + (255 - (h >> 16 & 255)) * t), g = Math.round((h >> 8 & 255) + (255 - (h >> 8 & 255)) * t), b = Math.round((h & 255) + (255 - (h & 255)) * t);
  return (r << 16) | (g << 8) | b;
}
const grp = (parent, x, y, z = 0) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };

// 組裝:編排器骨架階層。g(=render-actors 給的實體根)→ P(姿勢根:root 旋轉/擠壓)
//   → pelvis → 髖L/R → 膝 → 小腿;→ spine → 軀幹/肩甲/肩L/R → 肘 → lm(前臂+腕+拳,命中放大)
export function buildBrawler(g, tints, tintable, base) {
  const S = BRAWLER_SPEC, C = S.colors;
  const limb = shadeHex(base, C.limbShade), pale = lightenHex(base, C.paleLighten);
  const P = grp(g, 0, 0);
  const pelvis = grp(P, 0, S.hipY);
  const mkLeg = (side) => {
    const hp = grp(pelvis, side * S.hipX, 0);
    const th = makeBox(S.thigh.w, S.thigh.h, S.thigh.d, limb); th.position.y = -S.thigh.h / 2; hp.add(th);
    const kn = grp(hp, 0, -S.thigh.h);
    const lm = grp(kn, 0, 0);                                            // 小腿+腳的放大群組(命中放大,對齊編排器 legL.lm → lL_scale)
    const sh = makeBox(S.shin.w, S.shin.h, S.shin.d, limb); sh.position.y = -S.shin.h / 2; lm.add(sh);
    const ankle = grp(lm, 0, -S.shin.h);                                 // 踝關節(lL_ax/lL_ty + 自動壓平/墊腳;avatar foot driver 也吃這節點)
    const foot = makeBox(S.foot.w, S.foot.h, S.foot.d, shadeHex(base, S.foot.shade)); foot.position.set(0, -S.foot.h / 2, S.foot.fwd); ankle.add(foot);
    return { hp, kn, lm, ankle, side };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const spine = grp(P, 0, S.hipY);
  const torso = tintable(g, tints, makeBox(S.torso.w, S.torso.h, S.torso.d, base, base, C.glow)); torso.position.y = S.torso.cy; spine.add(torso);
  for (const sd of [-1, 1]) { const pad = makeBox(S.shoulderPad.w, S.shoulderPad.h, S.shoulderPad.d, limb); pad.position.set(sd * S.shoulderPad.x, S.shoulderPad.y, 0); spine.add(pad); }
  const mkArm = (side) => {
    const sh = grp(spine, side * S.armX, S.armY);
    const ua = makeBox(S.upperArm.w, S.upperArm.h, S.upperArm.d, limb); ua.position.y = -S.upperArm.h / 2; sh.add(ua);
    const el = grp(sh, 0, -S.upperArm.h);
    const lm = grp(el, 0, 0);                                            // 前臂+拳的放大群組(命中放大)
    const fa = makeBox(S.foreArm.w, S.foreArm.h, S.foreArm.d, limb); fa.position.y = -S.foreArm.h / 2; lm.add(fa);
    const wr = grp(lm, 0, -S.foreArm.h);
    const fist = makeBox(S.fist.w, S.fist.h, S.fist.d, pale); fist.position.y = S.fist.dropY; wr.add(fist);
    return { sh, el, lm, wr, fist, side };
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const headPivot = grp(spine, 0, S.headPivotY);
  const head = makeBox(S.head.w, S.head.h, S.head.d, pale); head.position.y = S.head.cy; headPivot.add(head);
  const hair = tintable(g, tints, makeBox(S.hair.w, S.hair.h, S.hair.d, base, base, C.glow)); hair.position.y = S.hair.cy; headPivot.add(hair);
  for (const sd of [-1, 1]) { const e = makeBox(S.eye.w, S.eye.h, S.eye.d, C.eye); e.position.set(sd * S.eye.x, S.eye.cy, S.eye.z); headPivot.add(e); }
  g.userData.rig = { P, pelvis, spine, headPivot, legL, legR, armL, armR };
}

const D2R = Math.PI / 180;
const HEEL_LIFT = 55 * D2R;   // contact=1 墊腳抬跟量(正 ankle.x=趾下跟上;同編排器)
// 47 軸姿勢 → 骨架(編排器 applyPose 的移植;度→弧度、編排器單位→px)。
// 自動踩地:用髖/膝有效角算腿的垂直壓縮,root 跟著下沉(contact=2 的腿不當錨點)。
export function applyBrawlerPose(rig, p) {
  const S = BRAWLER_SPEC, Lu = S.thigh.h, Ll = S.shin.h;
  const R = rig;
  R.P.rotation.set((p.root_x || 0) * D2R, (p.root_y || 0) * D2R, 0);
  const sq = p.sq || 0;
  let sx = 1, sy = 1, sz = 1;
  if (sq >= 0) { sy = 1 - sq; sx = sz = 1 / Math.sqrt(Math.max(sy, 0.1)); }
  else { sz = 1 - sq; sx = sy = 1 / Math.sqrt(Math.max(sz, 0.1)); }
  const bs = p.body_scale || 1;
  R.P.scale.set(sx * bs, sy * bs, sz * bs);
  R.spine.rotation.set((p.spine_x || 0) * D2R, (p.spine_y || 0) * D2R, 0);
  R.pelvis.rotation.y = (p.pelvis_y || 0) * D2R;
  R.headPivot.rotation.set((p.head_x || 0) * D2R, (p.head_y || 0) * D2R, 0);
  R.headPivot.position.z = (p.head_pz || 0) * S.PX;
  const aLw = 1 - (p.aL_idle || 0), aRw = 1 - (p.aR_idle || 0);
  const lLw = 1 - (p.lL_idle || 0), lRw = 1 - (p.lR_idle || 0);
  R.armL.sh.rotation.set((p.aL_sx || 0) * aLw * D2R, (p.aL_sy || 0) * aLw * D2R, (p.aL_sz || 0) * aLw * R.armL.side * D2R);
  R.armL.el.rotation.x = -(p.aL_ex || 0) * aLw * D2R;      // 負號:正值=手肘往前彎(解剖正確)
  R.armR.sh.rotation.set((p.aR_sx || 0) * aRw * D2R, (p.aR_sy || 0) * aRw * D2R, (p.aR_sz || 0) * aRw * R.armR.side * D2R);
  R.armR.el.rotation.x = -(p.aR_ex || 0) * aRw * D2R;
  R.armL.wr.rotation.set((p.aL_wx || 0) * aLw * D2R, (p.aL_wy || 0) * aLw * D2R, 0);
  R.armR.wr.rotation.set((p.aR_wx || 0) * aRw * D2R, (p.aR_wy || 0) * aRw * D2R, 0);
  const sqd = p.squat || 0;    // 蹲下 macro:膝 +squat、髖 -0.7×squat
  const hxL = (p.lL_hx || 0) - sqd * 0.7, kxL = (p.lL_kx || 0) + sqd;
  const hxR = (p.lR_hx || 0) - sqd * 0.7, kxR = (p.lR_kx || 0) + sqd;
  R.legL.hp.rotation.set(hxL * lLw * D2R, (p.lL_hy || 0) * lLw * R.legL.side * D2R, (p.lL_hz || 0) * lLw * R.legL.side * D2R);
  R.legL.kn.rotation.x = kxL * lLw * D2R;
  R.legR.hp.rotation.set(hxR * lRw * D2R, (p.lR_hy || 0) * lRw * R.legR.side * D2R, (p.lR_hz || 0) * lRw * R.legR.side * D2R);
  R.legR.kn.rotation.x = kxR * lRw * D2R;
  // 踝(鏡射編排器):自動壓平(抵消髖+膝,腳掌保持水平)+ lL_ax 額外微調;lL_ty=腳尖朝向(踝 Y,×side 正=外八)
  R.legL.ankle.rotation.set((-(hxL + kxL) + (p.lL_ax || 0)) * lLw * D2R, (p.lL_ty || 0) * lLw * R.legL.side * D2R, 0);
  R.legR.ankle.rotation.set((-(hxR + kxR) + (p.lR_ax || 0)) * lRw * D2R, (p.lR_ty || 0) * lRw * R.legR.side * D2R, 0);
  const cL = Math.round(p.lL_contact || 0), cR = Math.round(p.lR_contact || 0);
  if (cL === 1) R.legL.ankle.rotation.x += HEEL_LIFT * lLw;             // contact=1:墊腳(跟上趾下,同編排器)
  if (cR === 1) R.legR.ankle.rotation.x += HEEL_LIFT * lRw;
  R.armL.lm.scale.setScalar(p.aL_scale || 1);
  R.armR.lm.scale.setScalar(p.aR_scale || 1);
  R.legL.lm.scale.setScalar(p.lL_scale || 1);                           // 小腿/腳掌命中放大(對齊編排器 legL.lm)
  R.legR.lm.scale.setScalar(p.lR_scale || 1);
  // 整肢伸展:肩/髖節點等比放大 → 整條手臂/腿從近端關節變長變大(遠鏡頭下伸手更明顯)
  const asL = p.aL_stretch || 1, asR = p.aR_stretch || 1, lsL = p.lL_stretch || 1, lsR = p.lR_stretch || 1;
  R.armL.sh.scale.setScalar(asL); R.armR.sh.scale.setScalar(asR);
  R.legL.hp.scale.setScalar(lsL); R.legR.hp.scale.setScalar(lsR);
  // 自動踩地:支撐腿(contact≠2)的垂直高度 = 伸展×(Lu·cos(髖)+Ll·cos(髖+膝)) → root 下沉差值。
  // +S.foot.h:踝下有腳掌,root 整體抬一個腳掌高讓鞋底貼地(踝=離地 foot.h)。
  const legH = (hx, kx, st) => st * (Lu * Math.max(0.25, Math.cos(hx * D2R)) + Ll * Math.max(0.25, Math.cos((hx + kx) * D2R)));
  let hMax = 0, any = false;
  if (cL !== 2) { hMax = Math.max(hMax, legH(hxL * lLw, kxL * lLw, lsL)); any = true; }
  if (cR !== 2) { hMax = Math.max(hMax, legH(hxR * lRw, kxR * lRw, lsR)); any = true; }
  if (!any) hMax = Math.max(legH(hxL * lLw, kxL * lLw, lsL), legH(hxR * lRw, kxR * lRw, lsR));
  R.P.position.set(0, (hMax + S.foot.h - (Lu + Ll)) * sy + (p.root_py || 0) * S.PX, (p.root_pz || 0) * S.PX);
}

const _tip = new THREE.Vector3(), _upAxis = new THREE.Vector3(0, 1, 0);
const _zeroIdle = normalizePose(COMBAT_IDLE);

// ===== 手部部件切換:扛人(carrying)=握拳手模、丟人放手瞬間=張開手模、其餘=方塊拳套 =====
// GLB 未就緒 → 全程拳套(優雅降級)。HAND_CAL:socket 對齊後掛上 wr 的縮放/旋轉(度)/位移(px)。
const HAND_CAL = { scale: 42, rx: 0, ry: 0, rz: 0, px: 0, py: -2.8, pz: 0 };
function ensureHandMeshes(arm) {
  if (arm._handsBuilt) return arm._handsBuilt === 2;
  const side = arm.side < 0 ? 'L' : 'R';
  const grip = getHandMesh('grip', side), open = getHandMesh('open', side);
  if (!grip || !open) { arm._handsBuilt = 1; return false; }        // 尚未就緒,下幀再試
  for (const m of [grip, open]) {
    m.scale.setScalar(HAND_CAL.scale);
    m.rotation.set(HAND_CAL.rx * D2R, HAND_CAL.ry * D2R, HAND_CAL.rz * D2R);
    m.position.set(HAND_CAL.px, HAND_CAL.py, HAND_CAL.pz);
    m.visible = false; arm.wr.add(m);
  }
  arm.handGrip = grip; arm.handOpen = open; arm._handsBuilt = 2;
  return true;
}
function setArmHand(arm, mode) {                                    // mode: 'glove' | 'grip' | 'open'
  if (!ensureHandMeshes(arm)) { arm.fist.visible = true; return; }  // 手模未就緒 → 拳套
  arm.fist.visible = mode === 'glove';
  arm.handGrip.visible = mode === 'grip';
  arm.handOpen.visible = mode === 'open';
}
function updateHands(e, R, u, now) {
  // ?avatar=1:方塊人是隱形 driver、avatar 才是可見角色。方塊手模掛在方塊人手腕,若顯示會穿出 avatar
  // 身體外 → avatar 模式全程不顯示方塊手模。avatar 的手改由 rigged 手接管:一般/戰鬥=原生手,
  // 抓握物品(扛人/扛桶,含丟出後短暫收招)才換 rigged 手(對齊舊設計:扛/丟才換手模)。
  if (avatarEnabled() && avatarReady()) {
    for (const a of [R.armL, R.armR]) { if (a.handGrip) a.handGrip.visible = false; if (a.handOpen) a.handOpen.visible = false; }
    const av = u.avatar;
    if (av && av.handRig) {
      const h = u.hand || (u.hand = { wasCarry: false, releaseT: 0, rigT: 0 });
      if (e.carrying || e.carryObj) h.rigT = now + 0.3;  // 抓握中→續握;放/丟後多留 0.3s 收招(手指張開的跟隨)
      setRiggedHandsVisible(av, now < h.rigT);
    }
    return;
  }
  if (!handsReady()) { R.armL.fist.visible = true; R.armR.fist.visible = true; return; }
  const h = u.hand || (u.hand = { wasCarry: false, releaseT: 0 });
  let mode = 'glove';
  if (e.carrying) mode = 'grip';                                    // 扛人:握住
  else {
    // 剛結束搬運這幀:丟出(throwCarried 設 punchKind=2 且 punchFx≈now)→ 開手窗口;放下(dropCarry)→ 無
    if (h.wasCarry && e.punchKind === 2 && e.punchFx != null && (now - e.punchFx) < 0.12) h.releaseT = now + 0.28;
    if (now < h.releaseT) mode = 'open';                            // 丟人放手瞬間:五指張開
  }
  h.wasCarry = !!e.carrying;
  setArmHand(R.armL, mode); setArmHand(R.armR, mode);
}

// 瓶身色(扛瓶佔位;桶模縮小版,使用者瓶模好了換 mesh):冰=藍、油=暗金。[body, emissive, cap]
const BOTTLE_TINT = { ice: [0x9fd8e8, 0x2a6a88, 0x6aa8c0], oil: [0x9a8a5a, 0x2a2008, 0x6a5a32] };

// ===== 扛投擲物(桶/瓶共用):畫在雙手腕中點(舉過頭頂;丟時隨 heave clip 走)。遊戲端 v2.js 對 held 物略過 ground prop,
// 交由這裡畫,甩出/放下瞬間(carryObj 清空)交還給地面/飛行 prop。桶=橘箱+蓋、瓶=元素 tint 縮小版(換扛物種類時重建)。=====
const _wlp = new THREE.Vector3(), _wrp = new THREE.Vector3();
function updateHeldBarrel(e, g, R) {
  const holding = !!e.carryObj;
  let bm = g.userData.throwBarrel;
  if (!holding) { if (bm) bm.visible = false; return; }
  const kindKey = e.carryObj.kind === 'bottle' ? 'bottle:' + e.carryObj.elem : 'barrel';
  if (bm && bm.userData.kindKey !== kindKey) { g.remove(bm); bm = null; g.userData.throwBarrel = null; } // 桶↔瓶切換 → 重建
  if (!bm) {                                                        // lazy 建(桶=橘;瓶=BOTTLE_TINT)
    const s = (e.carryObj.r || 13) * 2;
    const tint = e.carryObj.kind === 'bottle' ? (BOTTLE_TINT[e.carryObj.elem] || BOTTLE_TINT.ice) : [0xff7a3a, 0xff5a20, 0x9c4422];
    bm = new THREE.Group(); bm.name = 'HELD_BARREL'; bm.userData.kindKey = kindKey;
    const box = makeBox(s, s, s, tint[0], tint[1], 0.5); bm.add(box);
    const cap = makeBox(s * 1.04, 3, s * 1.04, tint[2]); cap.position.y = s * 0.5 + 1.5; bm.add(cap);
    g.add(bm); g.userData.throwBarrel = bm;
  }
  bm.visible = true;
  // 手中點:avatar 模式取「可見的」avatar 手(rigged Fingers 骨優先,退回 avatar 手骨)——box 腕是隱形
  // driver,重定向+放大後 avatar 手在別處,貼 box 腕會脫手(同扛人病 3)。box 模式維持 box 腕。
  const av = g.userData.avatar;
  const bl = av && ((av.handRig && av.handRig.L && av.handRig.L.fingers) || (av.by.hand_l && av.by.hand_l.bone));
  const br = av && ((av.handRig && av.handRig.R && av.handRig.R.fingers) || (av.by.hand_r && av.by.hand_r.bone));
  if (bl && br) { bl.getWorldPosition(_wlp); br.getWorldPosition(_wrp); }
  else { R.armL.wr.getWorldPosition(_wlp); R.armR.wr.getWorldPosition(_wrp); }  // getWorldPosition 會更新 g 及祖鏈 matrixWorld
  _wlp.add(_wrp).multiplyScalar(0.5);
  g.worldToLocal(_wlp); bm.position.copy(_wlp);                       // 世界中點 → g 局部(g 的位移/朝向/擠壓已在本幀套好)
  bm.position.y += (e.carryObj.r || 13) * 2 * ANIM.heldBarrel.liftK;  // 桶心=手中點會蓋住頭 → 抬半桶高+餘裕,桶底貼掌心
  bm.rotation.y = game.time * 1.2;
}

// 冰凍皮:半透明冰塊包住整個人(frozen=暈的冰凍變體;直擊冰凍=好抓,扛著冰雕去回收=喜感本體)。
// 掛在 g(世界層):被扛時 positionCarried 蓋 g 變換 → 冰塊跟著人走。
function updateIceBlock(e, g) {
  const on = !!(e.frozen && (e.stunned || e.carriedBy)); // 被扛時仍是冰雕(startCarry 清 stunned)
  let ib = g.userData.iceBlock;
  if (!ib) {
    if (!on) return;
    ib = new THREE.Mesh(
      new THREE.BoxGeometry(30, 52, 30),
      new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.42, roughness: 0.15, metalness: 0, emissive: 0x2a6a88, emissiveIntensity: 0.35, depthWrite: false })
    );
    ib.name = 'ICE_BLOCK'; ib.position.y = 26;
    g.add(ib); g.userData.iceBlock = ib;
  }
  ib.visible = on;
}
// 防禦架式:舉防時身前半透明護盾弧(讀 e.guarding);破防鎖定變暖橘、正常冷藍。掛 g 世界層(面向由 g.rotation.y 帶)。
function updateGuardShield(e, g) {
  const on = !!e.guarding;
  let sh = g.userData.guardShield;
  if (!sh) {
    if (!on) return;
    sh = new THREE.Mesh(
      new THREE.SphereGeometry(20, 14, 10, 0, Math.PI, 0, Math.PI),   // 半球罩(朝前的弧面)
      new THREE.MeshStandardMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.3, roughness: 0.2, metalness: 0, emissive: 0x2a5a88, emissiveIntensity: 0.4, depthWrite: false, side: THREE.DoubleSide })
    );
    sh.name = 'GUARD_SHIELD'; sh.position.set(0, 24, 13); sh.rotation.x = Math.PI / 2; // 罩在身前
    g.add(sh); g.userData.guardShield = sh;
  }
  sh.visible = on;
  if (on) { const lk = (e.guardLock || 0) > 0; sh.material.color.setHex(lk ? 0xff9a6b : 0x9ecbff); sh.material.emissive.setHex(lk ? 0x884433 : 0x2a5a88); }
}

// 每幀:狀態 → 目標姿勢(clip 或程序)→ 平滑混合 → applyBrawlerPose;
// 面向/暈眩搖晃/flinch/整體 squash 維持世界層(g)處理,與姿勢層(P)分離。
export function updateBrawler(e, g) {
  const A = ANIM, u = g.userData, R = u.rig;
  if (!R) return;
  const yaw = Math.atan2(Math.cos(e.facing || 0), Math.sin(e.facing || 0));
  if (!u.lp) u.lp = { x: e.x, y: e.y };
  const disp = Math.hypot(e.x - u.lp.x, e.y - u.lp.y); u.lp.x = e.x; u.lp.y = e.y;
  const now = game.time;
  const dt = Math.min(Math.max(now - (u.lastT ?? now), 0), 0.05); u.lastT = now;

  // --- 目標姿勢 ---
  let pose = null, wob = 0;
  const free = !e.carriedBy && !e.carrying;
  // 走路振盪器(clip 定格與程序分支共用:扛人 hold 定格時腿也要走)
  const walking = disp > A.walk.minDisp && !e.stunned && !e.carriedBy;
  u.amp = (u.amp || 0) + ((walking ? 1 : 0) - (u.amp || 0)) * A.walk.ampEase;
  u.ph = (u.ph || 0) + Math.min(disp, A.walk.maxDisp) * A.walk.phaseRate;
  const sw = Math.sin(u.ph) * u.amp;
  const cclip = e.carryClip ? CLIPS[e.carryClip] : null;           // 丟人 heave clip:扛人期間覆蓋程序姿勢(跨 free,最優先)
  let cpt = now - (e.carryFx != null ? e.carryFx : -9);
  if (e.carryHold && cpt > e.carryHold) cpt = e.carryHold;         // 扛著走:定格在 hold 幀(抓起播完 0→hold 後停);按丟解除 → 續播
  const iclip = e.itemClip ? CLIPS[e.itemClip] : null;              // 道具施法 clip(與拳互斥,優先)
  const ipt = now - (e.itemFx != null ? e.itemFx : -9);
  const pt = now - (e.punchFx != null ? e.punchFx : -9);
  const clip = CLIPS[PUNCH_CLIPS[e.punchKind || 0]];
  if (cclip && cpt >= 0 && cpt < cclip.dur) {
    pose = evalClip(cclip, cpt);
    if (e.carrying && e.carryHold && cpt >= e.carryHold) {         // 定格扛著走:腿部疊走路(上身/手臂維持 studio hold 幀;丟出後時鐘解凍不再疊)
      pose.lL_hx += sw * A.walk.legSwing; pose.lR_hx -= sw * A.walk.legSwing;
      pose.lL_kx += Math.max(0, Math.sin(u.ph)) * A.walk.kneeAdd * u.amp;
      pose.lR_kx += Math.max(0, -Math.sin(u.ph)) * A.walk.kneeAdd * u.amp;
      pose.root_py += Math.abs(Math.sin(u.ph)) * A.walk.bob * u.amp / BRAWLER_SPEC.PX;
    }
  }
  else if (free && iclip && ipt >= 0 && ipt < iclip.dur) pose = evalClip(iclip, ipt);
  else if (free && pt >= 0 && clip && pt < clip.dur) pose = evalClip(clip, pt);
  else if (free && e.running && CLIPS.run_cycle && u.amp > 0.3) {   // 跑步循環(可選槽,studio 排)
    // tag 'run'=循環起點:0→run 是「起跑」過渡段只播一次,之後在 [run..最後實排 key] 無縫繞圈
    // (run 幀與最後 key 姿勢要一致;沒標 tag → 整條循環)。循環終點=lastKeyT,**不含**
    // prepClip 自動補的回-idle 收尾段(混進去=每圈垮回站姿)。位移驅動:一循環=stridePx px。
    const cyc = CLIPS.run_cycle, le = cyc.lastKeyT ?? cyc.dur;
    const ls = cyc.tags.run ?? 0, ll = Math.max(le - ls, 0.01);
    u.runT = (u.runT || 0) + disp / A.runClip.stridePx * ll;
    const rt = u.runT < le ? u.runT : ls + ((u.runT - ls) % ll);
    pose = evalClip(cyc, rt);
    if (u.runT >= ls && A.runClip.bob) {   // 踩地感:相位同步彈跳(key=觸地=低,兩 key 中間=過渡=高;起跑段不疊)
      const ph = (rt - ls) / ll;
      pose.root_py += A.runClip.bob * (0.5 - 0.5 * Math.cos(ph * Math.PI * 4));
    }
  }
  if (!e.running) u.runT = 0;                                       // 停跑 → 下次從起跑段重來(跑中出拳不重置,收招接回循環)
  const usingClip = pose != null;    // clip 播放 → 用高 blend 檔,別把浮誇關鍵幀壓扁
  if (!pose) {
    pose = { ..._zeroIdle };
    if (e.carriedBy || (u.lie || 0) > 0.3) {   // 被扛/被丟趴飛中:四肢亂踢掙扎
      const C = A.carried, t = now * C.kickRate;
      pose.lL_hx = Math.sin(t) * C.legAmp; pose.lR_hx = -Math.sin(t) * C.legAmp;
      pose.lL_kx = 20; pose.lR_kx = 20; pose.squat = 0;
      pose.aL_sx = C.armBase + Math.sin(t * C.armRateMul) * C.armAmp;
      pose.aR_sx = C.armBase - Math.sin(t * C.armRateMul) * C.armAmp;
      pose.aL_ex = 20; pose.aR_ex = 20;
      wob = Math.sin(now * C.wobRate) * C.wobAmp;
    } else if (e.carrying) {    // 扛人:雙臂高舉過頭
      pose.aL_sx = A.carry.armSx; pose.aR_sx = A.carry.armSx;
      pose.aL_ex = A.carry.armEx; pose.aR_ex = A.carry.armEx;
      pose.lL_hx += sw * A.walk.legSwing; pose.lR_hx -= sw * A.walk.legSwing;
    } else if (e.carryObj) {    // 扛桶:雙臂舉過頭頂托住桶(桶由 updateHeldBarrel 貼在雙腕中點;丟桶時改由 clip 驅動)
      Object.assign(pose, A.barrelHold);
      pose.lL_hx += sw * A.walk.legSwing; pose.lR_hx -= sw * A.walk.legSwing;
    } else if (e.guarding) {    // 按住防禦:使用者 studio 定稿的舉防定格(靜態蓋上,blend 自動補舉起/放下過渡)
      Object.assign(pose, A.guard);
    } else {                    // 走路/跑步:髖膝擺動+手臂反相(疊在戰鬥站姿上;跑=擺幅放大+前傾,u.runK 平滑進出)
      u.runK = (u.runK || 0) + ((e.running ? 1 : 0) - (u.runK || 0)) * A.walk.ampEase;
      const rswing = 1 + (A.run.swingMul - 1) * u.runK, rarm = 1 + (A.run.armMul - 1) * u.runK;
      const rknee = 1 + (A.run.kneeMul - 1) * u.runK, rbob = 1 + (A.run.bobMul - 1) * u.runK;
      pose.lL_hx += sw * A.walk.legSwing * rswing; pose.lR_hx -= sw * A.walk.legSwing * rswing;
      pose.lL_kx += Math.max(0, Math.sin(u.ph)) * A.walk.kneeAdd * rknee * u.amp;
      pose.lR_kx += Math.max(0, -Math.sin(u.ph)) * A.walk.kneeAdd * rknee * u.amp;
      pose.aL_sx += sw * A.walk.armSwing * rarm; pose.aR_sx -= sw * A.walk.armSwing * rarm;
      pose.root_py = Math.abs(Math.sin(u.ph)) * A.walk.bob * rbob * u.amp / BRAWLER_SPEC.PX;
      pose.spine_x += A.run.lean * u.runK; pose.head_x -= A.run.lean * 0.4 * u.runK;   // 前傾衝刺感(頭回抬看前方)
      pose.aL_ex += A.run.elbow * u.runK; pose.aR_ex += A.run.elbow * u.runK;          // 屈肘泵臂:肩擺(armMul)+肘彎=跑步臂,直臂大甩=走路感
      // 待機呼吸:站著不走(rest 大)時膝蓋微彎↔伸直的慢正弦(auto 踩地→身體隨之起伏);走路(amp 大)時淡出。
      const rest = 1 - u.amp;
      if (rest > 0.01 && !e.stunned) {
        const br = 0.5 - 0.5 * Math.cos(now * A.breath.rate + (e.pid || 0) * 2.1);   // 0..1 單向(直腿/直臂站姿也安全,不反折);兩名 fighter 相位錯開
        pose.squat += br * A.breath.knee * rest;                                     // 腿:直→彎→直(squat 帶髖+膝,auto 踩地→身體下沉)
        pose.aL_ex += br * A.breath.elbow * rest;                                    // 手臂:肘 直→彎→直(浮誇律動)
        pose.aR_ex += br * A.breath.elbow * rest;
        pose.aL_sz += br * A.breath.shoulder * rest;                                 // 肩微開(胸口擴張)
        pose.aR_sz += br * A.breath.shoulder * rest;
        pose.spine_x += br * A.breath.chest * rest;                                  // 下沉時含胸一點
      }
    }
    if (e.stunned) { wob = e.frozen ? 0 : Math.sin(now * A.stun.wobRate) * A.stun.wobAmp; pose.spine_x = A.stun.slump; pose.head_x = -A.stun.slump * 0.6; } // 冰凍=冰雕:不搖晃
  }

  // --- 平滑混合(狀態切換不瞬跳;clip 內插本身已平滑,這層只削接縫)---
  const k = 1 - Math.exp(-(usingClip ? A.blend.clipRate : A.blend.rate) * dt);
  if (!u.pose) u.pose = { ...pose };
  else for (const key of POSE_KEYS) u.pose[key] += ((pose[key] ?? 0) - u.pose[key]) * k;
  applyBrawlerPose(R, u.pose);
  updateHands(e, R, u, now);   // 扛人=握拳手模、丟人放手瞬間=張開手模,其餘=拳套

  // Phase 1:?avatar=1 且 GLB 就緒 → box rig 當隱形 driver,把世界差量轉寫到 GLB 角色。
  // 首次就緒時 lazy 建立(GLB 非同步載入);建立會 T-pose 校正,故放在 applyBrawlerPose 之後、
  // 用完再把姿勢套回(下一幀 updateBrawler 自然覆蓋,這裡不用還原)。
  if (avatarEnabled() && avatarReady()) {
    if (!u.avatarTried) { u.avatarTried = true; buildAvatar(g, R, applyBrawlerPose); applyBrawlerPose(R, u.pose); }
    if (g.userData.avatar) retargetAvatar(g, R, u.pose);
  }

  // --- 世界層:面向 + 暈眩搖晃 + flinch + 擠壓 ---
  const airY = e.z || 0;            // 被拋飛的 sim 彈道高度(B 案:v2.js step 由 lobZ 算,判定與視覺同一個數)
  // 被丟打橫(e._lying):飛行+落地滑行趴著(超人式,頭朝速度方向、面朝地),滑停才平滑站起
  const lieTgt = e._lying ? 1 : 0;
  u.lie = (u.lie || 0) + (lieTgt - (u.lie || 0)) * (1 - Math.exp(-A.thrown.rate * dt));
  if (u.lie < 0.01) u.lie = 0;
  const lift = airY + u.lie * A.thrown.lift;        // 趴姿抬半個身厚,免沉進地板
  g.position.y = lift;              // root_py 已進姿勢層;airY/lift 是世界層的疊加
  if (u.shadow) u.shadow.position.y = 1.6 - lift;   // 影子留地面讀高度
  if (u.lie > 0.01) {
    if (u.lieYaw === undefined) {                   // 起飛瞬間鎖定朝向:撞牆反彈/落地滑行速度突變時身體不亂轉
      const va = (Math.hypot(e.vx || 0, e.vy || 0) > 20) ? Math.atan2(e.vy, e.vx) : (e.facing || 0);
      u.lieYaw = Math.atan2(Math.cos(va), Math.sin(va));
    }
    g.quaternion.setFromAxisAngle(_upAxis, u.lieYaw);
    g.rotateX(Math.PI / 2 * u.lie);                 // 頭前腳後、面朝地;u.lie 內插=起身動畫
  } else { u.lieYaw = undefined; g.rotation.set(0, yaw, wob); }
  const fk = e.flinchT > 0 ? Math.min(1, e.flinchT / A.flinch.window) : 0;
  if (fk > 0) { _tip.set(Math.sin(e.flinchA), 0, -Math.cos(e.flinchA)); g.rotateOnWorldAxis(_tip, A.flinch.tip * fk * fk); }
  g.scale.set(1 + A.flinch.squashXZ * fk, 1 - A.flinch.squashY * fk, 1 + A.flinch.squashXZ * fk);
  updateHeldBarrel(e, g, R);   // 扛投擲物(桶/瓶):貼雙手腕中點(g 世界變換已套好,可讀手骨世界座標)
  updateIceBlock(e, g);        // 冰凍皮:frozen 時半透明冰塊包住人(醒來自動隱藏)
  updateGuardShield(e, g);     // 防禦架式:舉防時身前半透明護盾弧
}
