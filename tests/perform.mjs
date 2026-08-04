// 收容封存演出(規格 G flow-1 改版;舊「儀式分級」的輕演出→退役,中段=拒收吐回)驗收:
// ①中段(記錄<3)入艙=拒收不封存(無演出/無罩,+1 記錄→剛好集滿=收容指令)②賽末點入艙=完整封存演出
// (n=3/final/snap 艙心/玻璃罩)③演出期間不二次收容 ④壓縮:敗方隱藏→matchOver+報告+罩收掉 ⑤無 console 錯誤
// 記錄的累積規則(stun/fall/拒收)由 tests/finisher.mjs 驗;這裡直接 pin __v2.roundWins 造局,專驗封存演出本體。
// 陷阱:rAF 節流(演出 2.88s 遊戲時 ≈ 最慢 ~90s 實時,waitForFunction 都放大 timeout);
//       失控入艙判定對 invuln>0 早退——拒收吐回帶 1.4s 保護,賽末點入艙前要清 invuln。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const gwait = (sec) => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
// 把 f1「已暈」直接擺進艙(手動設旗=不經 stunFighter → 不多記 stun、不開終演窗口;失控入艙判定接手)
const podEntry = () => page.evaluate(() => { const v = __v2; const f = v.fighters[1];
  f.stunned = true; f.stunT = 5; f.restunT = 0; f.invuln = 0; f.fumbleT = 0; f._performing = false; f.carriedBy = null;
  f.vx = 0; f.vy = 0; f._lastItem = 'fire';
  f.x = v.POD.x; f.y = v.POD.y; });

// ---------- ① 中段(記錄 2<3)入艙 = 拒收不封存 ----------
await page.evaluate(() => { __v2.roundWins[0] = 2; }); // pin:前兩筆記錄已發生(記錄累積規則歸 finisher.mjs)
await podEntry();
const gotReject = await page.waitForFunction('__v2.state().reject', { timeout: 60000 }).then(() => true).catch(() => false);
const s1 = await page.evaluate(() => { const st = __v2.state(); return { p: !!st.perform, wins: st.roundWins, dome: __lab.domeVisible() }; });
R('中段入艙=拒收不封存(無演出/無罩/+1 記錄→3=收容指令)', gotReject && !s1.p && !s1.dome && s1.wins[0] === 3, JSON.stringify(s1));
await page.waitForFunction('!__v2.state().reject', { timeout: 120000 });

// ---------- ② 賽末點(記錄 3)入艙 = 完整封存演出 ----------
await gwait(0.2);
await podEntry();
const gotPerform = await page.waitForFunction('__v2.state().perform', { timeout: 60000 }).then(() => true).catch(() => false);
const domeUp = await page.waitForFunction('__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false); // 罩 sync 在下一幀 step 頂 → 輪詢
const s2 = await page.evaluate(() => ({ p: __v2.state().perform, wins: __v2.state().roundWins,
  loser: { x: __v2.fighters[1].x, y: __v2.fighters[1].y, inv: __v2.fighters[1].invuln, stunned: __v2.fighters[1].stunned } }));
R('賽末點入艙=完整封存演出(n=3/final)', gotPerform && s2.p && s2.p.n === 3 && s2.p.final === true, JSON.stringify(s2.p));
R('封存計分(4=3 記錄+封存)+敗方 snap 艙心受保護掙扎', s2.wins[0] === 4 && s2.loser.x === 480 && s2.loser.y === 320 && s2.loser.inv > 10 && s2.loser.stunned, JSON.stringify(s2.loser));
R('玻璃罩升起(domeVisible)', domeUp === true);

// ---------- ③ 演出期間不二次收容:勝方暈在艙內也不觸發 ----------
await page.evaluate(() => { const v = __v2; v.fighters[0].x = 480; v.fighters[0].y = 315; v.stunFighter(v.fighters[0]); });
await gwait(0.4);
const s3 = await page.evaluate(() => ({ wins: __v2.state().roundWins, p: !!__v2.state().perform }));
R('演出期間勝方暈在艙內 → 不二次收容/不多記錄', s3.wins[0] === 4 && s3.wins[1] === 0 && s3.p, JSON.stringify(s3));
await page.evaluate(() => { const v = __v2; v.fighters[0].stunned = false; v.fighters[0].stunT = 0; v.fighters[0].x = 480; v.fighters[0].y = 470; });

// ---------- ④ 壓縮 → matchOver + 報告 ----------
await page.waitForFunction("(__v2.state().perform||{}).phase === 'resolve'", { timeout: 300000 }); // 300s:2.88s 遊戲時,rAF 節流最慢 ~3% 時 120s 會卡線
await new Promise(r => setTimeout(r, 120));
const s4a = await page.evaluate(() => ({ hidden: __v2.fighters[1]._hidden, enemies: __v2.game.enemies.length }));
R('壓縮:敗方隱藏(變包裝方塊)', s4a.hidden === true && s4a.enemies === 1, JSON.stringify(s4a));
await page.waitForFunction('!__v2.state().perform', { timeout: 300000 });
const domeDown = await page.waitForFunction('!__lab.domeVisible()', { timeout: 15000 }).then(() => true).catch(() => false);
const s4b = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report }));
R('最終封存 → matchOver + 罩收掉(camp-2:事故報告退役)', s4b.over && !s4b.report && domeDown, JSON.stringify(s4b));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
