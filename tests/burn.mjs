// 燃燒動作鏈 + 火帽施法姿勢 + 帽口常燃火(burn-1;使用者 elemental_hit v2.3 demo + studio 施法 clip)驗收:
// ①clip 接上(ITEM_SPEC.fire.clip='item_fire',delay=impact 0.117=鞠躬到位即噴,burn-2b)②火帽直擊=六段鏈
// (stunT=BURN_TOTAL+STUN_T=3.8、黑定格後挑飛 z>0、熄滅段趴姿、鏈完進暈眩段)③焦黑=換材質指標
// (45/45 全黑)且結束完整還原、**tint pass 不把顏色寫回共用炭黑材質**(render-actors u.charred 閘)
// ④restun 鐵則:已暈再被燒不重複暈 ⑤地形火維持 DoT(火海站著=burnT 削穩定,不入鏈)
// ⑥帽口常燃火苗(戴帽未攻擊 __hatflame 可見;無帽=收)⑦無 console 錯誤。
// burn-1d(使用者「範圍更大更明顯」):火場放大 ~1.3×(BODY 尺寸表)+火舌 8→12 角度均分+亮度增益 1.3。
// 陷阱:①受害者別放艙邊——burnFighter 一設 stunned,在 POD.r 46 內=當場失控入艙(收容演出 stunT=99,
//        測試全亂;這其實是功能:火焰挑飛滾進艙 cause='fire')。②turbo=8 批次 0.3~0.8s 遊戲時,
//        飛行窗(1.05s)/趴姿窗(0.55s)用 waitForFunction 會整段跳過 → 無 turbo + rAF 逐幀 trace。
//        ③**protocolTimeout 要放大到 600s**:無 turbo 的 4s 遊戲時 trace 是單一 page.evaluate,
//        併發 3 下 rAF 節流會拖到 200s 級(burn-1d 火場放大後更慢),原本的 180s 一超時就整支炸掉、
//        連匯總行都印不出來(run-all 只會顯示「(無匯總行)」——所以那邊也補了倒尾巴的診斷)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 600000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });   // 無 turbo:鏈時窗要逐幀量
await page.bringToFront();
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false;
  v.fighters[0].x = 560; v.fighters[0].y = 180; v.fighters[0].facing = 0; v.fighters[1].x = 630; v.fighters[1].y = 180; });

// ---------- ① clip 接上 ----------
const clip = await page.evaluate(async () => {
  const m = await import('./js/v2-state.js');
  const c = await import('./js/brawler-clips.js');
  return { clip: m.ITEM_SPEC.fire.clip, delay: +m.ITEM_SPEC.fire.delay.toFixed(3), has: !!c.CLIPS.item_fire, impactT: +(c.CLIPS.item_fire?.impactT ?? -1).toFixed(3), spine: c.CLIPS.item_fire?.phases?.anti?.spine_x };
});
// burn-2b(使用者「火帽不需要延遲,鞠躬時就定格噴火」):impact 移到鞠躬到位格 7f=0.117s,17f 留定格鍵
R('施法 clip 接上(item_fire/impact 0.117=鞠躬到位即噴/anti 前傾 spine 70)',
  clip.clip === 'item_fire' && clip.has && Math.abs(clip.delay - 7 / 60) < 0.001 && clip.spine === 70, JSON.stringify(clip));

