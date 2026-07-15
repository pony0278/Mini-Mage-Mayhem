// 上手框架(使用者上手文檔 2026-07;爽鬥 A 款)驗收——只驗「開場易讀」框架:
// ①全新玩家=首局教學旗標(localStorage 空)+ AI 對手開場即開(純戰鬥;小人不搬東西)②開場字幕/鏡頭帶場計時
// ③就位期 AI 靜止(「開始!」前不開工)④首局打完記 localStorage(下次不教學)⑤無錯
// 陷阱:rAF 節流→game.time 輪詢 advance;matchOver 後 game.time 凍結→用 waitForFunction 等 tutorial-flip
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('mmm_v2_played'); } catch { /* privacy */ } }); // 模擬全新玩家
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);

// ---------- ① 首局教學旗標 + AI 同事開場即開 ----------
const boot = await page.evaluate(() => ({ tutorial: __v2.state().tutorial, aiMode: __v2.state().aiMode, aiOn: __v2.fighters[1].ai, introT: __v2.state().introT }));
R('全新玩家 → 首局教學(tutorial)', boot.tutorial === true, JSON.stringify(boot));
R('AI 對手開場即開(fight=純戰鬥;分類同事凍結在 B 款)', boot.aiOn === true && boot.aiMode === 'fight');
R('開場目標字幕/鏡頭帶場計時中(introT>0)', boot.introT > 0);

// ---------- ② 就位期 AI 靜止 ----------
const holdPos = await page.evaluate(() => [Math.round(__v2.fighters[1].x), Math.round(__v2.fighters[1].y)]);
await advance(0.4);
const holdPos2 = await page.evaluate(() => [Math.round(__v2.fighters[1].x), Math.round(__v2.fighters[1].y)]);
R('就位期 AI 靜止(「開始!」前不開工)', holdPos[0] === holdPos2[0] && holdPos[1] === holdPos2[1], holdPos + ' vs ' + holdPos2);

// ---------- ③ 首局打完 → 記 localStorage ----------
await page.evaluate(() => __v2.endMatch(0));
await page.waitForFunction('!__v2.state().tutorial', { timeout: 30000 }).catch(() => {}); // matchOver → game.time 凍結;輪詢等 step 跑 tutorial-flip
const played = await page.evaluate(() => ({ tut: __v2.state().tutorial, ls: (() => { try { return localStorage.getItem('mmm_v2_played'); } catch { return '?'; } })() }));
R('首局結束 → tutorial 關 + localStorage 記「玩過」', played.tut === false && played.ls === '1', JSON.stringify(played));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
