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
  const { page, errs } = await load(false, 'http://localhost:8099/v2.html?turbo=8');
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
  const { page, errs } = await load(true, 'http://localhost:8099/v2.html?turbo=8');
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

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
