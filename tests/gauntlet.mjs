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

// ---------- ②b 掛點=avatar 手骨(病 3:掛 box 腕=調姿勢脫手;掛手骨=出拳中也貼手) ----------
await page.waitForFunction('window.__avatars && __avatars.length > 0', { timeout: 20000 }).catch(() => { /* avatar 未開時跳過 */ });
const follow = await page.evaluate(() => {
  const av = window.__avatars && __avatars[0]; if (!av) return { skip: true };
  const s = __lab.labGroup.parent; let gw = null; s.traverse(o => { if (o.name === 'GAUNTLET') gw = o; });
  if (!gw) return { onBone: false, dist: -1 };
  const onBone = gw.parent === av.by.hand_r.bone;
  __v2.punch(__v2.fighters[0]);                                     // 出拳中量距離(掛 box 腕時這裡會拉開)
  const gp = gw.getWorldPosition(gw.position.clone());
  const hp = av.by.hand_r.bone.getWorldPosition(av.by.hand_r.bone.position.clone());
  return { onBone, dist: Math.hypot(gp.x - hp.x, gp.y - hp.y, gp.z - hp.z) };
});
R('掛 avatar 手骨+出拳中貼手(dist<3px)', follow.skip || (follow.onBone && follow.dist < 3), JSON.stringify(follow));

// ---------- ③ 無道具 = 手套隱藏 ----------
await pin(null);
const hidden = await page.waitForFunction(`${COUNT} === 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('無道具=手套隱藏(__gauntlet 不可見)', hidden);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
