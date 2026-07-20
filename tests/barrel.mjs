// 爆桶 GLB 三狀態接入(item-2;使用者拍板 2026-07-20:桶=GLB / 充能引信靠疊加光暈)驗收:
// ①GLB 載成(__lab.barrelReady)②地面桶=掛 GLB(clone 帶 userData.__barrel;BARREL_SPOTS 兩顆)
// ③引信 fuse=閃紅光暈(桶心近處有 glow mesh)④握持桶=掛 GLB(玩家 actor 群內也掛)⑤無 console 錯誤
// 陷阱:①桶 clone 繼承 userData.__barrel=精準計數旗(不受玩家/AI avatar 高三角網格干擾)。
//       ②bottles/barrels 每幀由 v2.js 幀尾重建 game.props→每幀 pin 強制狀態壓過重建,別靠一次性設定。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① GLB 載成 ----------
const ready = await page.waitForFunction('__lab.barrelReady() === true', { timeout: 20000 }).then(() => true).catch(() => false);
R('爆桶 GLB 載成(barrelReady)', ready);

await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 100; v.fighters[1].y = 100; });

// scene 內「可見」桶 GLB 實例數:數 clone 繼承的 userData.__barrel + 祖鏈全可見
// (握持 clone 是隱藏快取 bm.visible=false 不移除→必須查祖鏈可見;地面 clone 每幀重建=可見)。
const COUNT_EXPR = `(()=>{const s=__lab.labGroup.parent;let n=0;s.traverse(o=>{if(o.userData&&o.userData.__barrel){let vis=o.visible,p=o.parent;while(vis&&p){vis=p.visible;p=p.parent;}if(vis)n++;}});return n;})()`;
const barrelCount = () => page.evaluate(COUNT_EXPR);
const waitBarrel = (cmpExpr) => page.waitForFunction(`${COUNT_EXPR} ${cmpExpr}`, { timeout: 15000 }).then(() => true).catch(() => false);
// 每幀 pin:mode=地面兩桶 idle / 握持 / 引信。
const pin = (mode) => page.evaluate((mode) => {
  if (window.__pin) clearInterval(window.__pin);
  const v = __v2, f = v.fighters[0], bs = v.barrels;
  window.__pin = setInterval(() => {
    for (const b of bs) { b.held = false; b.alive = true; }
    f.carryObj = null;
    if (mode === 'ground') { for (const b of bs) { b.state = 'idle'; b.fuse = 0; b.charge = null; b.z = 0; b.vx = 0; b.vy = 0; } }
    if (mode === 'fuse')   { bs[0].state = 'fuse'; bs[0].fuse = 0.3; bs[0].charge = null; bs[0].x = 480; bs[0].y = 470; bs[0].z = 0; bs[0].vx = 0; bs[0].vy = 0; }
    if (mode === 'held')   { bs[0].state = 'idle'; bs[0].fuse = 0; bs[0].held = true; f.carryObj = bs[0]; f.x = 480; f.y = 480; }
  }, 16);
}, mode);

// ---------- ② 地面桶=掛 GLB(BARREL_SPOTS 兩顆) ----------
await pin('ground');
const groundOk = await waitBarrel('=== 2');
R('地面桶=掛 GLB(__barrel=2;BARREL_SPOTS 兩顆)', groundOk, `ground=${await barrelCount()}`);

// ---------- ③ 引信 fuse=閃紅光暈(桶心近處有 glow mesh) ----------
await pin('fuse');
const glowOk = await page.waitForFunction(() => {
  const v = __v2, b = v.barrels[0], s = __lab.labGroup.parent; let g = 0;
  s.traverse(o => { if (o.isMesh && o.material && o.material.transparent && o.position.y > 20 && Math.hypot(o.position.x - b.x, o.position.z - b.y) < 70) g++; });
  return g >= 1;
}, { timeout: 15000 }).then(() => true).catch(() => false);
R('引信 fuse=疊加光暈(桶心近處有發光 mesh)', glowOk);

// ---------- ④ 握持桶=掛 GLB ----------
await pin('held');
const heldOk = await waitBarrel('>= 1');
R('握持桶=掛 GLB(__barrel≥1)', heldOk, `held=${await barrelCount()}`);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
