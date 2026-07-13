// 核心憲章 v1.1(docs/v2-core-charter.md 2026-07-13 定稿:分類競速=唯一勝利)驗收:
// ①開局:12 元素序列/四型垃圾/AI 同事/元素系統休眠 ②分對=序列前進+充能+計分 ③分錯=拒收彈回(輕罰,瓶不銷毀)
// ④進度獨立(AI 分對不動玩家) ⑤完成一組=下班進度+1+能量bonus ⑥免費拳=踉蹌不暈+被打方充能
// ⑦能量滿第三拳=擊暈+清條 ⑧中途進艙=拒收吐回(北管道+受擊保護,不結束比賽) ⑨先完成 3 組=下班獲勝(加班 gag→報告)
// ⑩整局限時歸零=完成多者獲勝 ⑪AI 同事讀自己序列撿對元素 ⑫無錯
// 陷阱:rAF 節流→game.time 輪詢 advance;本機 fighters[0] facing 每幀吃滑鼠→出拳測試用 fighters[1] 當攻擊方;
// 拳測試把雙方擺南邊遠離 POD(暈+高速在艙半徑=吐回演出污染);matchOver 凍結 game.time→之後用 restartMatch 重啟
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
const waitFor = (fnStr, tmax = 4) => page.evaluate((src, tm) => new Promise(res => {
  const f = new Function('v', 'return (' + src + ')'), v = window.__v2, t0 = v.game.time;
  const iv = setInterval(() => { const ok = f(v); if (ok || v.game.time - t0 > tm) { clearInterval(iv); res(!!ok); } }, 20);
}), fnStr, tmax);
// 跳開場;餵一顆瓶進中央口(match=用該 pid 當前序列需求、否則用錯的元素)
await page.evaluate(() => { __v2.v2s.introT = 0; });
const feed = (match, pid = 0) => page.evaluate(([m, p]) => {
  const v = __v2, GA = ['fire', 'ice', 'poison', 'lightning'];
  const need = v.state().seq[v.state().seqIdx[p]];
  const t = v.bottles.find(b => b.alive) || v.bottles[0];
  t.alive = true; t.held = false; t.elem = m ? need : GA.find(e => e !== need);
  t.x = v.POD.x; t.y = v.POD.y; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9; t.thrownBy = p;
  return t.elem;
}, [match, pid]);

// ---------- ① 開局 ----------
const boot = await page.evaluate(() => { const s = __v2.state(); return { seqLen: s.seq.length, elems: [...new Set(__v2.bottles.filter(b => b.alive).map(b => b.elem))].sort(), sets: s.sets, aiOn: __v2.fighters[1].ai, aiMode: s.aiMode, barrels: __v2.barrels.filter(b => b.alive).length, padItems: __v2.pads.filter(p => p.item).length, clockT: s.clockT }; });
R('開局:12 元素序列 + 四型垃圾齊備 + 下班進度 0', boot.seqLen === 12 && ['fire', 'ice', 'lightning', 'poison'].every(e => boot.elems.includes(e)) && boot.sets[0] === 0, JSON.stringify(boot));
R('AI 同事開場即開(demo 分類模式)', boot.aiOn === true && boot.aiMode === 'demo');
R('元素系統休眠(無桶/補給座空;?props=full 才回復)', boot.barrels === 0 && boot.padItems === 0, 'barrels=' + boot.barrels + ' pads=' + boot.padItems);

// ---------- ② 分對 ----------
const b2 = await page.evaluate(() => { const s = __v2.state(); return { idx: s.seqIdx[0], energy: s.energy[0], sorted: s.sorted[0] }; });
await feed(true); await advance(0.15);
const a2 = await page.evaluate(() => { const s = __v2.state(); return { idx: s.seqIdx[0], energy: s.energy[0], sorted: s.sorted[0] }; });
R('分對 → 自己序列前進 + 事故能量↑(工作充能) + 計分', a2.idx === b2.idx + 1 && a2.energy > b2.energy && a2.sorted === b2.sorted + 1, JSON.stringify(b2) + '→' + JSON.stringify(a2));

