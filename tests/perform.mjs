// 回收演出 V0.8 + 儀式分級(ring-1,使用者拍板 2026-07-29:前兩分=輕演出快節奏,**最後一分才播完整收容演出**)驗收:
// ①第1分收容=輕演出(**不開演出/不升罩**,即時計分+彈回出生點+無敵+升階)②第2分同輕演出(計分 2)
// ③第3分(賽點)收容=完整演出啟動(n=3/final/snap 艙心/玻璃罩)④演出期間不二次收容
// ⑤壓縮:敗方隱藏→matchOver+報告+罩收掉 ⑥無 console 錯誤
// 陷阱:rAF 節流(演出 2.88s 遊戲時 ≈ 最慢 ~90s 實時,waitForFunction 都放大 timeout);
//       輕演出彈回無敵 1.8s,連續收容之間要等 invuln 歸零。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const contain = () => page.evaluate(() => {
  const v = __v2;
  v.fighters[0].x = 480; v.fighters[0].y = 470; v.fighters[0].stunned = false; v.fighters[0].vx = 0; v.fighters[0].vy = 0;
  v.fighters[1].x = 480; v.fighters[1].y = 330; v.fighters[1]._lastItem = 'fire';
  v.stunFighter(v.fighters[1]);
});
const waitScore = (n) => page.waitForFunction(`__v2.state().roundWins[0] === ${n}`, { timeout: 60000 });
const waitPerform = () => page.waitForFunction('__v2.state().perform', { timeout: 30000 });
const waitPhase = (ph) => page.waitForFunction(`(__v2.state().perform||{}).phase === '${ph}'`, { timeout: 300000 }); // 300s:#3 要到 2.88s 遊戲時,rAF 節流最慢 ~3% 時 120s 會卡線
const waitEnd = () => page.waitForFunction('!__v2.state().perform', { timeout: 300000 });
const waitInvulnGone = () => page.evaluate(() => new Promise(res => { const iv = setInterval(() => { if (__v2.fighters[1].invuln <= 0 && !__v2.state().perform) { clearInterval(iv); res(); } }, 40); }));

// ---------- ① 第 1 分收容=輕演出(不開演出、直接計分+彈回) ----------
await contain(); await waitScore(1);
await page.evaluate(() => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= 0.3) { clearInterval(iv); res(); } }, 20); })); // 留幾步確認演出真的沒起
const s1 = await page.evaluate(() => ({ p: !!__v2.state().perform, wins: __v2.state().roundWins, stage: __v2.state().stage, dome: __lab.domeVisible(),
  loser: { x: Math.round(__v2.fighters[1].x), inv: +__v2.fighters[1].invuln.toFixed(1), stunned: __v2.fighters[1].stunned } }));
R('第1分=輕演出(不開演出/不升罩,即時計分 1-0)', !s1.p && !s1.dome && s1.wins[0] === 1 && s1.wins[1] === 0, JSON.stringify(s1));
R('輕演出=彈回出生點+短無敵+升階(stage 2)', s1.loser.x !== 480 && s1.loser.inv > 0 && s1.loser.inv < 3 && !s1.loser.stunned && s1.stage === 2, JSON.stringify(s1.loser) + ' stage=' + s1.stage);

// ---------- ② 第 2 分同輕演出 ----------
await waitInvulnGone();
await contain(); await waitScore(2);
const s2 = await page.evaluate(() => ({ p: !!__v2.state().perform, wins: __v2.state().roundWins, stage: __v2.state().stage }));
R('第2分=輕演出(計分 2-0、stage 3、仍無演出)', !s2.p && s2.wins[0] === 2 && s2.stage === 3, JSON.stringify(s2));

// ---------- ③ 第 3 分(賽點)= 完整收容演出 ----------
await waitInvulnGone();
await contain(); await waitPerform();
const domeUp = await page.waitForFunction('__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false); // 罩 sync 在下一幀 step 頂 → 輪詢
const s3 = await page.evaluate(() => ({ p: __v2.state().perform, wins: __v2.state().roundWins, loser: { x: __v2.fighters[1].x, y: __v2.fighters[1].y, inv: __v2.fighters[1].invuln, stunned: __v2.fighters[1].stunned } }));
R('賽點收容=完整演出啟動(n=3/final)', s3.p && s3.p.n === 3 && s3.p.final === true, JSON.stringify(s3.p));
R('計分即時(3-0)+敗方 snap 艙心受保護掙扎', s3.wins[0] === 3 && s3.loser.x === 480 && s3.loser.y === 320 && s3.loser.inv > 10 && s3.loser.stunned, JSON.stringify(s3.loser));
R('玻璃罩升起(domeVisible)', domeUp === true);

// ---------- ④ 演出期間不二次收容:勝方暈在艙內也不觸發 ----------
await page.evaluate(() => { const v = __v2; v.fighters[0].x = 480; v.fighters[0].y = 315; v.stunFighter(v.fighters[0]); });
await page.evaluate(() => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= 0.4) { clearInterval(iv); res(); } }, 20); }));
const s4 = await page.evaluate(() => ({ wins: __v2.state().roundWins, p: !!__v2.state().perform }));
R('演出期間勝方暈在艙內 → 不二次收容', s4.wins[0] === 3 && s4.wins[1] === 0 && s4.p, JSON.stringify(s4.wins));
await page.evaluate(() => { const v = __v2; v.fighters[0].stunned = false; v.fighters[0].stunT = 0; v.fighters[0].x = 480; v.fighters[0].y = 470; });

// ---------- ⑤ 壓縮 → matchOver + 報告 ----------
await waitPhase('resolve');
await new Promise(r => setTimeout(r, 120));
const s5a = await page.evaluate(() => ({ hidden: __v2.fighters[1]._hidden, enemies: __v2.game.enemies.length }));
R('壓縮:敗方隱藏(變包裝方塊)', s5a.hidden === true && s5a.enemies === 1, JSON.stringify(s5a));
await waitEnd();
const domeDown = await page.waitForFunction('!__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false);
const s5b = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report }));
R('最終封存 → matchOver + 事故報告 + 罩收掉', s5b.over && s5b.report && domeDown, JSON.stringify(s5b));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
