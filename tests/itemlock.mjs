// 道具施法承諾鎖腳(item-4g;使用者反饋「用道具應像揮拳 combo 不能邊走邊攻擊」)驗收:
// ①控制組=無施法按方向鍵會走(確認輸入有效)②施法中(itemCastCd>0)按方向鍵=位移≈0(鎖腳)
// ③施法中按上鍵=facing 仍轉(只鎖腳不鎖面向,保留蓄力中轉向瞄準的連招)④teleport 瞬發不設 itemCastCd=不鎖(逃脫機動保留)
// 陷阱:鍵盤輸入要用真事件 page.keyboard.down(非塞 keys[]);rAF 節流→以 game.time 輪詢(?turbo=8)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const adv = s => page.evaluate(sec => new Promise(r => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= sec) { clearInterval(iv); r(); } }, 15); }), s);
const setup = (ex = 'f=>{}') => page.evaluate((ex) => { const v = __v2, f = v.fighters[0]; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1]._hidden = true; f.x = 300; f.y = 320; f.facing = 0; f.stunned = false; f.itemCastCd = 0; f._itemCastAt = 0; f.vx = 0; f.vy = 0; new Function('f', 'return (' + ex + ')(f)')(f); }, ex);

// ① 控制組:無施法按右鍵 → 會走
await setup();
await page.keyboard.down('ArrowRight'); await adv(0.3); await page.keyboard.up('ArrowRight');
const ctrl = await page.evaluate(() => +(__v2.fighters[0].x - 300).toFixed(1));
R(`控制組:無施法按右鍵會走(dx=${ctrl}>20)`, ctrl > 20);

// ② 施法中鎖腳
await setup('f=>{f.item="wind";f.itemUses=3;}');
await page.evaluate(() => __v2.useItem(__v2.fighters[0]));
await page.keyboard.down('ArrowRight'); await adv(0.3); await page.keyboard.up('ArrowRight');
const lock = await page.evaluate(() => ({ dx: +(__v2.fighters[0].x - 300).toFixed(1), casting: __v2.fighters[0].itemCastCd > 0 }));
R(`施法中鎖腳(dx=${lock.dx}≈0,仍施法中)`, Math.abs(lock.dx) < 3 && lock.casting);

// ③ 施法中可轉身瞄準(不鎖面向)
await setup('f=>{f.item="wind";f.itemUses=3;}');
await page.evaluate(() => __v2.useItem(__v2.fighters[0]));
await page.keyboard.down('ArrowUp'); await adv(0.2); await page.keyboard.up('ArrowUp');
const turn = await page.evaluate(() => +__v2.fighters[0].facing.toFixed(2));
R(`施法中可轉身瞄準(facing=${turn}≠0)`, Math.abs(turn) > 0.3);

// ④ teleport 瞬發不鎖(逃脫機動保留)
await setup('f=>{f.item="teleport";f.itemUses=1;}');
const tp = await page.evaluate(() => { __v2.useItem(__v2.fighters[0]); return +__v2.fighters[0].itemCastCd.toFixed(3); });
R(`teleport 瞬發不設 itemCastCd(=${tp}=不鎖)`, tp === 0);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