// ---------- ③ 分錯 ----------
const b3 = await page.evaluate(() => { const s = __v2.state(); return { idx: s.seqIdx[0], missorts: s.missorts[0], alive: __v2.bottles.filter(t => t.alive).length }; });
await feed(false); await advance(0.2);
const a3 = await page.evaluate(() => { const s = __v2.state(); const bounced = __v2.bottles.some(t => { const d = Math.hypot(t.x - 480, t.y - 320); return t.alive && d > 46 && d < 160; }); return { idx: s.seqIdx[0], missorts: s.missorts[0], bounced }; });
R('分錯 → 拒收彈回(瓶不銷毀可重試) + 序列不前進 + 分錯計數', a3.idx === b3.idx && a3.missorts === b3.missorts + 1 && a3.bounced, JSON.stringify(b3) + '→' + JSON.stringify(a3));

// ---------- ④ 進度獨立 ----------
const b4 = await page.evaluate(() => __v2.state().seqIdx.slice());
await feed(true, 1); await advance(0.15);
const a4 = await page.evaluate(() => __v2.state().seqIdx.slice());
R('進度獨立:AI 分對只動 AI 的序列(§6.1)', a4[1] === b4[1] + 1 && a4[0] === b4[0], b4 + '→' + a4);

// ---------- ⑤ 完成一組 ----------
await page.evaluate(() => { const v = __v2; v.v2s.seqIdx[0] = 3; v.v2s.energy[0] = 20; });
const e5 = await page.evaluate(() => __v2.state().energy[0]);
await feed(true); await advance(0.15);
const a5 = await page.evaluate(() => { const s = __v2.state(); return { sets: s.sets[0], idx: s.seqIdx[0], energy: s.energy[0] }; });
R('完成一組 → 下班進度 +1 + 能量 bonus', a5.sets === 1 && a5.idx === 4 && a5.energy > e5 + 12, JSON.stringify(a5));

// ---------- ⑥ 免費拳=踉蹌不暈 + 被打方充能(fighters[1] 當攻擊方,南邊遠離艙) ----------
await page.evaluate(() => {
  const v = __v2, a = v.fighters[1], o = v.fighters[0];
  v.v2s.energy = [0, 0]; a.ai = false;
  for (const f of [a, o]) { if (f.carryObj) { f.carryObj.held = false; f.carryObj = null; } f.carrying = null; f.carriedBy = null; } // AI 同事可能正扛著瓶 → 清掉(扛著不能出拳)
  o.x = 300; o.y = 560; o.stunned = false; o.invuln = 0; o.stability = 100; o.fumbleT = 0; o.restunT = 0; o._energyHitT = -9;
  a.x = o.x - 30; a.y = o.y; a.facing = 0; a.punchCd = 0; a.comboN = 2; a.comboT = 5; a.fumbleT = 0; a.stunned = false; // 直接出終結技(第三拳)
  v.punch(a);
});
await advance(0.6);
const s6 = await page.evaluate(() => { const s = __v2.state(); return { stunned: s.stunned[0], fumble: s.fumble[0], victimEnergy: s.energy[0], attackerEnergy: s.energy[1] }; });
R('能量未滿的第三拳 → 踉蹌不暈(§3.2 只造時間差)', s6.stunned === false, JSON.stringify(s6));
R('被正式命中 → 被打方充能(§3.3 反擊資源;打人不充自己)', s6.victimEnergy >= 20 && s6.attackerEnergy === 0, JSON.stringify(s6));

// ---------- ⑦ 能量滿第三拳=擊暈+清條 ----------
await page.evaluate(() => {
  const v = __v2, a = v.fighters[1], o = v.fighters[0];
  v.v2s.energy = [0, 100];
  for (const f of [a, o]) { if (f.carryObj) { f.carryObj.held = false; f.carryObj = null; } f.carrying = null; f.carriedBy = null; }
  o.x = 300; o.y = 560; o.stunned = false; o.invuln = 0; o.stability = 100; o.fumbleT = 0; o.restunT = 0; o.vx = 0; o.vy = 0;
  a.x = o.x - 30; a.y = o.y; a.facing = 0; a.punchCd = 0; a.comboN = 2; a.comboT = 5; a.fumbleT = 0; a.stunned = false;
  v.punch(a);
});
const stun7 = await waitFor('v.fighters[0].stunned', 2);
const s7 = await page.evaluate(() => ({ energy: __v2.state().energy[1] }));
R('能量滿的第三拳 → 擊暈 + 整條消耗(§13 定案 4)', stun7 && s7.energy === 0, 'stunned=' + stun7 + ' ' + JSON.stringify(s7));

