// 冰霜瓶 GLB 三狀態接入(item-1;使用者拍板 2026-07-20:冰用 GLB / 油留方塊)驗收:
// ①GLB 載成(__lab.frostBottleReady)②地面冰瓶=掛 GLB(clone 帶 userData.__frost)③油瓶=留方塊(不掛 GLB)
// ④握持冰瓶=掛 GLB(玩家 actor 群內也掛)⑤無 console 錯誤
// 陷阱:①冰瓶 clone 繼承 userData.__frost=精準計數旗(不受玩家/AI avatar 高三角網格干擾)。
//       ②bottles 會自動 respawn(turbo 下更快)→ 每幀 pin 強制組成壓過 respawn,別靠一次性殺光。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① GLB 載成 ----------
const ready = await page.waitForFunction('__lab.frostBottleReady() === true', { timeout: 20000 }).then(() => true).catch(() => false);
R('冰霜瓶 GLB 載成(frostBottleReady)', ready);

await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 100; v.fighters[1].y = 100; });

// ---------- ①b 貼圖可對應:mesh 有 UV + 材質綁貼圖(鎖 2026-07-20 坑:去圖 prune 砍 UV → 渲成素色) ----------
await page.evaluate(() => { const b = __v2.bottles; b[0].elem = 'ice'; b[0].r = 9; b[0].x = 520; b[0].y = 470; b[0].z = 0; b[0].vx = 0; b[0].vy = 0; b[0].held = false; b[0].alive = true; });
const texOk = await page.evaluate(() => new Promise(res => { setTimeout(() => {
  const s = __lab.labGroup.parent; let mesh = null;
  s.traverse(o => { if (o.userData && o.userData.__frost) o.traverse(m => { if (m.isMesh && !mesh) mesh = m; }); });
  if (!mesh) return res({ found: false });
  res({ found: true, hasUV: !!mesh.geometry.attributes.uv, hasMap: !!(mesh.material && mesh.material.map) });
}, 500); }));
R('貼圖可對應:mesh 帶 UV + 材質綁貼圖(去圖別 prune)', texOk.found && texOk.hasUV && texOk.hasMap, JSON.stringify(texOk));

// ---------- ①c 冰瓶飄雪(取代舊青色光圈):scene 有雪花 Points(o.isPoints) ----------
const snowOk = await page.evaluate(() => { const s = __lab.labGroup.parent; let pts = 0;
  s.traverse(o => { if (o.isPoints && o.visible) pts++; }); return pts; });
R('冰瓶飄雪:場上有雪花 Points(≥1;光圈已換飄雪)', snowOk >= 1, `points=${snowOk}`);

// scene 內「可見」冰瓶 GLB 實例數:數 clone 繼承的 userData.__frost + 祖鏈全可見
// (握持 clone 是隱藏快取 bm.visible=false 不移除→必須查祖鏈可見,否則計入舊持有殘留;地面 clone 每幀重建=可見)。
const COUNT_EXPR = `(()=>{const s=__lab.labGroup.parent;let n=0;s.traverse(o=>{if(o.userData&&o.userData.__frost){let vis=o.visible,p=o.parent;while(vis&&p){vis=p.visible;p=p.parent;}if(vis)n++;}});return n;})()`;
const frostCount = () => page.evaluate(COUNT_EXPR);
// 輪詢等到計數達標(自我校正:run-all 併發下 pin 會被負載餓到,固定 sleep 不夠;達標=pin 已壓穩)
const waitFrost = (cmpExpr) => page.waitForFunction(`${COUNT_EXPR} ${cmpExpr}`, { timeout: 15000 }).then(() => true).catch(() => false);
// 每幀 pin(壓過 respawn):mode=空/冰地面/油地面/冰握持。清光時連 respawn 計時器一起釘死(免自動補瓶)。
const pin = (mode) => page.evaluate((mode) => {
  if (window.__pin) clearInterval(window.__pin);
  const v = __v2, f = v.fighters[0];
  window.__pin = setInterval(() => { const b = v.bottles;
    for (const t of b) { t.alive = false; t.held = false; t.respawn = 999; } // 每幀清光+凍 respawn(免自動補瓶)
    f.carryObj = null;
    if (mode === 'ice')  { b[0].elem = 'ice'; b[0].r = 12; b[0].x = 480; b[0].y = 470; b[0].z = 0; b[0].vx = 0; b[0].vy = 0; b[0].held = false; b[0].alive = true; }
    if (mode === 'oil')  { b[0].elem = 'oil'; b[0].r = 12; b[0].x = 480; b[0].y = 470; b[0].z = 0; b[0].vx = 0; b[0].vy = 0; b[0].held = false; b[0].alive = true; }
    if (mode === 'held') { b[0].elem = 'ice'; b[0].r = 12; b[0].held = true; b[0].alive = true; f.carryObj = b[0]; f.x = 480; f.y = 480; }
  }, 16);
}, mode);
// ---------- 基線:pin 空(無瓶) ----------
await pin('empty');
const baseOk = await waitFrost('=== 0');
R('無瓶時 __frost=0(respawn 已凍、初始瓶已清)', baseOk, `base=${await frostCount()}`);

// ---------- ② 地面冰瓶=掛 GLB ----------
await pin('ice');
const iceOk = await waitFrost('=== 1');
R('地面冰瓶=掛 GLB(__frost=1)', iceOk, `ice=${await frostCount()}`);

// ---------- ③ 油瓶=留方塊(不掛 GLB) ----------
await pin('oil');
const oilOk = await waitFrost('=== 0');
R('油瓶=留方塊(不掛 GLB,__frost=0)', oilOk, `oil=${await frostCount()}`);

// ---------- ④ 握持冰瓶=掛 GLB ----------
await pin('held');
const heldOk = await waitFrost('>= 1');
R('握持冰瓶=掛 GLB(__frost≥1)', heldOk, `held=${await frostCount()}`);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