// ---------- ② 直擊=六段鏈(rAF 逐幀 trace) ----------
const tr = await page.evaluate(() => new Promise(res => {
  const f = __v2.fighters[0], o = __v2.fighters[1], g = __v2.game;
  o.stunned = false; o.restunT = 0; o.stunT = 0; o._burnCh = null; o.burnT = 0; f.facing = 0;
  const t0 = g.time, trace = [];
  __v2.castFire(f);
  const first = { stunned: o.stunned, stunT: +o.stunT.toFixed(2), chain: !!o._burnCh };
  const tick = () => {
    const s = __lab.labGroup.parent; let fx = 0, dark = 0, flo = 1e9, fhi = -1e9, fcx = 0, fi = 0, cores = 0;
    s.traverse(m => { if (m.userData && m.userData.__burnfx && m.visible) { fx++;
      const p = m.getWorldPosition(new THREE.Vector3()); fcx += p.x;
      const iu = m.material.uniforms && m.material.uniforms.inten; if (iu) fi = Math.max(fi, iu.value);
      const du = m.material.uniforms && m.material.uniforms.dAmt; if (du && du.value > 0.98) cores++; // dAmt 1.0=非 tile 的 core quad(黑煙材質無此 uniform)
      flo = Math.min(flo, p.y - m.scale.y * 0.5); fhi = Math.max(fhi, p.y + m.scale.y * 0.5); } });
    let gg = null, bcx = null;
    s.traverse(x => { if (!gg && x.userData && x.userData.pose && x.userData.rig) { const p = x.getWorldPosition(new THREE.Vector3()); if (Math.abs(p.z - o.y) < 70 && Math.abs(p.x - o.x) < 110 && Math.abs(p.x - f.x) > 4) gg = x; } });
    if (gg) { const v = new THREE.Vector3(0, 40, 0); gg.localToWorld(v); bcx = +v.x.toFixed(0); }
    if (gg) gg.traverse(m => { if (m.isMesh && m.material && m.material.color && m.material.color.getHex() === 0x171310) dark++; });
    trace.push({ t: +(g.time - t0).toFixed(2), z: +(o.z || 0).toFixed(0), ch: !!o._burnCh, lie: !!o._lying, stun: o.stunned, fx, dark, fi: +fi.toFixed(2), cores,
      flo: fx ? +flo.toFixed(0) : null, fhi: fx ? +fhi.toFixed(0) : null,
      fcx: fx ? +(fcx / fx).toFixed(0) : null, bcx });
    if (g.time - t0 < 4.0 && trace.length < 500) requestAnimationFrame(tick); else res({ first, trace });
  };
  requestAnimationFrame(tick);
}));
R('直擊=入鏈(stunned 即立、stunT=BURN_TOTAL+STUN_T=3.8)', tr.first.stunned && tr.first.chain && Math.abs(tr.first.stunT - 3.8) < 0.05, JSON.stringify(tr.first));
const zmax = Math.max(...tr.trace.map(s => s.z));
R('黑定格後挑飛(zmax 接近 apex 75)', zmax > 40, 'zmax=' + zmax);
R('熄滅段趴姿(_lying 撐住)', tr.trace.some(s => s.lie && s.z === 0));
R('鏈中火焰包身可見(__burnfx)', tr.trace.some(s => s.fx > 0));
// burn-1b(使用者反饋「只有一小部分燃燒」):火場要包整隻——飛行幀火場底貼身(≈z)且縱向覆蓋>55px(躺身長級);
// 病根=①DoT 分支誤黏焦炭 if 鏈,鏈中被蓋成 0.62× 小火 ②尺寸/錨點未照 av.standH 包全身
// burn-1d(使用者「範圍可以更大更明顯嗎」):火場整體放大 ~1.3×(BODY 表)——span 門檻同步拉到 >85
// (放大前實測 ~78,放大後 ~102);縮回舊尺寸會被這條抓到。
const flyF = tr.trace.filter(s => s.z > 30 && s.fx > 0);
R('burn-1b/1d:飛行幀火場貼身+放大後覆蓋整隻(lo≈z、span>85)',
  flyF.length > 0 && flyF.every(s => Math.abs(s.flo - s.z) < 45 && (s.fhi - s.flo) > 85),
  flyF.length ? JSON.stringify(flyF[Math.floor(flyF.length / 2)]) : '(無飛行幀)');
