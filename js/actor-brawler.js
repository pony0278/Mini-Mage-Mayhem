// actor-brawler.js — v2 收容測試的關節化體素小人(素體):建模 + 程序動畫。
// 「改模型 = 改 BRAWLER_SPEC;改動作手感 = 改 ANIM」—— 兩張表就在下面,
// 組裝/姿勢程式碼原則上不用碰。屬 render 層(由 render-actors 呼叫);
// 模擬層(v2-combat)透過 fighter 欄位(punchFx/punchKind/punchArm/flinch*/carrying/
// stunned...)驅動動畫,永不 import 這裡(sim 保持 headless)。
import { game } from './state.js';
import { makeBox } from './render-core.js';

// ===== 建模規格表:尺寸/位置(世界 px)/配色 =====
// 腿軸心在髖(leg.pivotY)、手臂軸心在肩(arm.pivotY) → 動畫用旋轉擺動。
export const BRAWLER_SPEC = {
  colors: { limbShade: 0.68, paleLighten: 0.42, eye: 0x17101c, glow: 0.06 }, // 四肢=身分色×0.68;頭/拳=向白拉0.42;軀幹/髮蓋微自發光
  leg:      { x: 5.4, pivotY: 14, w: 7, h: 13, d: 8, dropY: -7 },
  torso:    { w: 22, h: 18, d: 13, y: 23 },
  shoulder: { x: 13.2, y: 30.5, w: 7, h: 5.5, d: 9 },
  arm:      { x: 14, pivotY: 29, w: 6, h: 14, d: 7, dropY: -7.3 },
  fist:     { w: 8.4, h: 7.2, d: 8.4, dropY: -16 },
  head:     { w: 14.5, h: 13, d: 13.5, y: 39.5 },
  hair:     { w: 15.2, h: 4.5, d: 14.2, y: 47.5 }, // 髮蓋:44° 俯視看到最多的就是頭頂,這片=身分色,沒它藍/紅會被淺色頭洗掉
  eye:      { x: 3.5, y: 40.5, z: 6.9, w: 3, h: 3.6, d: 1.2 },
};

// ===== 動作參數表:走路/三段拳/扛人/被扛/暈眩/受擊的所有手感數字 =====
export const ANIM = {
  walk:     { minDisp: 0.25, maxDisp: 6, phaseRate: 0.18, ampEase: 0.2, legSwing: 0.75, armFactor: 0.55, bob: 1.6 }, // 相位吃實際位移→步頻跟速度;擊退滑行不擺
  carried:  { kickRate: 11, legAmp: 0.6, armBase: -0.6, armAmp: 0.35, armRateMul: 0.7, wobRate: 7, wobAmp: 0.16 },   // 被扛:四肢亂踢掙扎
  carry:    { armsUp: -2.35 },                                                                                        // 扛人:雙臂高舉過頭
  hook:     { dur: 0.3, outT: 0.07, holdT: 0.1, backT: 0.2, raiseMul: 1.8, armRaise: -1.2, sweepFrom: 0.9, sweepRange: 1.3, twist: 0.28, lean: 0.16 }, // 左/右鉤:抬平橫掃+腰部扭轉
  finisher: { dur: 0.44, windT: 0.1, strikeT: 0.18, holdT: 0.26, backT: 0.18, rotBase: 0.35, rotRange: 2.15, counterArm: 0.45, lean: 0.42, windArm: 0.6, windLean: 0.14 }, // 浮誇直拳:蓄力→爆發→定格→收
  stun:     { wobRate: 9, wobAmp: 0.14 },                                                                             // 暈眩:左右搖晃
  flinch:   { window: 0.22, tip: 0.55, squashXZ: 0.15, squashY: 0.2 },                                                // 受擊:上身朝受力方向倒+壓扁回彈(hitstop 中凍在最大變形)
};

