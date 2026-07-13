// 回收口演出(憲章 v1.1 §3.5:招牌干擾+讀法 B 結局)驗收:
// ①中途進艙=捕捉演出(罩升起/釘艙心/受保護/「不得分」)②拒收吐回:北管道拋回+落地保護+比賽繼續
// ③吐回演出期間不二次捕捉 ④讀法 B:下班鐘響時輸家在艙內 → 轉正式封艙(perform #3 壓縮)→ matchOver+報告+罩收
// ⑤無 console 錯誤
// 陷阱:rAF 節流(吐回 1.8s+飛行 0.7s 遊戲時 ≈ 最慢 ~80s 實時);吐回後受擊保護要等歸零才能再捕捉。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const waitFor = (fnStr, tmax = 6) => page.evaluate((src, tm) => new Promise(res => {
  const f = new Function('v', 'return (' + src + ')'), v = window.__v2, t0 = v.game.time;
  const iv = setInterval(() => { const ok = f(v); if (ok || v.game.time - t0 > tm) { clearInterval(iv); res(!!ok); } }, 25);
}), fnStr, tmax);
await page.evaluate(() => { __v2.v2s.introT = 0; __v2.v2s.clockT = 999; __v2.fighters[1].ai = false; });

const capture = () => page.evaluate(() => { // 把 f1 弄暈放進艙 → containByEnviron → startEject
  const v = __v2, o = v.fighters[1];
  o.stunned = false; o.stunT = 0; o.restunT = 0; o.invuln = 0; o.fumbleT = 0; o.vx = 0; o.vy = 0; o._thrownT = -9;
  v.fighters[0].x = 200; v.fighters[0].y = 560;
  v.stunFighter(o); o.x = v.POD.x; o.y = v.POD.y;
});

// ---------- ① 捕捉演出啟動 ----------
await capture();
const cap1 = await waitFor('v.state().eject !== null', 3);
const domeUp = await page.waitForFunction('__lab.domeVisible()', { timeout: 30000 }).then(() => true).catch(() => false);
const s1 = await page.evaluate(() => ({ e: __v2.state().eject, loser: { x: __v2.fighters[1].x, y: __v2.fighters[1].y, inv: __v2.fighters[1].invuln }, over: __v2.state().matchOver }));
R('中途進艙 → 捕捉演出(eject 啟動,phase=capture)', cap1 && s1.e && s1.e.pid === 1, JSON.stringify(s1.e));
R('被捕方釘艙心+受保護;不得分不結束(§3.5)', s1.loser.x === 480 && s1.loser.y === 320 && s1.loser.inv > 10 && !s1.over, JSON.stringify(s1.loser));
R('玻璃罩升起(捕捉演出共用 perform 罩)', domeUp === true);

// ---------- ③(趁演出中)不二次捕捉 ----------
await page.evaluate(() => { const v = __v2; window.__log0 = v.state().containLog.length; v.stunFighter(v.fighters[0]); v.fighters[0].x = v.POD.x; v.fighters[0].y = v.POD.y - 8; });
await waitFor('false', 0.4); // 等 0.4s 遊戲時
const s3 = await page.evaluate(() => ({ grew: __v2.state().containLog.length > window.__log0, still: !!__v2.state().eject }));
R('吐回演出期間不二次捕捉(containLog 沒有第二筆)', s3.grew === false && s3.still, JSON.stringify(s3));
await page.evaluate(() => { const v = __v2; v.fighters[0].stunned = false; v.fighters[0].stunT = 0; v.fighters[0].x = 200; v.fighters[0].y = 560; }); // 移出艙

// ---------- ② 拒收吐回 ----------
const spit = await waitFor('v.state().eject === null && v.fighters[1].y < 240', 6);
const s2 = await page.evaluate(() => ({ y: Math.round(__v2.fighters[1].y), inv: +__v2.fighters[1].invuln.toFixed(2), over: __v2.state().matchOver }));
R('拒收 → 北管道吐回(落點北帶)+受擊保護+比賽繼續', spit && s2.inv > 0 && !s2.over, JSON.stringify(s2));

// ---------- ④ 讀法 B:鐘響時輸家在艙內 → 轉正式封艙(perform #3) ----------
const invGone = await waitFor('v.fighters[1].invuln <= 0', 6);
await capture();
await waitFor('v.state().eject !== null', 3);
await page.evaluate(() => { __v2.endShift(0, 'sets'); }); // 玩家完成配額,鐘響——而對手正被艙咬住
const s4 = await page.evaluate(() => ({ p: __v2.state().perform, eject: __v2.state().eject }));
R('讀法 B:鐘響+輸家在艙 → 取消吐回、轉最終封艙(n=3)', invGone && s4.p && s4.p.n === 3 && s4.p.final === true && !s4.eject, JSON.stringify(s4.p));
const hid = await waitFor('v.fighters[1]._hidden === true', 8);
R('壓縮:輸家隱藏(變包裝方塊北送)', hid);
const over = await waitFor('v.state().matchOver', 8);
const domeDown = await page.waitForFunction('!__lab.domeVisible()', { timeout: 30000 }).then(() => true).catch(() => false);
const s5 = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report, winner: __v2.state().winnerPid }));
R('封艙收尾 → matchOver+報告+罩收掉(勝者=下班者)', over && s5.over && s5.report && s5.winner === 0 && domeDown, JSON.stringify(s5));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
