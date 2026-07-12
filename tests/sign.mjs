// 「THROW IN!」地面指示牌 GLB(assets/scene/throw-in-sign.glb)驗收:
// ①GLB 開局 fetch+parse+擺位成功(__lab.signGlbReady)②四塊牌進場景(geometry_0 ×4)
// ③四色程序箭頭已移除(換裝生效:那四個元素色 MeshBasic opacity0.5/toneMapped false 的桿+錐清空)④無 console 錯誤
// 陷阱:GLB async 載入 → waitForFunction 輪詢 ready
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① GLB 載入+擺位 ----------
const ready = await page.waitForFunction('window.__lab && __lab.signGlbReady()', { timeout: 15000 }).then(() => true).catch(() => false);
R('指示牌 GLB 載入+擺位成功(signGlbReady)', ready);

// ---------- ②③ 四塊牌進場景 + 四色程序箭頭已移除 ----------
const st = await page.evaluate(() => {
  let signs = 0, arrows = 0;
  const arrowCols = new Set([0x78ddff, 0xa87cff, 0x78ff9b, 0xff914d]);
  __lab.labGroup.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'geometry_0') signs++;                                                     // GLB 牌(單一 mesh 名=geometry_0)
    if (o.material && o.material.opacity === 0.5 && o.material.toneMapped === false && arrowCols.has(o.material.color.getHex())) arrows++; // 殘留程序箭頭
  });
  return { signs, arrows };
});
R('四塊指示牌已進場景(geometry_0 ×4)', st.signs === 4, 'got ' + st.signs);
R('四色程序箭頭已移除(換裝生效)', st.arrows === 0, 'leftover ' + st.arrows);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