// ---------- ⑧ 中途進艙=拒收吐回(不結束比賽) ----------
await page.evaluate(() => {
  const v = __v2, o = v.fighters[0];
  o.x = v.POD.x; o.y = v.POD.y; o.vx = 0; o.vy = 0; // 暈眩者在艙半徑 → containByEnviron → startEject
  window.__n8 = v.state().containLog.length;
});
const cap8 = await waitFor('v.state().eject !== null || v.state().containLog.length > window.__n8', 2);
const spit8 = await waitFor('v.state().eject === null && v.fighters[0].y < 240 && v.fighters[0].invuln > 0', 5);
const s8 = await page.evaluate(() => { const o = __v2.fighters[0]; return { y: Math.round(o.y), invuln: +o.invuln.toFixed(2), matchOver: __v2.state().matchOver, logGrew: __v2.state().containLog.length > window.__n8 }; });
R('中途進艙 → 捕捉+拒收 → 北管道吐回+受擊保護,比賽不結束(§3.5)', cap8 && spit8 && !s8.matchOver && s8.logGrew, JSON.stringify(s8));

// ---------- ⑨ 先完成 3 組=下班獲勝(輸家不在艙=加班 gag→報告) ----------
await page.evaluate(() => {
  const v = __v2; v.v2s.seqIdx[0] = 11; v.v2s.sets[0] = 2; // 差最後一件
  v.fighters[0].x = 200; v.fighters[0].y = 560; v.fighters[1].x = 700; v.fighters[1].y = 560; v.fighters[1].stunned = false;
});
await feed(true);
await waitFor('v.state().matchOver', 4); // ⚠ matchOver 凍結 game.time → 不能用 advance 等(會吊死)
const s9 = await page.evaluate(() => { const s = __v2.state(); return { matchOver: s.matchOver, winner: s.winnerPid, sets: s.sets[0], report: !!s.report, shiftEnded: s.shiftEnded }; });
R('先完成 3 組 → 提前下班獲勝(唯一勝利;加班 gag→報告)', s9.matchOver && s9.winner === 0 && s9.sets === 3 && s9.report, JSON.stringify(s9));

// ---------- ⑩ 整局限時歸零 → 完成多者獲勝 ----------
await page.evaluate(() => { __v2.restartMatch(); const v = __v2; v.v2s.introT = 0; v.v2s.sets = [0, 1]; v.v2s.clockT = 0.3; v.fighters[0].x = 200; v.fighters[0].y = 560; v.fighters[1].x = 700; v.fighters[1].y = 560; });
const t10 = await waitFor('v.state().matchOver', 3);
const s10 = await page.evaluate(() => ({ winner: __v2.state().winnerPid }));
R('時間到 → 完成組數多者獲勝(§6.2)', t10 && s10.winner === 1, JSON.stringify(s10));

// ---------- ⑪ AI 同事讀自己序列撿對元素 ----------
await page.evaluate(() => {
  __v2.restartMatch(); const v = __v2, o = v.fighters[1]; v.v2s.introT = 0; v.v2s.clockT = 999;
  o.ai = true; o._aiMode = 'demo'; o.x = 480; o.y = 120; o.carryObj = null;
  const need = v.state().seq[v.state().seqIdx[1]];
  const t = v.bottles.find(b => b.alive) || v.bottles[0];
  t.alive = true; t.held = false; t.elem = need; t.x = 480; t.y = 132; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9;
  for (const b of v.bottles) if (b !== t) { b.alive = false; b.respawn = 999; }
  v.fighters[0].x = 100; v.fighters[0].y = 560;
});
const cw0 = await page.evaluate(() => __v2.state().seqIdx[1]);
const cwOk = await waitFor(`v.state().seqIdx[1] > ${cw0} || !!v.fighters[1].carryObj`, 3);
const cw1 = await page.evaluate(() => ({ idx: __v2.state().seqIdx[1], carry: !!__v2.fighters[1].carryObj }));
R('AI 同事讀自己的序列撿對元素(競爭者)', cwOk && (cw1.idx > cw0 || cw1.carry), JSON.stringify(cw1));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