// burn-1c(使用者反饋「火停在被攻擊位置沒跟人」):火場水平中心=可見身體中心(g.localToWorld,
// demo _fireCenter 原式)——不是 sim x(視覺落後 ~35px)也不是 g 原點(趴姿 lieDir 補償偏 ~30px)。
const glueF = tr.trace.filter(s => s.z > 20 && s.fx > 0 && s.bcx != null);
R('burn-1c:飛行幀火場水平中心黏住可見身體中心(<18px)',
  glueF.length > 0 && glueF.every(s => Math.abs(s.fcx - s.bcx) < 18),
  glueF.length ? JSON.stringify(glueF[Math.floor(glueF.length / 2)]) : '(無樣本)');
// burn-1d:亮度增益 BODY.inten=1.3(shader col×tint×inten;fireInt 上限 1 → 量到 >1 就證明增益有掛上)
const fiMax = Math.max(...tr.trace.map(s => s.fi));
R('burn-1d:火焰亮度增益上桌(inten 峰值 >1.25)', fiMax > 1.25, 'fiMax=' + fiMax);
// burn-2e(使用者「燃燒包身的 core 也拔掉」,承 burn-2d):包身火也只剩會生滅的火舌,無形狀不動的 core quad。
// 同帽口火的結構斷言:core 材質 dAmt=1.0、火舌 0.95(黑煙材質無此 uniform=自動略過)。
const coreMax = Math.max(...tr.trace.map(s => s.cores));
R('burn-2e:包身火無靜止 core(全程 0 張 core quad、火舌 ≥12 束)',
  coreMax === 0 && Math.max(...tr.trace.map(s => s.fx)) >= 12, `coreMax=${coreMax} fxMax=${Math.max(...tr.trace.map(s => s.fx))}`);
R('焦黑=角色網格全換炭黑材質', tr.trace.some(s => s.dark > 20), 'darkMax=' + Math.max(...tr.trace.map(s => s.dark)));
R('鏈完進暈眩段(鏈旗清、仍暈=可抓收尾窗)', tr.trace.some(s => !s.ch && s.stun));
const lastD = tr.trace[tr.trace.length - 1];
R('醒來=焦黑完整還原(材質指標換回)', lastD.dark === 0 && !lastD.stun, JSON.stringify(lastD));

// ---------- ④ restun 鐵則 ----------
const restun = await page.evaluate(() => {
  const f = __v2.fighters[0], o = __v2.fighters[1];
  o.stunned = true; o.stunT = 0.9; o.restunT = 0; o._burnCh = null;
  f.item = 'fire'; f.itemUses = 5; f.itemCastCd = 0; f._itemCastAt = 0; f.facing = 0;
  f.x = 560; f.y = 180; o.x = 630; o.y = 180;
  __v2.castFire(f);
  return { stunT: +o.stunT.toFixed(2), chain: !!o._burnCh };
});
R('restun 鐵則:已暈再被燒=不重複暈不入鏈(只補著火視覺)', Math.abs(restun.stunT - 0.9) < 0.05 && !restun.chain, JSON.stringify(restun));

// ---------- ⑤ 地形火維持 DoT ----------
const dot = await page.evaluate(async () => {
  const fl = await import('./js/v2-floor.js');
  const o = __v2.fighters[1];
  o.stunned = false; o.restunT = 0; o.stunT = 0; o._burnCh = null; o.burnT = 0; o.stability = 100;
  o.x = 200; o.y = 200;
  fl.stampElement(200, 200, 40, 'oil'); fl.stampElement(200, 200, 40, 'fire');   // 腳下種火海
  const st0 = o.stability, t0 = __v2.game.time;
  // 等**遊戲時間**走 0.6s(併發下 rAF 節流,game.time 只走實時 4~36%——等牆鐘會什麼都沒發生)
  await new Promise(res => { const iv = setInterval(() => { if (__v2.game.time - t0 > 0.6) { clearInterval(iv); res(); } }, 30); });
  return { dropped: o.stability < st0, chain: !!o._burnCh };
});
R('地形火=DoT 削穩定、不入鏈(鏈只屬火帽直擊)', dot.dropped && !dot.chain, JSON.stringify(dot));

