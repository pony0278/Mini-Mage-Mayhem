// 開放邊緣+墜落計分(ring-1;朋友提案、使用者拍板「對等計分+儀式分級」2026-07-29)驗收:
// ①rim 地形(邊帶=虛空/內圈+四角平台=實心;__lab.rimOn 井視覺在)②走出邊=死亡劇場→對手得分
// (containLog method='fall'、警戒升階)→ 出生點重生+短無敵 ③自摔歸因(lastHitBy<0 → inc.selfFalls)
// ④被打下去歸因(lastHitBy=對手 → inc.knockoffs)⑤終局 by 墜落=廢料井封存(matchOver+報告,不開罩)
// ⑥AI 邊緣迴避(站邊上追對面的目標,3s 不自己走下去)⑦道具落井(瓶丟進邊帶=落井 despawn)⑧無 console 錯誤
// 陷阱:①墜落鏈 0.6s 劇場+1.3s respawn——turbo=8 下一批就跨過,斷言抓「結果狀態」別抓中途
//       ②墜落者 down 期間 game.enemies 過濾掉=渲染正常 ③AI 迴避測試要把 AI 放邊帶內緣、目標放對面(誘導直線穿越)
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.bringToFront();
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 700; v.fighters[1].y = 300; });
const advance = (sec) => page.evaluate(s => new Promise(r => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); r(); } }, 20); }), sec);

// ---------- ① rim 地形(ring-3:矩形戰場 ∪ 外掛角落圓台) ----------
// oldTab=(30,200):ring-1 的 230² 角平台範圍內、但在矩形與圓台之外——ring-3 這裡=井(舊角平台真的縮成圓台)
const geo = await page.evaluate(() => ({ rimOn: __lab.rimOn(), mid: __v2.onSolid(480, 320), top: __v2.onSolid(480, 20),
  left: __v2.onSolid(20, 320), oldTab: __v2.onSolid(30, 200), disc: __v2.onSolid(64, 64), cornerFar: __v2.onSolid(40, 600), station: __v2.onSolid(896, 576) }));
R('rim 地形(矩形+四圓台實心/邊帶與舊角平台=虛空/井視覺在)',
  geo.rimOn && geo.mid && !geo.top && !geo.left && !geo.oldTab && geo.disc && geo.cornerFar && geo.station, JSON.stringify(geo));

// ---------- ②③ 自摔:走出邊 → 對手得分 + selfFalls ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.x = 480; f.y = 100; f.vx = 0; f.vy = -420; f.lastHitBy = -1; f.invuln = 0; });
await page.waitForFunction('__v2.roundWins[1] === 1', { timeout: 30000 }).then(() => true).catch(() => false);
const fall1 = await page.evaluate(() => ({ wins: [...__v2.roundWins], log: __v2.containLog.map(c => c.method), stage: __v2.v2s.stage, self: __v2.inc.selfFalls[0] }));
R('自摔=對手得分(method=fall、警戒升階)', fall1.wins[1] === 1 && fall1.log[0] === 'fall' && fall1.stage === 2, JSON.stringify(fall1));
R('自摔歸因(inc.selfFalls)', fall1.self === 1, 'selfFalls=' + fall1.self);
const back = await page.waitForFunction('__v2.fighters[0].state === "alive" && __v2.fighters[0].y > 400', { timeout: 30000 }).then(() => true).catch(() => false);
const inv = await page.evaluate(() => +__v2.fighters[0].invuln.toFixed(1));
R('墜落者出生點重生+短無敵', back && inv > 0, 'invuln=' + inv);

// ---------- ④ 被打下去:lastHitBy=對手 → knockoffs ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.invuln = 0; f.x = 480; f.y = 100; f.vx = 0; f.vy = -420; f.lastHitBy = 1; f.lastHitT = __v2.game.time; });
await page.waitForFunction('__v2.roundWins[1] === 2', { timeout: 30000 }).then(() => true).catch(() => false);
const fall2 = await page.evaluate(() => ({ wins: [...__v2.roundWins], ko: __v2.inc.knockoffs[1] }));
R('被打下去=擊落歸因(inc.knockoffs)', fall2.wins[1] === 2 && fall2.ko === 1, JSON.stringify(fall2));

// ---------- ⑤ 終局 by 墜落=廢料井封存(不開罩,直接 matchOver+報告) ----------
await page.waitForFunction('__v2.fighters[0].state === "alive"', { timeout: 30000 });
await page.evaluate(() => { const f = __v2.fighters[0]; f.invuln = 0; f.x = 480; f.y = 100; f.vx = 0; f.vy = -420; f.lastHitBy = 1; });
await page.waitForFunction('__v2.state().matchOver', { timeout: 30000 }).then(() => true).catch(() => false);
const fin = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report, wins: [...__v2.roundWins], dome: __lab.domeVisible(), perform: !!__v2.state().perform }));
R('終局 by 墜落=廢料井封存(matchOver+報告、不開玻璃罩)', fin.over && fin.report && fin.wins[1] === 3 && !fin.dome && !fin.perform, JSON.stringify(fin));

// ---------- ⑥ AI 邊緣迴避 ----------
await page.evaluate(() => { __v2.restartMatch(); __v2.v2s.introT = 0; });
await page.evaluate(() => { const v = __v2; const ai = v.fighters[1]; ai.ai = true; ai._aiMode = 'fight';
  ai.x = 480; ai.y = 90; ai.vx = 0; ai.vy = 0;                       // AI 站上邊帶內緣
  v.fighters[0].x = 480; v.fighters[0].y = 30; v.fighters[0].invuln = 99; v.fighters[0].stunned = false; }); // 目標=邊帶正中(誘導直線穿越)
await advance(3.0);
const ai = await page.evaluate(() => ({ falling: __v2.fighters[1].falling, state: __v2.fighters[1].state, y: Math.round(__v2.fighters[1].y), solid: __v2.onSolid(__v2.fighters[1].x, __v2.fighters[1].y), wins: [...__v2.roundWins] }));
R('AI 邊緣迴避(誘導 3s 不自己走下井)', ai.state === 'alive' && !ai.falling && ai.solid, JSON.stringify(ai));

// ---------- ⑦ 道具落井:瓶落在邊帶=despawn ----------
const bott = await page.evaluate(() => {
  const t = __v2.bottles[0];
  t.alive = true; t.held = false; t.landed = true; t.z = 0; t.x = 480; t.y = 30; t.vx = 0; t.vy = 0; // 直接擺在邊帶
  return new Promise(res => { const iv = setInterval(() => { if (!t.alive) { clearInterval(iv); res({ gone: true, respawn: +t.respawn.toFixed(1) }); } }, 30); setTimeout(() => { clearInterval(iv); res({ gone: !t.alive }); }, 8000); });
});
R('瓶落在邊帶=落井 despawn(帶 respawn)', bott.gone === true, JSON.stringify(bott));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
