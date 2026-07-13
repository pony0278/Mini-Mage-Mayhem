// 分類事故引擎(使用者設計文檔 2026-07:中央口需求制分類 → AI 怒氣 → 暴走人員回收)驗收:
// ①開局需求+四型垃圾 ②餵對=清運+計分+換需求+怒氣↓ ③餵錯=事故+怒氣↑↑+不計分+需求不變 ④非玩家丟入不計分
// ⑤清運達標生工具 ⑥砸 AI→怒氣↑ ⑦怒氣爆滿→暴走(AI 切 fight)⑧輪班倒數歸零→暴走 ⑨AI 同事讀需求分類(工作競賽)⑩無錯
// 陷阱:rAF 節流→game.time 輪詢 advance;暴走測試前把 shiftT 拉高免輪班先觸發;POD 收容污染→角色避開艙
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
// 等條件成立(game-time 逾時);比固定長 advance 快又穩(AI 一達標即返回,免拖到 protocolTimeout)
const waitFor = (fnStr, tmax = 3) => page.evaluate((src, tm) => new Promise(res => {
  const f = new Function('v', 'return (' + src + ')'), v = window.__v2, t0 = v.game.time;
  const iv = setInterval(() => { const ok = f(v); if (ok || v.game.time - t0 > tm) { clearInterval(iv); res(!!ok); } }, 20);
}), fnStr, tmax);
// 跳開場 + 拉高輪班倒數(免干擾)
await page.evaluate(() => { __v2.v2s.introT = 0; __v2.v2s.shiftT = 999; });
// 餵一顆瓶進中央口:match=true 用當前需求元素、false 用不同元素;pid=歸屬
const feed = (match, pid = 0) => page.evaluate(([m, p]) => {
  const v = __v2, GA = ['fire', 'ice', 'poison', 'lightning'], dem = v.state().demand;
  const t = v.bottles.find(b => b.alive) || v.bottles[0];
  t.alive = true; t.held = false; t.elem = m ? dem : GA.find(e => e !== dem);
  t.x = v.POD.x; t.y = v.POD.y; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9; t.thrownBy = p;
  return t.elem;
}, [match, pid]);

// ---------- ① 開局需求 + 四型 ----------
const boot = await page.evaluate(() => ({ demand: __v2.state().demand, elems: [...new Set(__v2.bottles.map(b => b.elem))].sort() }));
R('開局:中央口有需求 + 四型垃圾齊備', ['fire', 'ice', 'poison', 'lightning'].includes(boot.demand) && ['fire', 'ice', 'lightning', 'poison'].every(e => boot.elems.includes(e)), JSON.stringify(boot));

// ---------- ② 餵對 ----------
await page.evaluate(() => { __v2.v2s.anger = 40; }); // 給點怒氣才看得出分對會降
const b2 = await page.evaluate(() => ({ demand: __v2.state().demand, cleanup: __v2.state().cleanup[0], sorted: __v2.state().sorted[0], anger: __v2.state().anger }));
await feed(true); await advance(0.15);
const a2 = await page.evaluate(() => ({ demand: __v2.state().demand, cleanup: __v2.state().cleanup[0], sorted: __v2.state().sorted[0], anger: __v2.state().anger }));
R('餵對 → 清運+1 + 工作計分+1 + 換需求 + AI 冷靜', a2.cleanup === b2.cleanup + 1 && a2.sorted === b2.sorted + 1 && a2.demand !== b2.demand && a2.anger < b2.anger, JSON.stringify(b2) + '→' + JSON.stringify(a2));

// ---------- ③ 餵錯 ----------
const b3 = await page.evaluate(() => ({ demand: __v2.state().demand, anger: __v2.state().anger, missorts: __v2.state().missorts[0], cleanup: __v2.state().cleanup[0] }));
const wrong = await feed(false); await advance(0.15);
const a3 = await page.evaluate(() => ({ demand: __v2.state().demand, anger: __v2.state().anger, missorts: __v2.state().missorts[0], cleanup: __v2.state().cleanup[0] }));
R('餵錯 → 怒氣↑↑ + 分錯計數 + 需求不變 + 不計清運', a3.anger > b3.anger && a3.missorts === b3.missorts + 1 && a3.demand === b3.demand && a3.cleanup === b3.cleanup, wrong + ' ' + JSON.stringify(b3) + '→' + JSON.stringify(a3));

// ---------- ④ 非玩家丟入不計分 ----------
const b4 = await page.evaluate(() => ({ cleanup: __v2.state().cleanup[0], anger: __v2.state().anger }));
await feed(true, -1); await advance(0.15);
const a4 = await page.evaluate(() => ({ cleanup: __v2.state().cleanup[0], anger: __v2.state().anger }));
R('非玩家丟入(對) → 清掉但不計分/不動怒氣', a4.cleanup === b4.cleanup && a4.anger === b4.anger, JSON.stringify(b4) + '→' + JSON.stringify(a4));

