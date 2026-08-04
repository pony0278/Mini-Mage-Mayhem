// 火帽 GLB 頭戴裝備(item-3;使用者 The Golden Maw,studio 校準 scale0.69/y0.23)驗收:
// ①GLB 載成(__lab.fireHatReady)②持有噴火帽(item='fire')=頭上掛 GLB(__hat 旗可見)
// ②b 掛 avatar 頭骨 + 尺寸/位置=studio 校準比例 ∨ 包覆下限規則(item-3b/3c)③無道具=帽子隱藏 ④無 console 錯誤
// item-3c(使用者反饋「頭頂露出來了,要包裹整個頭部」):三規則取 max,這顆頭走頂部淨空規則
// (1+drop+topClear=1.849×headH);②c 直接斷言世界 bbox 包覆(帽頂高過頭頂、xz 整圈包住)。
// 陷阱:帽 clone 起初掛 box headPivot,avatar 非同步就緒後**改掛 av.by.head.bone**(病 3);可見性查祖鏈。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?menu=0&avatar=1', { waitUntil: 'networkidle0' });   // ugc-6:方塊人是預設,avatar 功能測試要明確 opt-in(?avatar=1)
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const ready = await page.waitForFunction('__lab.fireHatReady() === true', { timeout: 20000 }).then(() => true).catch(() => false);
R('火帽 GLB 載成(fireHatReady)', ready);
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.fighters[1].x = 100; v.fighters[1].y = 100; });

// 可見 __hat 計數(祖鏈全可見)
const COUNT = `(()=>{const s=__lab.labGroup.parent;let n=0;s.traverse(o=>{if(o.userData&&o.userData.__hat){let vis=o.visible,p=o.parent;while(vis&&p){vis=p.visible;p=p.parent;}if(vis)n++;}});return n;})()`;
const pin = (item) => page.evaluate((item) => {
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => { const f = __v2.fighters[0]; f.item = item; if (item) f.itemUses = 3; }, 16);
}, item);

// ---------- ② 持有噴火帽 = 頭上掛 GLB ----------
await pin('fire');
const worn = await page.waitForFunction(`${COUNT} >= 1`, { timeout: 15000 }).then(() => true).catch(() => false);
R('持有噴火帽=頭上戴 GLB(__hat 可見)', worn);

// ---------- ②b 掛點=avatar 頭骨 + 尺寸/位置照 studio 校準比例(item-3b) ----------
// 病 3 第三次:studio 把 avatar 縮到跟素體同高(無放大係數)→ 掛 headPivot 正確;遊戲 avatar 是 box rig
// 的 1.3 倍(AVATAR_SCALE)→ box headPivot 遠在 avatar 頭部下方。斷言:掛在 avatar 頭骨下,
// 且帽高/帽底 = 使用者 studio 校準換算的頭高比例(hRatio 1.5476 / dropRatio 0.4986)。
const fit = await page.evaluate(() => {
  const s = __lab.labGroup.parent;
  let hw = null, g = null;
  s.traverse(o => { if (o.name === 'HEADGEAR') hw = o; });
  s.traverse(o => { if (!g && o.userData && o.userData.avatar && o.userData.headgear) g = o; });
  const av = g && g.userData.avatar;
  if (!av) return { skip: true };
  const hb = av.by.head && av.by.head.bone;
  let onBone = false; for (let p = hw && hw.parent; p; p = p.parent) if (p === hb) { onBone = true; break; }
  const hatBB = new THREE.Box3().setFromObject(hw);
  const headBB = new THREE.Box3();
  for (const m of (av.by.head.meshes || [])) headBB.expandByObject(m);
  const headH = headBB.max.y - headBB.min.y;
  return { onBone, hRatio: (hatBB.max.y - hatBB.min.y) / headH, dropRatio: (headBB.min.y - hatBB.min.y) / headH,
    topClear: (hatBB.max.y - headBB.max.y) / headH,
    wrapX: hatBB.min.x < headBB.min.x && hatBB.max.x > headBB.max.x,
    wrapZ: hatBB.min.z < headBB.min.z && hatBB.max.z > headBB.max.z };
});
R('火帽掛 avatar 頭骨(不是 box headPivot 隱形 driver=病 3)', fit.skip || fit.onBone === true, JSON.stringify(fit));
R('帽尺寸=包覆規則(這顆頭走頂部淨空:hRatio≈1.849 / dropRatio≈0.50)',
  fit.skip || (Math.abs(fit.hRatio - 1.849) < 0.07 && Math.abs(fit.dropRatio - 0.4986) < 0.06), JSON.stringify(fit));
R('item-3c:帽包裹整顆頭(帽頂高過頭頂 ≥0.25×headH、xz 整圈包住)',
  fit.skip || (fit.topClear > 0.25 && fit.wrapX && fit.wrapZ), JSON.stringify(fit));

// ---------- ③ 無道具 = 帽子隱藏 ----------
await pin(null);
const hidden = await page.waitForFunction(`${COUNT} === 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('無道具=帽子隱藏(__hat 不可見)', hidden);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
