// flow-2「讓玩家察覺自己在接近失誤邊界」(玩家反饋 2026-08-03「擊暈得分太不起眼,不知不覺已累積 3 次失誤」)驗收:
// ①疲態檔位=被記錄數(0/1/2,封頂在 RECORD_TARGET-1)②冒汗:1 檔起、帶高度軸落下、滿檔更密
// ③暈/演出中不冒汗 ④立案 beat:記錄瞬間生成 recordCard(#N/事由/記錄方↔受害者)+快門音+短頓點
// ⑤beat 會自己過期(不殘留)⑥restartMatch 後疲態歸零 ⑦無 console 錯誤
// 陷阱:rAF 節流(?turbo=8)——recordCard.T=1.05 遊戲秒在 turbo 下只活 ~0.13s 實時,要「造完立刻讀」;
//       擺位離艙 >POD.r(貼艙擊暈=stun+失控入艙雙記錄);汗滴節拍吃 game.time,用 game.time 輪詢別用 setTimeout。
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
// (單點取樣的 sweatN 已退役——見 ② 的時間窗取樣說明)
// 遠離艙擺位 + pin 比分(記錄累積規則本身由 finisher.mjs 驗,這裡只驗「疲態讀數」)
const setRecords = (n) => page.evaluate(k => { const v = __v2;
  v.roundWins[0] = k;
  const f = v.fighters[1]; f.x = 260; f.y = 320; f.vx = 0; f.vy = 0;
  f.stunned = false; f.stunT = 0; f.restunT = 0; f.invuln = 0; f._performing = false; f._sweatT = 0;
  v.fighters[0].x = 200; v.fighters[0].y = 320;
  v.game.particles.length = 0; }, n);

// ---------- ① 疲態檔位=被記錄數(封頂 RECORD_TARGET-1=2) ----------
const levels = [];
for (const n of [0, 1, 2, 3]) { await setRecords(n); await gwait(0.2); levels.push(await page.evaluate(() => __v2.fighters[1].fatigue)); }
R('疲態檔位=被記錄數(0/1/2,滿檔封頂不再爬)', JSON.stringify(levels) === JSON.stringify([0, 1, 2, 2]), JSON.stringify(levels));
const mine = await page.evaluate(() => __v2.fighters[0].fatigue);
R('記錄方自己不疲態(疲態=被記錄數,不是總場次)', mine === 0, 'f0.fatigue=' + mine);

// ---------- ② 冒汗:1 檔起、帶高度軸、滿檔更密 ----------
// ⚠ 汗滴壽命 0.5s < 生成間隔 0.62s → **單點取樣常常是 0**(第一版就這樣假 FAIL)。
// 改成「開一個時間窗、用 Set 收集出現過的粒子物件」數累計生成量;高頻取樣(4ms)才追得上 turbo 下的短命粒子。
const sweatWindow = (sec) => page.evaluate(s => new Promise(res => {
  const seen = new Set(); const t0 = __v2.game.time;
  const iv = setInterval(() => {
    for (const p of __v2.game.particles) if (p.vh !== undefined) seen.add(p);
    if (__v2.game.time - t0 >= s) { clearInterval(iv); res({ n: seen.size, sample: [...seen][0] ? { h: Math.round([...seen][0].h), maxLife: [...seen][0].maxLife } : null }); }
  }, 4);
}), sec);
await setRecords(0); const w0 = await sweatWindow(2.0);
await setRecords(1); const w1 = await sweatWindow(2.0);
R('0 筆不冒汗、1 筆起冒汗', w0.n === 0 && w1.n > 0, `lv0=${w0.n} lv1=${w1.n}`);
const drop = await page.evaluate(() => { const p = __v2.game.particles.find(q => q.vh !== undefined); return p ? { h: Math.round(p.h) } : (window.__sweatSeen || null); });
R('汗滴帶高度軸(從頭頂附近拋出再落下)', !!w1.sample && w1.sample.h > 2 && w1.sample.h < 80, JSON.stringify(w1.sample) + ' now=' + JSON.stringify(drop));
await setRecords(1); const c1 = (await sweatWindow(3.0)).n;
await setRecords(2); const c2 = (await sweatWindow(3.0)).n;
R('滿檔冒汗更密(2 筆 > 1 筆)', c2 > c1, `lv1=${c1} lv2=${c2}`);

// ---------- ③ 暈眩/演出中不冒汗(狀態各自的語言不打架) ----------
await setRecords(2);
await page.evaluate(() => { const f = __v2.fighters[1]; f.stunned = true; f.stunT = 99; __v2.game.particles.length = 0; });
const sStun = (await sweatWindow(2.0)).n;
R('暈眩中不冒汗(★/垮肩自己說話)', sStun === 0, 'sweat=' + sStun);
await page.evaluate(() => { const f = __v2.fighters[1]; f.stunned = false; f.stunT = 0; f.restunT = 0; });

// ---------- ④ 立案 beat:記錄瞬間生成印章卡 + 快門音 + 短頓點 ----------
await page.evaluate(() => { const v = __v2; v.roundWins[0] = 0; v.roundWins[1] = 0; v.containLog.length = 0;
  const f = v.fighters[1]; f.x = 260; f.y = 320; f.stunned = false; f.stunT = 0; f.restunT = 0; f.invuln = 0;
  v.game.sfx.length = 0; v.game.hitstop = 0; v.stunFighter(f); });