// ---------- ⑥ 帽口常燃火 ----------
await page.evaluate(() => { const o = __v2.fighters[1]; o.burnT = 0; o.stability = 100; o.x = 630; o.y = 180;
  window.__pin = setInterval(() => { const f = __v2.fighters[0]; f.item = 'fire'; f.itemUses = 3; f.itemCastCd = 0; }, 16); });
const HAT = `(()=>{const s=__lab.labGroup.parent;let n=0;s.traverse(o=>{if(o.userData&&o.userData.__hatflame&&o.visible)n++;});return n;})()`;
const hatOn = await page.waitForFunction(`${HAT} > 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('帽口常燃火苗(戴帽未攻擊也冒火)', hatOn);
// burn-2c(使用者「火帽頭頂的火焰可以更明顯嗎」):火苗尺寸=**照帽口寬現算**(舊版固定 6.5px=帽口 1/7 寬,
// item-3c 把帽放大後更看不見)。斷言火場寬 ≥0.6×帽寬、高過帽頂——縮回固定 px 會被這條抓到。
// burn-2d(使用者「取消中央那根靜止的火柱」):帽口火**只剩火舌、沒有 core**——core 是形狀不動的大 quad
// (`flameTex` 剪影每幀相同)=讀成實體物件。結構斷言:所有可見 __hatflame 都是「火舌材質」(dAmt 0.95,
// core 是 1.0)→ 把 core 加回來會被抓到。亮度門檻取 0.85:閒置呼吸帶增益後 0.891~1.323,舊版無增益 0.65~0.8。
const hatFit = await page.evaluate(() => {
  const s = __lab.labGroup.parent; s.updateMatrixWorld(true);
  let hg = null; s.traverse(o => { if (o.name === 'HEADGEAR' && o.visible && !hg) hg = o; });
  if (!hg) return { skip: true };
  const hb = new THREE.Box3().setFromObject(hg), fb = new THREE.Box3(); let n = 0, inten = 0, cores = 0;
  s.traverse(o => { if (o.userData && o.userData.__hatflame && o.visible) { n++;
    inten = Math.max(inten, o.material.uniforms.inten.value);
    if (o.material.uniforms.dAmt.value > 0.98) cores++;                 // dAmt 1.0=非 tile 的 core quad
    fb.union(new THREE.Box3().setFromCenterAndSize(o.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(o.scale.x, o.scale.y, 1))); } });
  return { n, cores, inten: +inten.toFixed(2), hatW: +(hb.max.x - hb.min.x).toFixed(0), hatTop: +hb.max.y.toFixed(0),
    flameW: +(fb.max.x - fb.min.x).toFixed(0), flameTop: +fb.max.y.toFixed(0) };
});
// 寬度門檻取 0.5:拔掉 core 後火場寬吃火舌生滅相位(實測 36~45px / 帽寬 52,即 0.69~0.87),
// 留餘裕免相位造成 flake;縮回舊固定 6.5px 的話沒有 core 只剩 ~11px=照樣抓得到。
R('burn-2c:火苗照帽口寬現算(寬 ≥0.5×帽寬、竄過帽頂、亮度增益 >0.85)',
  hatFit.skip || (hatFit.flameW > hatFit.hatW * 0.5 && hatFit.flameTop > hatFit.hatTop && hatFit.inten > 0.85), JSON.stringify(hatFit));
R('burn-2d:帽口火無靜止 core(全是會生滅的火舌 ≥5 束)',
  hatFit.skip || (hatFit.cores === 0 && hatFit.n >= 5), JSON.stringify(hatFit));
await page.evaluate(() => { clearInterval(window.__pin); const f = __v2.fighters[0]; f.item = null; f._itemVisType = null; f.itemCastCd = 0; });
const hatOff = await page.waitForFunction(`${HAT} === 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('無帽=火苗收', hatOff);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
