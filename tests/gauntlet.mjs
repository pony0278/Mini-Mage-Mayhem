// 風壓手套 GLB 右手裝備(item-4;使用者 Azure Turbine Gauntlet)驗收:
// ①GLB 載成(__lab.windGauntletReady)②持風壓手套(item='wind')=右手掛 GLB(__gauntlet 旗可見)
// ③無道具=手套隱藏 ④無 console 錯誤
// 陷阱:手套 clone 掛在 R.armR.wr(actor group 內)非 propGroup;可見性查祖鏈(wrap.visible 切換,不移除)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const ready = await page.waitForFunction('__lab.windGauntletReady && __lab.windGauntletReady() === true', { timeout: 20000 }).then(() => true).catch(() => false);
R('風壓手套 GLB 載成(windGauntletReady)', ready);
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 100; v.fighters[1].y = 100; v.fighters[0].x = 480; v.fighters[0].y = 320; });

// 可見 __gauntlet 計數(祖鏈全可見)
const COUNT = `(()=>{const s=__lab.labGroup.parent;let n=0;s.traverse(o=>{if(o.userData&&o.userData.__gauntlet){let vis=o.visible,p=o.parent;while(vis&&p){vis=p.visible;p=p.parent;}if(vis)n++;}});return n;})()`;
const pin = (item) => page.evaluate((item) => {
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => { const f = __v2.fighters[0]; f.item = item; if (item) f.itemUses = 3; }, 16);
}, item);

// ---------- ② 持風壓手套 = 右手掛 GLB ----------
await pin('wind');
const worn = await page.waitForFunction(`${COUNT} >= 1`, { timeout: 15000 }).then(() => true).catch(() => false);
R('持風壓手套=右手戴 GLB(__gauntlet 可見)', worn);

// ---------- ③ 無道具 = 手套隱藏 ----------
await pin(null);
const hidden = await page.waitForFunction(`${COUNT} === 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('無道具=手套隱藏(__gauntlet 不可見)', hidden);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
