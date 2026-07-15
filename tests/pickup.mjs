// 手動撿道具(C 案)驗收:①走過補給座不再自動撿 ②按 pickup 才撿(空手才撿)③被暈=道具噴地上(逃脫類不掉)
// ④地上掉落物可撿(帶剩餘次數)⑤已持有時不撿(擋)⑥TTL 到期消失
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage(); const errs = [];
page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);

// ① 走過補給座不自動撿:把 fighters[1] 放到 pad 上、給 pad 一個 oil,advance,不該被撿
const s1 = await page.evaluate(async () => {
  const v = __v2, f = v.fighters[1]; f.ai = false; f.item = null; f.itemUses = 0; f.stunned = false; f.carriedBy = null; f.carrying = null; f.carryObj = null;
  v.pads[0].item = 'wind'; f.x = v.pads[0].x; f.y = v.pads[0].y;
  return { padItem: v.pads[0].item };
});
await advance(0.3);
const s1b = await page.evaluate(() => ({ item: __v2.fighters[1].item, padItem: __v2.pads[0].item }));
R('走過補給座不再自動撿(仍空手、pad 還在)', s1b.item === null && s1b.padItem === 'wind');

// ② 按 pickup 才撿(pickupItem 回 true、拿到、pad 清空)
const s2 = await page.evaluate(() => { const v = __v2, f = v.fighters[1]; const ok = v.pickupItem(f); return { ok, item: f.item, uses: f.itemUses, padItem: v.pads[0].item }; });
R(`按 pickup 才撿到 wind(uses ${s2.uses})+pad 清空`, s2.ok && s2.item === 'wind' && s2.uses === 3 && s2.padItem === null);

// ⑤ 已持有時不撿(擋)
const s5 = await page.evaluate(() => { const v = __v2, f = v.fighters[1]; v.pads[1].item = 'fire'; f.x = v.pads[1].x; f.y = v.pads[1].y; const ok = v.pickupItem(f); return { ok, item: f.item }; });
R('已持有道具時不再撿(擋)', s5.ok === false && s5.item === 'wind');

// ③ 被暈=道具噴地上(oil 會掉)
const s3 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1]; f.x = 300; f.y = 300; f.item = 'wind'; f.itemUses = 2; f.stunned = false; f.restunT = 0; f.invuln = 0;
  v.groundItems.length = 0;
  v.stunFighter(f); return true;
});
await advance(0.35); // step 幀:drop-on-stun(等 hitstop 0.12 過)
const s3b = await page.evaluate(() => ({ item: __v2.fighters[1].item, ground: __v2.groundItems.length, g0: __v2.groundItems[0] || null }));
R('被暈=道具噴地上(手上清空、地上多一顆帶剩餘次數)', s3b.item === null && s3b.ground === 1 && s3b.g0 && s3b.g0.type === 'wind' && s3b.g0.uses === 2);

// ④ 地上掉落物可撿(帶剩餘次數 2)
const s4 = await page.evaluate(() => {
  const v = __v2, o = v.fighters[0]; o.ai = false; o.item = null; o.stunned = false; o.carriedBy = null; o.carrying = null; o.carryObj = null; o.fumbleT = 0;
  const g = v.groundItems[0]; o.x = g.x; o.y = g.y;
  const ok = v.pickupItem(o); return { ok, item: o.item, uses: o.itemUses, ground: v.groundItems.length };
});
R(`地上掉落物可撿(對手撿到 wind uses ${s4.uses})+地上清空`, s4.ok && s4.item === 'wind' && s4.uses === 2 && s4.ground === 0);

// ③b 傳送=逃脫類不掉
const s6 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1]; f.item = 'teleport'; f.itemUses = 1; f.stunned = false; f.restunT = 0; v.groundItems.length = 0; v.stunFighter(f);
  return true;
});
await advance(0.35);
const s6b = await page.evaluate(() => ({ item: __v2.fighters[1].item, ground: __v2.groundItems.length }));
R('傳送(逃脫類)被暈不掉(仍在手上)', s6b.item === 'teleport' && s6b.ground === 0);

// ⑥ TTL 到期消失
const s7 = await page.evaluate(() => { const v = __v2; v.groundItems.length = 0; v.groundItems.push({ x: 100, y: 100, type: 'wind', uses: 1, ttl: 0.15 }); return v.groundItems.length; });
await advance(0.4);
const s7b = await page.evaluate(() => __v2.groundItems.length);
R('掉落道具 TTL 到期自然消失', s7b === 0);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close(); process.exit(fail ? 1 : 0);
