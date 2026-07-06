// actor-brawler.js — v2 收容測試的關節化體素小人:骨架移植自使用者的 PUNCH STUDIO 動作編排器
// (root→pelvis→腿[髖/膝];root→spine→肩/肘/腕+headPivot),吃編排器的 47 軸姿勢格式。
// 「改模型 = 改 BRAWLER_SPEC;改動作 = 改 brawler-clips.js 的 CLIPS(編排器 JSON 直貼)」。
// 屬 render 層(由 render-actors 呼叫);模擬層透過 fighter 欄位(punchFx/punchKind/punchArm/
// flinch*/carrying/stunned...)驅動,永不 import 這裡(sim 保持 headless)。
import { game } from './state.js';
import { makeBox } from './render-core.js';
import { CLIPS, PUNCH_CLIPS, COMBAT_IDLE, POSE_KEYS, evalClip, normalizePose } from './brawler-clips.js';
import { avatarEnabled, avatarReady, buildAvatar, retargetAvatar } from './actor-avatar.js';

// ===== 建模規格表:尺寸/位置(世界 px)/配色。關節鏈長 Lu/Ll(腿)、Au/Al(臂)給自動踩地/組裝用 =====
export const BRAWLER_SPEC = {
  colors: { limbShade: 0.68, paleLighten: 0.42, eye: 0x17101c, glow: 0.06 },
  hipY: 14, hipX: 5.4,
  thigh: { w: 7, h: 7.5, d: 8 }, shin: { w: 6.2, h: 6.5, d: 7.2 },      // Lu=7.5, Ll=6.5
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
  blend:   { rate: 14 },                                                                   // 姿勢平滑:每秒收斂速率(消除狀態切換的瞬跳)
  walk:    { minDisp: 0.25, maxDisp: 6, phaseRate: 0.18, ampEase: 0.2, legSwing: 34, armSwing: 22, kneeAdd: 18, bob: 1.6 }, // 度
  carried: { kickRate: 11, legAmp: 30, armBase: -140, armAmp: 25, armRateMul: 0.7, wobRate: 7, wobAmp: 0.16 },
  carry:   { armSx: -135, armEx: 12 },                                                     // 扛人:雙臂高舉過頭
  stun:    { wobRate: 9, wobAmp: 0.14, slump: 18 },                                        // 暈眩:搖晃+垮肩駝背
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
    const sh = makeBox(S.shin.w, S.shin.h, S.shin.d, limb); sh.position.y = -S.shin.h / 2; kn.add(sh);
    return { hp, kn, side };
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
    return { sh, el, lm, wr, side };
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const headPivot = grp(spine, 0, S.headPivotY);
  const head = makeBox(S.head.w, S.head.h, S.head.d, pale); head.position.y = S.head.cy; headPivot.add(head);
  const hair = tintable(g, tints, makeBox(S.hair.w, S.hair.h, S.hair.d, base, base, C.glow)); hair.position.y = S.hair.cy; headPivot.add(hair);
  for (const sd of [-1, 1]) { const e = makeBox(S.eye.w, S.eye.h, S.eye.d, C.eye); e.position.set(sd * S.eye.x, S.eye.cy, S.eye.z); headPivot.add(e); }
  g.userData.rig = { P, pelvis, spine, headPivot, legL, legR, armL, armR };
}

const D2R = Math.PI / 180;
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
  R.armL.lm.scale.setScalar(p.aL_scale || 1);
  R.armR.lm.scale.setScalar(p.aR_scale || 1);
  // 自動踩地:支撐腿(contact≠2)的垂直高度 = Lu·cos(髖)+Ll·cos(髖+膝) → root 下沉差值
  const legH = (hx, kx) => Lu * Math.max(0.25, Math.cos(hx * D2R)) + Ll * Math.max(0.25, Math.cos((hx + kx) * D2R));
  const cL = Math.round(p.lL_contact || 0), cR = Math.round(p.lR_contact || 0);
  let hMax = 0, any = false;
  if (cL !== 2) { hMax = Math.max(hMax, legH(hxL * lLw, kxL * lLw)); any = true; }
  if (cR !== 2) { hMax = Math.max(hMax, legH(hxR * lRw, kxR * lRw)); any = true; }
  if (!any) hMax = Math.max(legH(hxL * lLw, kxL * lLw), legH(hxR * lRw, kxR * lRw));
  R.P.position.set(0, (hMax - (Lu + Ll)) * sy + (p.root_py || 0) * S.PX, (p.root_pz || 0) * S.PX);
}

