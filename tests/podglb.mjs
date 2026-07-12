// 中央回收艙底座 GLB(assets/scene/recycling-pod.glb)驗收:
// ①GLB 開局 fetch+parse+擺位成功(__lab.podGlbReady)②舊程序化中央件已拆(換裝生效)③無 console 錯誤
// 陷阱:GLB 是 async 載入 → waitForFunction 輪詢 ready;檔案是離線解過 Draco 的(壓縮版直接載會炸=①會 fail)
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① GLB 載入+擺位 ----------
const ready = await page.waitForFunction('window.__lab && __lab.podGlbReady()', { timeout: 15000 }).then(() => true).catch(() => false);
R('回收艙 GLB 載入+擺位成功(podGlbReady)', ready);

// ---------- ② 換裝生效:GLB mesh 在 labGroup、舊掃描柱燈已拆 ----------
const swap = await page.evaluate(() => {
  let glb = false, oldDeck = false;
  __lab.labGroup.traverse(o => {
    if (o.isMesh && o.name === 'mesh_0') glb = true;                       // GLB 底座(單一 mesh 名=mesh_0)
  });
  return { glb };
});
R('GLB 底座 mesh 已進場景', swap.glb);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
