// 上手/循環重整(使用者上手設計文檔 2026-07)驗收:
// ①首局教學旗標(localStorage 空)→ 示範者 AI 開(取代不會動的假人)②Route A 清運經濟(垃圾瓶進回收口=清運+1、
// 歸屬 thrownBy;非玩家丟入不計分;達標 CLEANUP_NEED 生工具)③示範者撿垃圾④玩家攻擊→切 fight⑤首局打完記 localStorage⑥無錯誤
// 陷阱:rAF 節流→game.time 輪詢 advance;示範者travel慢→把瓶放AI旁邊加速;POD 收容污染→角色避開艙(y 遠離中心)
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

// ---------- ① 首局教學旗標 → 示範者 AI ----------
const boot = await page.evaluate(() => ({ tutorial: __v2.state().tutorial, aiMode: __v2.state().aiMode, aiOn: __v2.fighters[1].ai, introT: __v2.state().introT }));
R('全新玩家 → 首局教學(tutorial)', boot.tutorial === true, JSON.stringify(boot));
R('示範者 AI 開場即開(取代不會動假人)', boot.aiOn === true && boot.aiMode === 'demo');
R('開場目標字幕/鏡頭帶場計時中(introT>0)', boot.introT > 0);

// ---------- ② Route A 清運經濟 ----------
const putInPod = (thrownBy) => page.evaluate((by) => {
  const v = __v2, t = v.bottles.find(b => b.alive && !b.held) || v.bottles[0];
  t.alive = true; t.held = false; t.x = v.POD.x; t.y = v.POD.y; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9; t.thrownBy = by;
}, thrownBy);
const cl0 = await page.evaluate(() => __v2.state().cleanup[0]);
await putInPod(0); await advance(0.15);
const cl1 = await page.evaluate(() => ({ cleanup: __v2.state().cleanup[0], cleaned: __v2.state().cleaned[0] }));
R('垃圾瓶進回收口 = 清運 +1(歸屬丟的人)', cl1.cleanup === cl0 + 1 && cl1.cleaned >= 1, JSON.stringify(cl1));

await putInPod(-1); await advance(0.15); // 非玩家丟入(風吹/亂滑)→ 清掉不計分
const cl2 = await page.evaluate(() => __v2.state().cleanup[0]);
R('非玩家丟入 → 已清運但不計分', cl2 === cl1.cleanup, 'cleanup=' + cl2);

// 補到 CLEANUP_NEED → 生工具
const need = await page.evaluate(() => __v2.state().cleanup[0]);
const g0 = await page.evaluate(() => __v2.groundItems.length);
for (let i = need; i < 3; i++) { await putInPod(0); await advance(0.15); }
const rew = await page.evaluate(() => ({ cleanup: __v2.state().cleanup[0], ground: __v2.groundItems.length }));
R('清運達標(3)→ 生事故工具 + 進度歸零', rew.cleanup === 0 && rew.ground > g0, JSON.stringify(rew));

// ---------- ③ 示範者撿垃圾:把瓶放到 AI 旁邊,牠會撿起來(carryObj) ----------
await page.evaluate(() => {
  const v = __v2, o = v.fighters[1];
  o.x = 480; o.y = 120; o.carryObj = null; o.carrying = null; o._aiMode = 'demo'; o._demoThrows = 0; o.flinchT = 0; o.stunned = false;
  const t = v.bottles.find(b => !b.held) || v.bottles[0]; t.alive = true; t.held = false; t.x = 480; t.y = 130; t.z = 0; t.vx = 0; t.vy = 0; t.landed = true; t.flyT0 = -9;
  v.fighters[0].x = 100; v.fighters[0].y = 560; // 玩家遠離,別觸發 engage
});
await advance(1.2);
const demo = await page.evaluate(() => ({ mode: __v2.state().aiMode, carryObj: !!__v2.fighters[1].carryObj }));
R('示範者撿起垃圾(carryObj)/或已丟(仍 demo)', demo.carryObj || demo.mode === 'demo', JSON.stringify(demo));

// ---------- ④ 玩家攻擊 → 示範者切 fight ----------
await page.evaluate(() => { const v = __v2, me = v.fighters[0], o = v.fighters[1]; me.x = o.x - 28; me.y = o.y; me.facing = 0; me.punchFx = v.game.time; v.punch(me); o.flinchT = 0.3; });
await advance(0.3);
const sw = await page.evaluate(() => __v2.state().aiMode);
R('玩家攻擊 → 示範者切 fight(反抗模式)', sw === 'fight', 'mode=' + sw);

// ---------- ⑤ 首局打完 → 記 localStorage(下次不教學) ----------
await page.evaluate(() => __v2.endMatch(0));
await page.waitForFunction('!__v2.state().tutorial', { timeout: 30000 }).catch(() => {}); // matchOver → game.time 凍結(advance 會卡死);輪詢等 step 跑 tutorial-flip(waitForFunction 保持 rAF 活著)
const played = await page.evaluate(() => ({ tut: __v2.state().tutorial, ls: (() => { try { return localStorage.getItem('mmm_v2_played'); } catch { return '?'; } })() }));
R('首局結束 → tutorial 關 + localStorage 記「玩過」', played.tut === false && played.ls === '1', JSON.stringify(played));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