const _tip = new THREE.Vector3();
const _zeroIdle = normalizePose(COMBAT_IDLE);

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
  const pt = now - (e.punchFx != null ? e.punchFx : -9);
  const clip = CLIPS[PUNCH_CLIPS[e.punchKind || 0]];
  if (!e.carriedBy && !e.carrying && pt >= 0 && clip && pt < clip.dur) pose = evalClip(clip, pt);
  if (!pose) {
    pose = { ..._zeroIdle };
    const walking = disp > A.walk.minDisp && !e.stunned && !e.carriedBy;
    u.amp = (u.amp || 0) + ((walking ? 1 : 0) - (u.amp || 0)) * A.walk.ampEase;
    u.ph = (u.ph || 0) + Math.min(disp, A.walk.maxDisp) * A.walk.phaseRate;
    const sw = Math.sin(u.ph) * u.amp;
    if (e.carriedBy) {          // 被扛:四肢亂踢掙扎
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
    } else {                    // 走路:髖膝擺動+手臂反相(疊在戰鬥站姿上)
      pose.lL_hx += sw * A.walk.legSwing; pose.lR_hx -= sw * A.walk.legSwing;
      pose.lL_kx += Math.max(0, Math.sin(u.ph)) * A.walk.kneeAdd * u.amp;
      pose.lR_kx += Math.max(0, -Math.sin(u.ph)) * A.walk.kneeAdd * u.amp;
      pose.aL_sx += sw * A.walk.armSwing; pose.aR_sx -= sw * A.walk.armSwing;
      pose.root_py = Math.abs(Math.sin(u.ph)) * A.walk.bob * u.amp / BRAWLER_SPEC.PX;
    }
    if (e.stunned) { wob = Math.sin(now * A.stun.wobRate) * A.stun.wobAmp; pose.spine_x = A.stun.slump; pose.head_x = -A.stun.slump * 0.6; }
  }

  // --- 平滑混合(狀態切換不瞬跳;clip 內插本身已平滑,這層只削接縫)---
  const k = 1 - Math.exp(-A.blend.rate * dt);
  if (!u.pose) u.pose = { ...pose };
  else for (const key of POSE_KEYS) u.pose[key] += ((pose[key] ?? 0) - u.pose[key]) * k;
  applyBrawlerPose(R, u.pose);

  // Phase 1:?avatar=1 且 GLB 就緒 → box rig 當隱形 driver,把世界差量轉寫到 GLB 角色。
  // 首次就緒時 lazy 建立(GLB 非同步載入);建立會 T-pose 校正,故放在 applyBrawlerPose 之後、
  // 用完再把姿勢套回(下一幀 updateBrawler 自然覆蓋,這裡不用還原)。
  if (avatarEnabled() && avatarReady()) {
    if (!u.avatarTried) { u.avatarTried = true; buildAvatar(g, R, applyBrawlerPose); applyBrawlerPose(R, u.pose); }
    if (g.userData.avatar) retargetAvatar(g, R);
  }

  // --- 世界層:面向 + 暈眩搖晃 + flinch + 擠壓 ---
  g.position.y = 0; // root_py 已進姿勢層
  g.rotation.set(0, yaw, wob);
  const fk = e.flinchT > 0 ? Math.min(1, e.flinchT / A.flinch.window) : 0;
  if (fk > 0) { _tip.set(Math.sin(e.flinchA), 0, -Math.cos(e.flinchA)); g.rotateOnWorldAxis(_tip, A.flinch.tip * fk * fk); }
  g.scale.set(1 + A.flinch.squashXZ * fk, 1 - A.flinch.squashY * fk, 1 + A.flinch.squashXZ * fk);
}
