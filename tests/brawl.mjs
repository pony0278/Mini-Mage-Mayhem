// 爽鬥核心(A 款 brawl-1;docs/game-split.md A-v0 手術)驗收——勝負回歸+戰鬥解鎖+系統解休眠:
// ①開局系統全醒(桶/補給座/瓶/拉桿;不再需要 ?props=full)+ AI=純戰鬥 + charter 殘留清除
// ②穩定值歸零=擊暈(無能量閘,連拳直接打暈)③終結技(第三拳)=打飛(PUNCH_LAUNCH_LOB 彈道)
// ④完美格擋=反暈攻擊者 ⑤搬進艙=resolveContain(roundWins+containLog 記法)⑥endMatch=事故報告 ⑦無 console 錯誤
// 陷阱:punch() 在 carryObj/carrying 時靜默 no-op → 判定測試直接呼叫 resolveStrike;
//       戰鬥測試把角色放艙南(y≈540)防 POD(480,320,r46) 收容污染;完整演出節奏由 perform.mjs 驗。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// 決定性:跳開場、關 AI(免搶瓶/亂走)
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });

// ---------- ① 系統全醒 + charter 殘留清除 ----------
const boot = await page.evaluate(() => { const v = __v2; return {
  barrels: v.barrels.filter(b => b.alive).length, pads: v.pads.filter(p => p.item).length,
  bottles: v.bottles.filter(t => t.alive).length, switches: v.labSwitches.length,
  aiMode: v.fighters[1]._aiMode,
  charterGone: v.v2s.seq === undefined && v.v2s.energy === undefined && v.v2s.clockT === undefined && v.v2s.propsFull === undefined && v.v2s.ending === undefined,
}; });
R('開局系統全醒(桶2/補給座2/瓶6/拉桿2,無 ?props=full)', boot.barrels === 2 && boot.pads === 2 && boot.bottles === 6 && boot.switches === 2, JSON.stringify(boot));
R('AI=純戰鬥模式(分類同事凍結在 B 款)', boot.aiMode === 'fight');
R('charter 純量殘留清除(v2s 無 seq/energy/clockT/propsFull/ending)', boot.charterGone);

// ---------- ② 穩定值歸零=擊暈(無能量閘) ----------
const stun = await page.evaluate(() => { const v = __v2;
  const a = v.fighters[1], o = v.fighters[0];
  a.carryObj = null; a.carrying = null;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; o.invuln = 0;
  let n = 0;
  while (!o.stunned && n < 12) { a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a); o.x = 500; o.y = 540; n++; }
  return { stunned: o.stunned, punches: n, stab: Math.round(o.stability) };
});
R('連拳削穩定值歸零=擊暈(無能量閘)', stun.stunned && stun.punches <= 8, JSON.stringify(stun));

// ---------- ③ 對「已暈」的對手出拳=挑飛 launcher(brawl-3 連段收尾;連段中的拳不飛走) ----------
const fling = await page.evaluate(() => { const v = __v2;
  const a = v.fighters[1], o = v.fighters[0];
  o.stunned = true; o.stunT = 5; o.restunT = 0; o.stability = 0; o.invuln = 0; o.fumbleT = 0; o._lob = null; o.carrying = null; // 已暈的對手
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; a.punchCd = 0;
  a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a); // 普通鉤拳打已暈者=挑飛
  const lobV = v.PUNCH_LAUNCH_LOB.range / v.PUNCH_LAUNCH_LOB.T;
  return { lob: o._lob === v.PUNCH_LAUNCH_LOB, fumble: +o.fumbleT.toFixed(2), speed: Math.round(Math.hypot(o.vx, o.vy)), lobV: Math.round(lobV) };
});
R('對已暈者出拳=挑飛(PUNCH_LAUNCH_LOB;連段收尾/接風壓入口)', fling.lob && fling.fumble > 0 && Math.abs(fling.speed - fling.lobV) <= 5, JSON.stringify(fling));

// ---------- ④ 反擊拳(brawl-3.1:擋下鉤拳→停頓→左鍵反擊反暈) ----------
const counter = await page.evaluate(() => { const v = __v2;
  const a = v.fighters[1], d = v.fighters[0];
  a.stunned = false; a.stunT = 0; a.restunT = 0; a.frozen = false; a.stability = 100; a.carriedBy = null; a.fumbleT = 0;
  d.stunned = false; d.stunT = 0; d.fumbleT = 0; d.vx = d.vy = 0; d.pushCd = 0; d.punchCd = 0; d.guardStam = 100; d._counterFrom = null; d.carryObj = null; d.carrying = null;
  a.x = 470; a.y = 540; d.x = 500; d.y = 540;
  // ① 舉防擋下對手鉤拳 → 開反擊窗口
  d.guarding = true; a._strikeKind = 0; a._strikeDir = Math.atan2(d.y - a.y, d.x - a.x); v.resolveStrike(a);
  const opened = d._counterFrom === a;
  d.guarding = false;
  // ② 停頓內太早按左鍵 = 喪失反擊(逼你別狂按)
  d._counterAt = v.game.time + 999; d.punchCd = 0; d.x = 500; d.y = 540; a.x = 470; a.y = 540; v.punch(d);
  const earlyLost = d._counterFrom === null && !a.stunned;
  // ③ 窗口內按左鍵 = 反擊反暈攻擊者
  a.stunned = false; a.stunT = 0; a.restunT = 0; d._counterFrom = a; d._counterAt = v.game.time - 0.05; // 0<=dt0<COUNTER_WIN
  d.punchCd = 0; d.x = 500; d.y = 540; a.x = 470; a.y = 540; v.punch(d);
  return { opened, earlyLost, counterStunned: a.stunned };
});
R('擋下鉤拳=開反擊窗口', counter.opened, JSON.stringify(counter));
R('停頓內太早按=喪失反擊(逼你別狂按)', counter.earlyLost, JSON.stringify(counter));
R('窗口內左鍵=反擊反暈攻擊者', counter.counterStunned, JSON.stringify(counter));

// ---------- ⑤ 搬進艙=resolveContain(roundWins+containLog) ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.stunned = false; a.stunT = 0; a.carrying = null; a.carryObj = null;
  o.stunned = true; o.stunT = 9; o.restunT = 0; o.invuln = 0; o.carriedBy = null; o.fumbleT = 0; o._performing = false;
  a.x = 430; a.y = 320; o.x = 435; o.y = 320;
  v.startCarry(a, o);
  a.x = v.POD.x - 10; a.y = v.POD.y; a.facing = 0; });
await page.waitForFunction('__v2.state().roundWins[1] >= 1', { timeout: 60000 });
const cont = await page.evaluate(() => { const s = __v2.state(); return { wins: s.roundWins, log: s.containLog, perform: !!s.perform }; });
R('搬進艙=收容得分(roundWins+containLog 記「carry」+演出啟動)', cont.wins[1] === 1 && cont.log.length === 1 && cont.log[0].m === 'carry' && cont.perform, JSON.stringify(cont));

// ---------- ⑥ endMatch=事故報告(分享引擎復活) ----------
await page.evaluate(() => __v2.endMatch(1));
const rep = await page.evaluate(() => { const s = __v2.state(); return { over: s.matchOver, level: s.report && s.report.level, name: s.report && s.report.name }; });
R('endMatch → matchOver+事故報告(等級+標題)', rep.over && !!rep.level && !!rep.name, JSON.stringify(rep));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
