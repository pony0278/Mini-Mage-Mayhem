// 回收演出 V0.8(收容後的招牌喜劇演出)驗收:
// ①收容→演出啟動(即時計分/敗方 snap 艙心+受保護/玻璃罩升起)②演出期間不二次收容(勝方暈在艙內也不觸發)
// ③收尾才彈回(出生點+無敵+升階+罩收掉)④第2次失控風味(衝突字+火花震開艙邊勝方)
// ⑤第3次最終(壓縮:敗方隱藏→matchOver+報告+罩收掉)⑥無 console 錯誤
// 陷阱:rAF 節流(演出 2.1~3.6s 遊戲時 ≈ 最慢 ~90s 實時,waitForFunction 都放大 timeout);
//       演出結束敗方出艙無敵 1.8s,連續收容之間要等 invuln 歸零。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const contain = () => page.evaluate(() => {
  const v = __v2;
  v.fighters[0].x = 480; v.fighters[0].y = 470; v.fighters[0].stunned = false; v.fighters[0].vx = 0; v.fighters[0].vy = 0;
  v.fighters[1].x = 480; v.fighters[1].y = 330; v.fighters[1]._lastItem = 'fire';
  v.stunFighter(v.fighters[1]);
});
const waitPerform = () => page.waitForFunction('__v2.state().perform', { timeout: 30000 });
const waitPhase = (ph) => page.waitForFunction(`(__v2.state().perform||{}).phase === '${ph}'`, { timeout: 120000 });
const waitEnd = () => page.waitForFunction('!__v2.state().perform', { timeout: 120000 });
const waitInvulnGone = () => page.evaluate(() => new Promise(res => { const iv = setInterval(() => { if (__v2.fighters[1].invuln <= 0 && !__v2.state().perform) { clearInterval(iv); res(); } }, 40); }));

// ---------- ① 收容 → 演出啟動 ----------
await contain(); await waitPerform();
const domeUp = await page.waitForFunction('__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false); // 罩 sync 在下一幀 step 頂 → 輪詢
const s1 = await page.evaluate(() => ({ p: __v2.state().perform, wins: __v2.state().roundWins, loser: { x: __v2.fighters[1].x, y: __v2.fighters[1].y, inv: __v2.fighters[1].invuln, stunned: __v2.fighters[1].stunned }, dome: __lab.domeVisible() }));
s1.dome = domeUp;
R('收容 → 演出啟動(phase=capture,n=1)', s1.p && s1.p.n === 1, JSON.stringify(s1.p));
R('計分即時(roundWins 先加)', s1.wins[0] === 1 && s1.wins[1] === 0, s1.wins.join('-'));
R('敗方 snap 艙心 + 受保護(invuln)+ 掙扎姿勢(stunned)', s1.loser.x === 480 && s1.loser.y === 320 && s1.loser.inv > 10 && s1.loser.stunned, JSON.stringify(s1.loser));
R('玻璃罩升起(domeVisible)', s1.dome === true);

// ---------- ② 演出期間不二次收容:勝方暈在艙內也不觸發 ----------
await page.evaluate(() => { const v = __v2; v.fighters[0].x = 480; v.fighters[0].y = 315; v.stunFighter(v.fighters[0]); });
await page.evaluate(() => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= 0.4) { clearInterval(iv); res(); } }, 20); }));
const s2 = await page.evaluate(() => ({ wins: __v2.state().roundWins, p: __v2.state().perform }));
R('演出期間勝方暈在艙內 → 不二次收容', s2.wins[0] === 1 && s2.wins[1] === 0 && s2.p && s2.p.n === 1, JSON.stringify(s2.wins));
await page.evaluate(() => { const v = __v2; v.fighters[0].stunned = false; v.fighters[0].stunT = 0; v.fighters[0].x = 480; v.fighters[0].y = 470; }); // 移出艙,免得演出結束後被收

// ---------- ③ 收尾:彈回出生點 + 無敵 + 升階 + 罩收掉 ----------
await waitEnd();
const domeDown = await page.waitForFunction('!__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false); // 收罩同樣下一幀,輪詢
const s3 = await page.evaluate(() => ({ loser: { x: Math.round(__v2.fighters[1].x), y: Math.round(__v2.fighters[1].y), inv: __v2.fighters[1].invuln, stunned: __v2.fighters[1].stunned }, stage: __v2.state().stage, dome: __lab.domeVisible() }));
s3.dome = !domeDown;
R('收尾才彈回(出生點+短無敵+解除掙扎)', s3.loser.x !== 480 && s3.loser.inv > 0 && s3.loser.inv < 3 && !s3.loser.stunned, JSON.stringify(s3.loser));
R('收尾後升階(stage 2)+ 罩收掉', s3.stage === 2 && s3.dome === false, 'stage=' + s3.stage + ' dome=' + s3.dome);

// ---------- ④ 第 2 次:失控風味(衝突字 + 火花震開艙邊勝方) ----------
await waitInvulnGone();
await contain(); await waitPerform();
await waitPhase('scan');
const s4a = await page.evaluate(() => __v2.state().perform.line);
R('第2次掃描=分類衝突字', /分類衝突/.test(s4a), s4a);
await page.evaluate(() => { const v = __v2; v.fighters[0].x = 480; v.fighters[0].y = 420; v.fighters[0].vx = 0; v.fighters[0].vy = 0; }); // 站艙邊等被震
await waitPhase('resolve');
await new Promise(r => setTimeout(r, 100));
const s4b = await page.evaluate(() => ({ v: Math.hypot(__v2.fighters[0].vx, __v2.fighters[0].vy), y: __v2.fighters[0].y }));
R('失控火花震開艙邊勝方(獲得速度/位移)', s4b.v > 30 || s4b.y > 430, JSON.stringify(s4b));
await waitEnd();

// ---------- ⑤ 第 3 次:最終壓縮 → matchOver + 報告 ----------
await waitInvulnGone();
await contain(); await waitPerform();
const s5a = await page.evaluate(() => __v2.state().perform);
R('第3次=最終風味(n=3, final)', s5a.n === 3 && s5a.final === true, JSON.stringify(s5a));
await waitPhase('resolve');
await new Promise(r => setTimeout(r, 120));
const s5b = await page.evaluate(() => ({ hidden: __v2.fighters[1]._hidden, enemies: __v2.game.enemies.length }));
R('壓縮:敗方隱藏(變包裝方塊)', s5b.hidden === true && s5b.enemies === 1, JSON.stringify(s5b));
await waitEnd();
const domeDown3 = await page.waitForFunction('!__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false);
const s5c = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report, dome: __lab.domeVisible() }));
s5c.dome = !domeDown3;
R('最終封存 → matchOver + 事故報告 + 罩收掉', s5c.over && s5c.report && !s5c.dome, JSON.stringify(s5c));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
