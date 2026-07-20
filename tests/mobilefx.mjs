// 手機自動降級(2026-07 手機卡頓修法 1+2)驗收:
// ①手機模擬(觸控+行動 UA+dpr2)→ FX_LOW 自動開(點光剝除/無 transmission)+ dpr 夾 1.5(canvas 內部 1440×810)
// ②桌機(無觸控)→ FX_LOW 關(完整管線)③?fx=full 在手機上手動覆蓋回完整 ④無 console 錯誤
// 陷阱:puppeteer 的 hasTouch 讓 maxTouchPoints>0;pointer:coarse 不一定被模擬 → 偵測靠 UA fallback
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function load(mobile, url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  if (mobile) { await page.setUserAgent(IPHONE_UA); await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); }
  else await page.setViewport({ width: 1100, height: 620 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__lab', { timeout: 20000 });
  const st = await page.evaluate(() => {
    let pts = 0, trans = 0;
    __lab.labGroup.parent.traverse(o => {
      if (o.isPointLight) pts++;
      if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m && m.transmission > 0) trans++; }
    });
    return { fxLow: __lab.fxLow(), pts, trans, cw: document.getElementById('game').width, touch: navigator.maxTouchPoints };
  });
  st.errs = errs;
  await page.close();
  return st;
}

// ---------- ① 手機模擬 → 自動 FX_LOW + dpr 1.5 ----------
const mob = await load(true, 'http://localhost:8099/v2.html');
R('手機:FX_LOW 自動開', mob.fxLow === true, 'touch=' + mob.touch);
R('手機:裝飾點光剝除(≤4 顆)+ 無 transmission', mob.pts <= 4 && mob.trans === 0, `pts=${mob.pts} trans=${mob.trans}`);
R('手機:dpr 夾 1.5(canvas 內部寬 1440)', mob.cw === 1440, 'cw=' + mob.cw);

// ---------- ② 桌機 → 完整管線(perf-1 後:點光縮編至 6=四角底光+艙+補光;transmission 全平台退役) ----------
const desk = await load(false, 'http://localhost:8099/v2.html');
R('桌機:FX_LOW 關(點光=6:四角+艙+補光;perf-1 燈簇縮編)', desk.fxLow === false && desk.pts > 4 && desk.pts <= 8 && desk.trans === 0, `fxLow=${desk.fxLow} pts=${desk.pts} trans=${desk.trans}`);

// ---------- ③ ?fx=full 手動覆蓋(手機也能要完整) ----------
const ovr = await load(true, 'http://localhost:8099/v2.html?fx=full');
R('手機 ?fx=full:手動覆蓋回完整管線(桌機同款=點光 6)', ovr.fxLow === false && ovr.pts > 4 && ovr.pts <= 8, `fxLow=${ovr.fxLow} pts=${ovr.pts}`);

R('無 page/console 錯誤', mob.errs.length + desk.errs.length + ovr.errs.length === 0, [...mob.errs, ...desk.errs, ...ovr.errs].slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