const beat = await page.evaluate(() => { const v = __v2; const C = v.v2s.recordCard;
  return { card: C && { n: C.n, phrase: C.phrase, w: C.w, x: Math.round(C.x), y: Math.round(C.y), t: +C.t.toFixed(2) },
    flash: +v.v2s.recordFlash.toFixed(2), sfx: [...v.game.sfx], hitstop: +v.game.hitstop.toFixed(2) }; });
R('立案 beat:印章卡帶 #N/事由/記錄方,座標=受害者身上', beat.card && beat.card.n === 1 && beat.card.phrase === '擊暈' && beat.card.w === 0 && beat.card.x === 260, JSON.stringify(beat.card));
R('快門音 + 短頓點(標點感)+ recordFlash 起旗', beat.sfx.includes('shutter') && beat.hitstop > 0 && beat.flash > 0, JSON.stringify({ sfx: beat.sfx, hitstop: beat.hitstop, flash: beat.flash }));

// ---------- ⑤ beat 自己過期(不殘留) ----------
await page.waitForFunction('!__v2.v2s.recordCard', { timeout: 60000 });
R('beat 播完自動清除(不殘留在畫面上)', true);

// ---------- ⑥ restartMatch → 疲態歸零 ----------
await setRecords(2); await gwait(0.2);
await page.evaluate(() => __v2.restartMatch());
await gwait(0.3);
const after = await page.evaluate(() => ({ fat: __v2.fighters.map(f => f.fatigue), wins: [...__v2.roundWins], card: !!__v2.v2s.recordCard }));
R('restartMatch → 疲態歸零(比分清空後下一幀自然歸零)', after.fat[0] === 0 && after.fat[1] === 0 && after.wins[0] === 0 && !after.card, JSON.stringify(after));

// ---------- ⑦ 瀕界層(flow-2c):心跳只給本機玩家 + 首次一次性提示 + 演出中靜音 ----------
// ⚠ 心跳 push 進 game.sfx,而 v2.js **在同一個 JS turn 內** step×turbo 完就 drain(`sfx.length=0`)
//   → 外部輪詢永遠看到空陣列(第一版就這樣假 FAIL)。改成**攔截 push 計數**:drain 用 length=0,
//   陣列本體不換 → patch 活得過 drain。
const beats = (sec) => page.evaluate(s => new Promise(res => {
  const sfx = __v2.game.sfx, orig = sfx.push; let n = 0;
  sfx.push = function (...a) { for (const k of a) if (k === 'heartbeat') n++; return orig.apply(this, a); };
  const t0 = __v2.game.time;
  const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); sfx.push = orig; res(n); } }, 10);
}), sec);
// 對手瀕界(roundWins[LOCAL]=2)=好事,不該給玩家壓迫感 → 無心跳
await page.evaluate(() => { const v = __v2; v.restartMatch(); v.v2s.introT = 0; v.fighters[1].ai = false;
  v.roundWins[0] = 2; v.roundWins[1] = 0;
  for (const f of v.fighters) { f.x = 200 + f.pid * 60; f.y = 320; f.stunned = false; f.stunT = 0; f.invuln = 0; } });
await gwait(0.3);
const foeBrink = await beats(2.5);
R('對手瀕界不響心跳(心跳=自己的,不是場上音效)', foeBrink === 0, 'beats=' + foeBrink);
// 本機瀕界(roundWins[對面]=2)=心跳 + 一次性提示
await page.evaluate(() => { const v = __v2; v.roundWins[0] = 0; v.roundWins[1] = 2; v.v2s.brinkShown = false; v.v2s.bannerText = ''; });
await gwait(0.3);
const warn = await page.evaluate(() => ({ shown: __v2.state().brink.shown, banner: __v2.v2s.bannerText, t: +__v2.v2s.winBannerT.toFixed(1) }));
R('首次瀕界=一次性提示橫幅(把因果講白)', warn.shown && /收容封存/.test(warn.banner) && warn.t > 0, JSON.stringify(warn));
const myBeats = await beats(3.2);
R('本機瀕界=低頻心跳(約 1 秒一次)', myBeats >= 2, 'beats=' + myBeats);
// 一次性:清掉橫幅後不再重播提示(但心跳繼續)
await page.evaluate(() => { __v2.v2s.bannerText = ''; __v2.v2s.winBannerT = 0; });
await gwait(1.2);
const again = await page.evaluate(() => __v2.v2s.bannerText);
R('提示本場只播一次(不重複洗版)', again === '', 'banner=' + JSON.stringify(again));
// 演出/終演中靜音(戲在別處)
await page.evaluate(() => { __v2.v2s.perform = { n: 3, phase: 'capture', t: 0, T: 9, final: true, loser: 1, winner: 0, cls: {}, pk: 0, line: '', fired: 0, cube: null }; });
const mute = await beats(2.5);
await page.evaluate(() => { __v2.v2s.perform = null; });
R('收容演出中心跳靜音(戲在別處)', mute === 0, 'beats=' + mute);
// restartMatch → 一次性旗歸零(下一場會重播)
await page.evaluate(() => __v2.restartMatch());
await gwait(0.2);
const reset = await page.evaluate(() => __v2.state().brink);
R('restartMatch → 一次性提示旗重置(下一場重播)', reset.shown === false, JSON.stringify(reset));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