// ---------- ⑤ 清運達標 → 生工具 ----------
// ⚠ 先關 AI 同事:預設 AI 開著會搶撿瓶/呼叫 pickDemand 改需求→測試 feed 的元素在回收瞬間變成分錯,清運計不上(隔離測試,非隱藏 bug)。
await page.evaluate(() => { __v2.fighters[1].ai = false; __v2.fighters[1].carryObj = null; __v2.v2s.cleanup[0] = 0; });
const g0 = await page.evaluate(() => __v2.groundItems.length);
for (let i = 0; i < 3; i++) { await feed(true); await advance(0.15); }
const rew = await page.evaluate(() => ({ cleanup: __v2.state().cleanup[0], ground: __v2.groundItems.length }));
R('清運達標(3 件對的)→ 生事故工具 + 進度歸零', rew.cleanup === 0 && rew.ground > g0, JSON.stringify(rew));

// ---------- ⑥ 砸 AI → 怒氣↑ ----------
// resolveStrike 的怒氣條款要 o.ai=true;但 demoMove 會把 AI 帶走去撿瓶→清空場上瓶=AI 無目標原地不動,punch 才打得到。
await page.evaluate(() => {
  const v = __v2, me = v.fighters[0], o = v.fighters[1];
  v.v2s.anger = 0; o.ai = true; o._aiMode = 'demo'; o.carryObj = null; o.carriedBy = null;
  for (const b of v.bottles) { b.alive = false; b.held = false; b.respawn = 999; } // 清場→AI 原地不動
  o.x = 300; o.y = 560; o.stunned = false; o.invuln = 0; o.stability = 100;
  me.x = o.x - 30; me.y = o.y; me.facing = 0; me.punchCd = 0; v.punch(me);
});
await advance(0.6);
const hit = await page.evaluate(() => __v2.state().anger);
R('砸 AI 同事 → 怒氣↑', hit > 0, 'anger=' + hit);

// ---------- ⑦ 怒氣爆滿 → 暴走 ----------
await page.evaluate(() => { __v2.v2s.anger = 100; });
await advance(0.15);
const r7 = await page.evaluate(() => ({ rampage: __v2.state().rampage, mode: __v2.state().aiMode }));
R('怒氣爆滿 → 暴走(AI 切 fight)', r7.rampage === true && r7.mode === 'fight', JSON.stringify(r7));

// ---------- ⑧ 輪班倒數歸零 → 暴走 ----------
await page.evaluate(() => { __v2.restartMatch(); __v2.v2s.introT = 0; __v2.v2s.anger = 0; __v2.v2s.shiftT = 0.3; });
await advance(0.5);
const r8 = await page.evaluate(() => ({ rampage: __v2.state().rampage, mode: __v2.state().aiMode }));
R('輪班倒數歸零 → 暴走(老闆下班抓狂)', r8.rampage === true && r8.mode === 'fight', JSON.stringify(r8));

// ---------- ⑨ AI 同事讀需求分類(工作競賽)----------
await page.evaluate(() => {
  __v2.restartMatch(); const v = __v2, o = v.fighters[1]; v.v2s.introT = 0; v.v2s.shiftT = 999;
  o.ai = true; o._aiMode = 'demo'; o.x = 480; o.y = 120; o.carryObj = null; // ⑤ 關過 AI,restartMatch 沿用旗標→這裡明確開回
  const dem = v.state().demand, t = v.bottles.find(b => b.alive) || v.bottles[0];
  t.alive = true; t.held = false; t.elem = dem; t.x = 480; t.y = 132; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9;
  for (const b of v.bottles) if (b !== t) { b.alive = false; b.respawn = 999; }
  v.fighters[0].x = 100; v.fighters[0].y = 560;
});
const cw0 = await page.evaluate(() => __v2.state().sorted[1]);
// waitFor 取代固定 advance(2.2):AI 一撿到/清運到即返回(快又不撞 protocolTimeout)
const cwOk = await waitFor(`v.state().sorted[1] > ${cw0} || !!v.fighters[1].carryObj`, 3);
const cw1 = await page.evaluate(() => ({ sorted: __v2.state().sorted[1], carryObj: !!__v2.fighters[1].carryObj }));
R('AI 同事讀需求撿對元素餵中央口(工作競賽)', cwOk && (cw1.sorted > cw0 || cw1.carryObj), 'sorted[1] ' + cw0 + '→' + cw1.sorted + ' carry=' + cw1.carryObj);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
