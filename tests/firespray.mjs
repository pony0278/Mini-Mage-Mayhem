// 噴火帽 flipbook 噴射波(burn-2;使用者 chibi_helmet_flipbook demo 的 2D 圖集,拍板「動詞用漫畫」)驗收:
// ①atlas 載成+pool 預建(__fireSpray hook)②castFire=扇內 poof 波(__sprayfx 可見)且**由近而遠點燃**
// (首見幀的最遠可見 poof < 後段幀=波往外推)③逐格播放(off uniform 走過 ≥4 個不同幀)
// ④播完全收(pool 釋放、無殘留)⑤帽包覆(hat.mjs 管)⑥無 console 錯誤。
// 陷阱:①poof 壽命 ~1.1s(0.31s 波 + 0.81s 序列),turbo=8 一批 0.3s 遊戲時會整段跳過中段
//        → 無 turbo + rAF 逐幀 trace(同 burn.mjs)。②atlas 是黑底 RGB 無 alpha(additive 黑=透明),
//        別斷言材質 transparent 語意。③spawn 只在 texOk 後生效——先等 hook ready。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?menu=0', { waitUntil: 'networkidle0' });   // 無 turbo:波時窗要逐幀量
await page.bringToFront();
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① atlas 載成 + pool 預建 ----------
const ready = await page.waitForFunction('window.__fireSpray && __fireSpray().ready && __fireSpray().pool >= 1', { timeout: 20000 }).then(() => true).catch(() => false);
R('flipbook atlas 載成+pool 預建(__fireSpray ready)', ready, JSON.stringify(await page.evaluate(() => window.__fireSpray && __fireSpray())));

await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false;
  v.fighters[0].x = 560; v.fighters[0].y = 150; v.fighters[0].facing = 0; v.fighters[1].x = 900; v.fighters[1].y = 400; });   // 對手拉遠=不吃火(只驗演出)

// ---------- ②③④ cast → rAF 逐幀 trace ----------
const tr = await page.evaluate(() => new Promise(res => {
  const f = __v2.fighters[0], g = __v2.game;
  f.item = 'fire'; f.itemUses = 9; f.itemCastCd = 0; f._itemCastAt = 0;
  __v2.castFire(f);
  const t0 = g.time, trace = [];
  const tick = () => {
    const s = __lab.labGroup.parent; let vis = 0, maxD = 0, offs = [], pts = [];
    s.traverse(m => { if (m.userData && m.userData.__sprayfx && m.visible) { vis++;
      const d = Math.hypot(m.position.x - f.x, m.position.z - f.y); if (d > maxD) maxD = d;
      pts.push([+d.toFixed(0), +m.position.y.toFixed(0)]);
      const o = m.material.uniforms.off.value; offs.push(o.x.toFixed(2) + ',' + o.y.toFixed(2)); } });
    trace.push({ t: +(g.time - t0).toFixed(2), vis, maxD: +maxD.toFixed(0), offs, pts });
    if (g.time - t0 < 1.8 && trace.length < 400) requestAnimationFrame(tick); else res(trace);
  };
  requestAnimationFrame(tick);
}));
const seen = tr.filter(s => s.vis > 0);
R('castFire=扇內 poof 波可見(__sprayfx)', seen.length > 3, 'visFrames=' + seen.length);
const peak = Math.max(...tr.map(s => s.vis));
R('poof 鋪滿扇形(峰值 ≥5 朵;FX_LOW 另計)', peak >= 5, 'peak=' + peak);
// 由近而遠點燃:首個可見幀的最遠 poof 距離 < 全程最遠(波往外推,不是同時全亮)
const firstD = seen[0].maxD, allD = Math.max(...seen.map(s => s.maxD));
R('由近而遠點燃(首幀最遠 poof < 全程最遠=波外推)', firstD < allD - 10, `first=${firstD} max=${allD}`);
// burn-2b(使用者「從頭頂噴出火舌,不用鋪在地面」):噴射弧=近端 poof 掛帽口高(H0 70)、遠端下落
// (H1 28)——近段(d<45)全部 y>50、遠端比近端低 ≥20px;全程沒有貼地 poof(y<15)。
const flat = seen.flatMap(s => s.pts);
const nearP = flat.filter(p => p[0] < 45), farP = flat.filter(p => p[0] > 75);
R('burn-2b:從帽口噴出(近段 poof 高 >50、無貼地 poof)',
  nearP.length > 0 && nearP.every(p => p[1] > 50) && flat.every(p => p[1] > 15),
  JSON.stringify({ near: nearP.slice(0, 3), min: Math.min(...flat.map(p => p[1])) }));
R('burn-2b:噴射弧往前下落(遠端比近端低 ≥20px)',
  farP.length > 0 && Math.min(...farP.map(p => p[1])) < Math.max(...nearP.map(p => p[1])) - 20,
  JSON.stringify({ nearMax: Math.max(...nearP.map(p => p[1])), farMin: Math.min(...farP.map(p => p[1])) }));
// 逐格播放:整段 trace 走過 ≥4 個不同 atlas 幀 offset
const uniq = new Set(); for (const s of seen) for (const o of s.offs) uniq.add(o);
R('flipbook 逐格播放(≥4 個不同幀 offset)', uniq.size >= 4, 'frames=' + uniq.size);
const tail = tr[tr.length - 1];
R('播完全收(結尾無殘留、pool 釋放)', tail.vis === 0, JSON.stringify({ t: tail.t, vis: tail.vis }));
const after = await page.evaluate(() => __fireSpray());
R('pool 回收(active=0)', after.active === 0, JSON.stringify(after));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