// 身分色的深/淺變化(素體小人:軀幹=本色、四肢=深一階、頭/拳=淺一階)
function shadeHex(h, m) {
  const r = Math.min(255, Math.round((h >> 16 & 255) * m)), g = Math.min(255, Math.round((h >> 8 & 255) * m)), b = Math.min(255, Math.round((h & 255) * m));
  return (r << 16) | (g << 8) | b;
}
function lightenHex(h, t) {
  const r = Math.round((h >> 16 & 255) + (255 - (h >> 16 & 255)) * t), g = Math.round((h >> 8 & 255) + (255 - (h >> 8 & 255)) * t), b = Math.round((h & 255) + (255 - (h & 255)) * t);
  return (r << 16) | (g << 8) | b;
}

// 組裝:讀 BRAWLER_SPEC 建 mesh 到 g;tintable(由 render-actors 傳入)登記受擊白閃的部位(軀幹+髮蓋)
export function buildBrawler(g, tints, tintable, base) {
  const S = BRAWLER_SPEC, C = S.colors;
  const limb = shadeHex(base, C.limbShade), pale = lightenHex(base, C.paleLighten);
  const mkPivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legL = mkPivot(-S.leg.x, S.leg.pivotY), legR = mkPivot(S.leg.x, S.leg.pivotY);
  for (const lg of [legL, legR]) { const b = makeBox(S.leg.w, S.leg.h, S.leg.d, limb); b.position.y = S.leg.dropY; lg.add(b); }
  const torso = tintable(g, tints, makeBox(S.torso.w, S.torso.h, S.torso.d, base, base, C.glow)); torso.position.y = S.torso.y;
  const shL = makeBox(S.shoulder.w, S.shoulder.h, S.shoulder.d, limb); shL.position.set(-S.shoulder.x, S.shoulder.y, 0); g.add(shL);
  const shR = makeBox(S.shoulder.w, S.shoulder.h, S.shoulder.d, limb); shR.position.set(S.shoulder.x, S.shoulder.y, 0); g.add(shR);
  const armL = mkPivot(-S.arm.x, S.arm.pivotY), armR = mkPivot(S.arm.x, S.arm.pivotY);
  for (const ar of [armL, armR]) {
    const ua = makeBox(S.arm.w, S.arm.h, S.arm.d, limb); ua.position.y = S.arm.dropY; ar.add(ua);
    const fist = makeBox(S.fist.w, S.fist.h, S.fist.d, pale); fist.position.y = S.fist.dropY; ar.add(fist);
  }
  const head = makeBox(S.head.w, S.head.h, S.head.d, pale); head.position.y = S.head.y; g.add(head);
  const hair = tintable(g, tints, makeBox(S.hair.w, S.hair.h, S.hair.d, base, base, C.glow)); hair.position.y = S.hair.y;
  const eL = makeBox(S.eye.w, S.eye.h, S.eye.d, C.eye); eL.position.set(-S.eye.x, S.eye.y, S.eye.z); g.add(eL);
  const eR = makeBox(S.eye.w, S.eye.h, S.eye.d, C.eye); eR.position.set(S.eye.x, S.eye.y, S.eye.z); g.add(eR);
  g.userData.limbs = { legL, legR, armL, armR };
}

const _tip = new THREE.Vector3(); // 世界軸傾倒用(出拳前傾/受擊後仰)

