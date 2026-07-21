// 鍵盤操作 keys-1(使用者拍板 2026-07-21:滑鼠退役、雙端一致的 GetAmped 式鍵位)驗收:
// ①滑鼠點擊=無效果(不出拳/不互動)②C=攻擊(edge→punch 排程)③方向鍵移動+面向=移動方向
// ④放開方向鍵=保留最後面向 ⑤斜向(上+右)=45° 面向 ⑥X=撿瓶 ⑦Z=道具施放 ⑧無 console 錯誤
// 陷阱:polls 在 step() 內(turbo 下每幀 8 步,edge 由 prev 閂鎖=只觸發一次);keys 集合吃 e.key.toLowerCase()。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 700; v.fighters[1].y = 600; v.game.hitstop = 0; });
const me = () => page.evaluate(() => { const f = __v2.fighters[0]; return { x: Math.round(f.x), y: Math.round(f.y), facing: +f.facing.toFixed(2), strikeAt: f.strikeAt, striking: f._strikeAt > 0, carry: !!f.carryObj, cast: f._itemCastAt > 0 }; });

// ---------- ① 滑鼠點擊 = 無效果 ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.x = 480; f.y = 470; f.punchCd = 0; f._strikeAt = 0; f._recoverT = 0; });
await page.mouse.click(480, 320); await page.mouse.click(480, 320, { button: 'right' });
await new Promise(r => setTimeout(r, 300));
const m1 = await me();
R('滑鼠左右鍵點擊=無效果(不出拳/不互動)', !m1.striking && !m1.carry, JSON.stringify(m1));

// ---------- ② C = 攻擊(edge → punch 排程) ----------
await page.keyboard.down('c'); await page.waitForFunction('__v2.fighters[0]._strikeAt > 0', { timeout: 8000 }).catch(() => {});
const m2 = await me(); await page.keyboard.up('c');
R('C=攻擊(punch 排程 _strikeAt)', m2.striking, JSON.stringify(m2));
await page.evaluate(() => { const f = __v2.fighters[0]; f._strikeAt = 0; f._recoverT = 0; f.punchCd = 0; __v2.game.hitstop = 0; });

// ---------- ③ 方向鍵移動 + 面向=移動方向 ----------
const x0 = (await me()).x;
await page.keyboard.down('ArrowRight');
const moved = await page.waitForFunction(`__v2.fighters[0].x > ${x0 + 20}`, { timeout: 8000 }).then(() => true).catch(() => false);
const m3 = await me();
R('方向鍵移動(→ 走右)+面向=移動方向(≈0)', moved && Math.abs(m3.facing) < 0.2, JSON.stringify(m3));

// ---------- ④ 放開 = 保留最後面向 ----------
await page.keyboard.up('ArrowRight'); await new Promise(r => setTimeout(r, 300));
const m4 = await me();
R('放開方向鍵=保留最後面向(仍≈0)', Math.abs(m4.facing) < 0.2, JSON.stringify(m4));

// ---------- ⑤ 斜向:上+右 = -45° 面向 ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.x = 480; f.y = 470; });
await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowRight');
const diag = await page.waitForFunction('Math.abs(__v2.fighters[0].facing - (-Math.PI/4)) < 0.15', { timeout: 8000 }).then(() => true).catch(() => false);
await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowRight');
R('斜向(上+右)=往右上移動、面向 -45°', diag, `facing=${(await me()).facing}`);

// ---------- ⑥ X = 撿瓶 ----------
await page.evaluate(() => { const v = __v2, f = v.fighters[0], t = v.bottles[0];
  t.alive = true; t.held = false; t.x = 320; t.y = 320; t.z = 0; t.vx = t.vy = 0; t.landed = true; // 遠離補給座(480,140/500):pickupItem 優先於撿瓶,站太近會撿到裝備
  f.x = 290; f.y = 320; f.carryObj = null; f.carrying = null; f.regrabCd = 0; f.stunned = false; f.fumbleT = 0; f.item = null; });
await page.keyboard.down('x');
const picked = await page.waitForFunction('!!__v2.fighters[0].carryObj', { timeout: 8000 }).then(() => true).catch(() => false);
await page.keyboard.up('x');
R('X=互動(近瓶撿起)', picked);
await page.evaluate(() => { const v = __v2, f = v.fighters[0]; if (f.carryObj) { f.carryObj.held = false; f.carryObj.alive = true; f.carryObj = null; } });

// ---------- ⑦ Z = 道具施放 ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.item = 'fire'; f.itemUses = 2; f.itemCastCd = 0; f._itemCastAt = 0; });
await page.keyboard.down('z');
const cast = await page.waitForFunction('__v2.fighters[0]._itemCastAt > 0', { timeout: 8000 }).then(() => true).catch(() => false);
await page.keyboard.up('z');
R('Z=道具施放(火帽排程開火)', cast);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
