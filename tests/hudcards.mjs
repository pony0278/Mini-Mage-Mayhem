// 下方狀態卡(hud-1;使用者拍板 2026-07-27:身上數值條全集中畫面下方)驗收:
// ①桌機=雙卡錨下方(玩家左/對手右)+玩家卡 you 旗 ②頭像=GLB 快照成功(kind='glb';
// SwiftShader 下 readRenderTargetPixels 走通=真渲染回讀)③卡片區有實際像素(canvas 取樣)
// ④手機模擬=錨上方(下方被搖桿/按鈕佔用)⑤?avatar=0=退 2D 臉(kind='2d',永不空白)⑥無錯誤。
// 陷阱:頭像快照要等 avatar async 建好才轉 'glb'(之前回 null=佔位框);__hud 每幀由 drawCards 重寫。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function load(mobile, url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  if (mobile) { await page.setUserAgent(IPHONE_UA); await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); }
  else await page.setViewport({ width: 1100, height: 620 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__lab && window.__hud', { timeout: 20000 });
  return { page, errs };
}

// ---------- 桌機:雙卡下方 + GLB 頭像 + 像素取樣 ----------
{
  const { page, errs } = await load(false, 'http://localhost:8099/v2.html?turbo=8&avatar=1');
  await page.evaluate(() => { __v2.v2s.introT = 0; __v2.fighters[1].ai = false; });
  const glb = await page.waitForFunction(`__hud.cards[0].portrait === 'glb' && __hud.cards[1].portrait === 'glb'`, { timeout: 20000 }).then(() => true).catch(() => false);
  const h = await page.evaluate('window.__hud');
  const VH = await page.evaluate(`document.getElementById('hud').height`);
  R('桌機:雙卡錨下方(玩家左/對手右)', h.anchor === 'bottom' && h.cards[0].y > VH * 0.6 && h.cards[1].x > h.cards[0].x, JSON.stringify(h));
  R('玩家卡帶 YOU 旗、對手卡無', h.cards[0].you === true && h.cards[1].you === false);
  R('頭像=GLB 快照成功(readRenderTargetPixels 回讀走通)', glb, JSON.stringify(await page.evaluate('window.__hud')));
  const px = await page.evaluate(() => {                       // 卡片區 canvas 取樣:有不透明像素=真的畫了
    const c = document.getElementById('hud').getContext('2d');
    const k = window.__hud.cards[0];
    const d = c.getImageData(k.x + 2, k.y + 2, k.w - 4, k.h - 4).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return { opaque: n, total: d.length / 4 };
  });
  R('卡片區有實際像素(>30% 不透明)', px.opaque > px.total * 0.3, JSON.stringify(px));
  R('桌機:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- 手機模擬:錨上方(下方=搖桿/按鈕) ----------
{
  const { page, errs } = await load(true, 'http://localhost:8099/v2.html?turbo=8&avatar=1');
  const top = await page.waitForFunction(`__hud.anchor === 'top'`, { timeout: 15000 }).then(() => true).catch(() => false);
  R('手機:雙卡錨上方(讓位搖桿/按鈕)', top, JSON.stringify(await page.evaluate('window.__hud && __hud.anchor')));
  R('手機:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ?avatar=0:2D 臉退路 ----------
{
  const { page, errs } = await load(false, 'http://localhost:8099/v2.html?turbo=8&avatar=0');
  const two = await page.waitForFunction(`__hud.cards[0].portrait === '2d'`, { timeout: 15000 }).then(() => true).catch(() => false);
  R('?avatar=0:頭像退 2D 風格化臉(永不空白)', two);
  R('方塊人:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ui-1:身分標記=頭頂浮標(腳下光環退役;`?mark=arrow` 已非預設,見下方 ui-3) ----------
// 使用者反饋 2026-08-03:「角色底下的圈圈似乎會透視人物」——HUD 是無深度測試的 2D 疊層,腳下環一定壓在腿上。
// 驗:①標記在頭頂(螢幕 y 明顯高於腳)②箭頭跟著 facing 轉(左右相反)③**腳下取樣框沒有隊伍色像素**。
// ⚠ 別掃全畫布找「藍色像素」——教練線/艙環/道具標一堆青藍會混進來(第一版就這樣假 FAIL);
//   用 `__hudmk` hook 拿到精確座標再開小框取樣。
{
  const { page, errs } = await load(false, 'http://localhost:8099/v2.html?turbo=8&mark=arrow');   // ⚠ ui-3 後預設是 tri(不轉向)→ 這段驗風箏箭頭要明寫旗標
  await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false;
    v.fighters[1].x = 880; v.fighters[1].y = 600;
    const f = v.fighters[0]; f.x = 480; f.y = 530; f.facing = 0; f.stunned = false; f.invuln = 0; // ⚠ 離開艙(480,320 r46):艙的地面光環會落進腳下取樣框=假 FAIL
    v.CAM.dist = 400; v.CAM.angle = 18; v.CAM.lookY = 26; v.game.camTarget = f; });
  await page.waitForFunction('window.__hudmk && window.__hudmk[0]', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));
  const east = await page.evaluate(() => window.__hudmk[0]);
  R('身分標記在頭頂(螢幕 y 高於腳底 ≥40px)', east.footY - east.y >= 40, JSON.stringify(east));
  // ⚠ 固定 sleep 會 flake:__hudmk 只在「有渲染幀」時更新,CONC=3 下 rAF 節流到一幀 >1s(實測 east/west 都讀成 1)。
  await page.evaluate(() => { window.__pinFace = setInterval(() => { __v2.fighters[0].facing = Math.PI; }, 16); });
  const turned = await page.waitForFunction('window.__hudmk[0].dx < -0.3', { timeout: 30000 }).then(() => true).catch(() => false);
  const west = await page.evaluate(() => { clearInterval(window.__pinFace); return window.__hudmk[0]; });
  R('箭頭跟著 facing 轉(東/西 螢幕方向相反)', turned && east.dx > 0.3 && west.dx < -0.3, JSON.stringify({ east: east.dx, west: west.dx }));
  const feet = await page.evaluate(() => {                      // 腳下小框取樣:舊光環就畫在這裡
    const cv = document.getElementById('hud'), c = cv.getContext('2d'), m = window.__hudmk[0];
    const w = 90, h = 40, x0 = Math.max(0, m.footX - w / 2), y0 = Math.max(0, m.footY - h / 2);
    const d = c.getImageData(x0, y0, w, h).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++;
    return { opaque: n, total: d.length / 4, box: [x0, y0, w, h] };
  });
  R('腳下不再有光環(腳下取樣框幾乎全透明)', feet.opaque < feet.total * 0.02, JSON.stringify(feet));
  R('ui-1:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ui-3:預設=頭頂倒三角,而且只標本機 ----------
// 使用者反饋 2026-08-03(附百變恰吉截圖):「在玩家操作的角色上面標註倒三角代表正在操作的人物,
// 我覺得更好,比起包裹人物輪廓」。驗:①預設模式=tri ②**對手完全不標**(舊版對手有半透明小箭頭)
// ③標記在頭頂、腳下乾淨 ④持道具才補瞄準箭頭(面向承諾;沒道具時面向不影響判定=不用標)。
{
  const { page, errs } = await load(false, 'http://localhost:8099/v2.html?turbo=8');
  await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false;
    const f = v.fighters[0]; f.x = 480; f.y = 530; f.facing = 0; f.stunned = false; f.item = null; // ⚠ 離開艙(480,320 r46):艙的地面光環會落進腳下取樣框
    const o = v.fighters[1]; o.x = 300; o.y = 530; o.stunned = false;                              // 對手也擺在畫面內=真的有機會被畫上標記
    v.CAM.dist = 400; v.CAM.angle = 18; v.CAM.lookY = 26; v.game.camTarget = f; });
  await page.waitForFunction('window.__hudmk && window.__hudmk[0]', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 700));
  const mk = await page.evaluate(() => ({ me: window.__hudmk[0], foe: window.__hudmk[1] || null, alive: __v2.fighters[1].state }));
  R('預設標記=頭頂倒三角(kind=tri)', mk.me && mk.me.kind === 'tri', JSON.stringify(mk.me));
  R('只標本機:對手沒有頭頂標記', mk.foe === null && mk.alive === 'alive', JSON.stringify({ foe: mk.foe, foeState: mk.alive }));
  R('倒三角在頭頂(螢幕 y 高於腳底 ≥40px)', mk.me.footY - mk.me.y >= 40, JSON.stringify(mk.me));
  const feet = await page.evaluate(() => {
    const c = document.getElementById('hud').getContext('2d'), m = window.__hudmk[0];
    const w = 90, h = 40, x0 = Math.max(0, m.footX - w / 2), y0 = Math.max(0, m.footY - h / 2);
    const d = c.getImageData(x0, y0, w, h).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++;
    return { opaque: n, total: d.length / 4 };
  });
  R('ui-3:腳下仍然乾淨(沒有把光環搬回來)', feet.opaque < feet.total * 0.02, JSON.stringify(feet));
  R('無道具=不畫瞄準箭頭', mk.me.aim === false, JSON.stringify({ aim: mk.me.aim }));
  // ⚠ 固定 sleep 會 flake:__hudmk 只在「有渲染幀」時更新(rAF 節流)→ 輪詢等它翻旗。
  await page.evaluate(() => { const f = __v2.fighters[0]; f.item = 'wind'; f.itemUses = 3; });
  const aimOn = await page.waitForFunction('window.__hudmk[0].aim === true', { timeout: 30000 }).then(() => true).catch(() => false);
  R('持道具=三角上方補瞄準箭頭(面向承諾)', aimOn, JSON.stringify(await page.evaluate(() => window.__hudmk[0])));
  R('ui-3:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