// 程序動畫:面向 + 走路擺動 + 三段連擊 + 扛/被扛 + 暈眩搖晃 + 受擊 flinch。
// 呼叫前 g.position 已由 render-actors 設為 (e.x, 0, e.y);這裡只調 position.y(步伐彈跳)。
export function updateBrawler(e, g) {
  const A = ANIM;
  const yaw = Math.atan2(Math.cos(e.facing || 0), Math.sin(e.facing || 0));
  const u = g.userData, L = u.limbs;
  if (!u.lp) u.lp = { x: e.x, y: e.y };
  const disp = Math.hypot(e.x - u.lp.x, e.y - u.lp.y); u.lp.x = e.x; u.lp.y = e.y;
  const walking = disp > A.walk.minDisp && !e.stunned && !e.carriedBy;
  u.amp = (u.amp || 0) + ((walking ? 1 : 0) - (u.amp || 0)) * A.walk.ampEase; // 擺幅緩入緩出
  u.ph = (u.ph || 0) + Math.min(disp, A.walk.maxDisp) * A.walk.phaseRate;
  const sw = Math.sin(u.ph) * A.walk.legSwing * u.amp;
  let aL = -sw * A.walk.armFactor, aR = sw * A.walk.armFactor, lL = sw, lR = -sw, wob = 0, lean = 0, ryL = 0, ryR = 0, twist = 0;
  g.position.y = Math.abs(Math.sin(u.ph)) * A.walk.bob * u.amp;
  if (e.carriedBy) {
    const C = A.carried, t = game.time * C.kickRate;
    lL = Math.sin(t) * C.legAmp; lR = -Math.sin(t) * C.legAmp;
    aL = C.armBase + Math.sin(t * C.armRateMul) * C.armAmp; aR = C.armBase - Math.sin(t * C.armRateMul) * C.armAmp;
    wob = Math.sin(game.time * C.wobRate) * C.wobAmp;
  } else if (e.carrying) {
    aL = A.carry.armsUp; aR = A.carry.armsUp;
  } else {
    const pt = game.time - (e.punchFx != null ? e.punchFx : -9);
    const kind = e.punchKind || 0;                                    // 0 左鉤 / 1 右鉤 / 2 浮誇直拳
    if (pt >= 0 && pt < (kind === 2 ? A.finisher.dur : A.hook.dur)) {
      if (kind === 2) {            // 終結直拳:後拉蓄力 → 爆發前刺 → 定格 → 收回
        const F = A.finisher; let s;
        if (pt < F.windT) s = -(pt / F.windT);
        else if (pt < F.strikeT) s = (pt - F.windT) / (F.strikeT - F.windT);
        else if (pt < F.holdT) s = 1;
        else s = Math.max(0, 1 - (pt - F.holdT) / F.backT);
        if (s < 0) { const w = -s; if (e.punchArm) aR = F.rotBase + F.windArm * w; else aL = F.rotBase + F.windArm * w; lean = -F.windLean * w; }
        else {
          const rot = F.rotBase - F.rotRange * s;
          if (e.punchArm) { aR = rot; aL = F.counterArm * s; } else { aL = rot; aR = F.counterArm * s; } // 另一手往後甩平衡
          lean = F.lean * s;
        }
      } else {                     // 左/右鉤拳:手臂抬平橫掃弧線 + 腰部扭轉
        const Hk = A.hook;
        const k = pt < Hk.outT ? pt / Hk.outT : Math.max(0, 1 - (pt - Hk.holdT) / Hk.backT);
        const dir = e.punchArm ? 1 : -1;
        const raise = Math.min(1, k * Hk.raiseMul);
        if (e.punchArm) { aR = Hk.armRaise * raise; ryR = dir * (Hk.sweepFrom - Hk.sweepRange * k); }
        else { aL = Hk.armRaise * raise; ryL = dir * (Hk.sweepFrom - Hk.sweepRange * k); }
        twist = -dir * Hk.twist * k;
        lean = Hk.lean * k;
      }
    }
    if (e.stunned) wob = Math.sin(game.time * A.stun.wobRate) * A.stun.wobAmp;
  }
  if (L) { L.armL.rotation.x = aL; L.armR.rotation.x = aR; L.armL.rotation.y = ryL; L.armR.rotation.y = ryR; L.legL.rotation.x = lL; L.legR.rotation.x = lR; }
  g.rotation.set(0, yaw + twist, wob);
  // 受擊 flinch:上身朝受力方向猛地一倒 + squash & stretch(scale 每幀復位)
  const fk = e.flinchT > 0 ? Math.min(1, e.flinchT / A.flinch.window) : 0;
  if (fk > 0) { _tip.set(Math.sin(e.flinchA), 0, -Math.cos(e.flinchA)); g.rotateOnWorldAxis(_tip, A.flinch.tip * fk * fk); }
  if (lean) { const fa = e.facing || 0; _tip.set(Math.sin(fa), 0, -Math.cos(fa)); g.rotateOnWorldAxis(_tip, lean); }
  g.scale.set(1 + A.flinch.squashXZ * fk, 1 - A.flinch.squashY * fk, 1 + A.flinch.squashXZ * fk);
}
