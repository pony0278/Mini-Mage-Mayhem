// ui-2 `?mark=outline` 輪廓線身分標記驗收(反殼描邊 = 同心放大子網格 + BackSide + MeshBasic)。
// ①旗標三態(outline/none/預設 arrow)②只描本機、只描方塊人身體(裝備/特效/蒙皮跳過)
// ③殼材質不變式(**depthWrite 必開**、toneMapped 關、BackSide)④放大率夾在 maxGrow 內
// ⑤**像素驗收:角色背後全是地板時,線仍然在**(ui-2d 真兇)⑥FX_LOW 整組關 ⑦無錯誤。
//
// ⚠ ⑤ 是這支測試存在的理由:ui-2d 的 bug 是 `depthWrite:false` + `renderOrder:-1` → 殼先畫、不留深度,
//   之後畫的地板直接蓋掉整條線。`__outline()` 那些旗標**全綠**也照樣看不到,所以結構斷言擋不住,
//   一定要真的回讀像素。主畫布 `preserveDrawingBuffer:false` 讀不到 → 自己開 WebGLRenderTarget 重畫
//   (同 render-portrait 回讀路子;`__gl.scene()/.camera()` 就是為此掛的)。
//   判準用**對照組**(把殼 visible=false 再拍一張)而不是絕對門檻,免得換場景就要調數字。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function load(url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.setViewport({ width: 1000, height: 700 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__lab && window.__outline', { timeout: 20000 });
  await page.waitForFunction('__v2.fighters[0].state === "alive"', { timeout: 20000 });
  return { page, errs };
}

// 角色站在場中央、鏡頭俯角拉高 → 背後全是地板(ui-2d 的失敗場景)。
// ⚠ **CAM 要每幀重釘、而且要等鏡頭真的到位**:`updateCamRig` 在 intro 結束那一幀會做一次性
//   `Object.assign(CAM, CAM_FIGHT)`,把測試寫進去的 dist/angle 蓋掉;CONC=3 下 rAF 被節流,
//   「設完 CAM 睡一下」的寫法會踩在蓋回去之前=量到遠鏡頭,角色小到描邊線次像素(實測 on 3 / off 3
//   的假 FAIL 就是這個)。所以開 interval 每幀重寫 + 用「角色在畫面上夠大」當收斂條件輪詢。
const stage = () => { const v = __v2; v.fighters[1].ai = false;
  v.fighters[1].x = 900; v.fighters[1].y = 620;
  const f = v.fighters[0]; f.x = 400; f.y = 430; f.facing = 0; f.stunned = false;
  window.__pinCam = setInterval(() => { v.v2s.introT = 0; v.CAM.dist = 300; v.CAM.angle = 55; }, 16); };
// 收斂條件:角色腳→頭在 NDC 上的高度(鏡頭還在 dist 720 時遠小於此)
const CAM_READY = `(() => { const c = __gl.camera(), f = __v2.fighters[0];
  const a = new THREE.Vector3(f.x, 0, f.y).project(c), b = new THREE.Vector3(f.x, 40, f.y).project(c);
  return Math.abs(a.y - b.y) > 0.25; })()`;

// ---------- ?mark=outline:建殼 + 結構不變式 + 像素 ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html?turbo=8&mark=outline');
  await page.evaluate(stage);
  await page.waitForFunction('__outline().hulls > 0', { timeout: 20000 });
  await page.waitForFunction(CAM_READY, { timeout: 30000 });      // ⚠ 見 stage 註解:別用固定 sleep
  const info = await page.evaluate(() => __outline());
  R('?mark=outline:模式生效且殼已建(hulls>0)', info.mode === 'outline' && info.on === true && info.hulls > 0, JSON.stringify(info));

  const inv = await page.evaluate(() => {
    const scene = __gl.scene(); const hulls = [];
    scene.traverse(o => { if (o.userData && o.userData.__hull) hulls.push(o); });
    const SKIP = ['__equip', '__hat', '__gauntlet', '__whip', '__frost', '__barrel', '__shockbone', '__burnfx', '__hatflame', '__sprayfx'];
    let badMat = 0, badScale = 0, onSkip = 0, onSkinned = 0, maxG = 0;
    for (const h of hulls) {
      const m = h.material, par = h.parent;
      if (!m.depthWrite || m.toneMapped || m.side !== THREE.BackSide) badMat++;   // ⚠ depthWrite 是 ui-2d 真兇
      const g = Math.max(h.scale.x, h.scale.y, h.scale.z); maxG = Math.max(maxG, g);
      if (g > 1.7001) badScale++;
      if (par && par.isSkinnedMesh) onSkinned++;
      if (par && SKIP.some(f => par.userData[f])) onSkip++;
    }
    // 只描本機:對手身上不該有殼。⚠ actorMeshes 是 render-actors 的模組私有 Map(外面拿不到 rig),
    //   所以用**世界座標歸戶**:殼離哪個 fighter 近就算誰的(兩人擺在場地兩端,不會誤判)。
    const wp = new THREE.Vector3(), near = [0, 0];
    for (const h of hulls) { h.getWorldPosition(wp);
      const d = (f) => (wp.x - f.x) ** 2 + (wp.z - f.y) ** 2;
      near[d(__v2.fighters[0]) <= d(__v2.fighters[1]) ? 0 : 1]++; }
    return { hulls: hulls.length, badMat, badScale, onSkip, onSkinned, maxG, me: near[0], foe: near[1] };
  });
  R('殼材質不變式:depthWrite 開 / toneMapped 關 / BackSide', inv.badMat === 0, JSON.stringify(inv));
  R('放大率夾在 maxGrow(1.7)內(薄片不爆版)', inv.badScale === 0 && inv.maxG <= 1.7001, 'maxG=' + inv.maxG);
  R('裝備/特效/蒙皮網格不描邊', inv.onSkip === 0 && inv.onSkinned === 0, JSON.stringify(inv));
  R('只描本機(對手 rig 無殼)', inv.me > 0 && inv.foe === 0, JSON.stringify({ me: inv.me, foe: inv.foe }));

  // ⑤ 像素:離屏 RT 回讀,開殼 vs 關殼對照
  const px = await page.evaluate(() => {
    const { renderer } = __gl, scene = __gl.scene(), cam = __gl.camera();
    const W = 500, H = 350, rt = new THREE.WebGLRenderTarget(W, H);   // 對齊畫面長寬比:方形 RT 會再壓一次解析度
    const shot = () => { const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.render(scene, cam);
      const buf = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      renderer.setRenderTarget(prev); return buf; };
    // 只數**角色所在的小框**:地板符文/艙體本來就有一堆藍紫,掃全畫面會讓對照組底噪太高(實測 458)。
    // ⚠ readRenderTargetPixels 是**由下往上**的 row order(row 0 = 畫面底部)→ y 直接用 NDC 換算,別再翻一次。
    const f = __v2.fighters[0];
    const v = new THREE.Vector3(f.x, 22, f.y).project(cam);
    const cx = (v.x * 0.5 + 0.5) * W, cy = (v.y * 0.5 + 0.5) * H, HW = 75, HH = 70;
    // 判準:飽和藍(#2f6bff)。淺藍身體(~168,200,232)r 太高、艙環青色 g 太高,都篩得掉。
    const blue = (buf) => { let n = 0;
      for (let y = Math.max(0, cy - HH | 0); y < Math.min(H, cy + HH | 0); y++)
        for (let x = Math.max(0, cx - HW | 0); x < Math.min(W, cx + HW | 0); x++) {
          const i = (y * W + x) * 4, r = buf[i], g = buf[i + 1], b = buf[i + 2];
          if (b > 120 && r < 110 && b - g > 60) n++;
        }
      return n; };
    const on = blue(shot());
    const hulls = []; scene.traverse(o => { if (o.userData && o.userData.__hull) hulls.push(o); });
    hulls.forEach(h => h.visible = false);
    const off = blue(shot());
    hulls.forEach(h => h.visible = true);
    rt.dispose();
    return { on, off, box: [cx | 0, cy | 0] };
  });
  R('像素:背後是地板時輪廓線仍在(ui-2d 回歸)', px.on > 150 && px.on > px.off * 4, JSON.stringify(px));
  R('outline:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- 預設 / ?mark=none:描邊模組完全惰性 ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html?turbo=8');
  await page.evaluate(stage);
  await new Promise(r => setTimeout(r, 1200));           // 這三段只驗旗標,不需要等鏡頭
  const info = await page.evaluate(() => __outline());
  R('預設(無旗標)=tri 模式、不建殼(ui-3 後預設改倒三角)', info.mode === 'tri' && info.on === false && info.hulls === 0, JSON.stringify(info));
  R('預設:頭頂浮標仍在(ui-1 沒被 ui-2 弄掉)', await page.evaluate(() => !!(window.__hudmk && window.__hudmk[0])));
  R('預設:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
{
  const { page, errs } = await load('http://localhost:8099/v2.html?turbo=8&mark=none');
  await page.evaluate(stage);
  await new Promise(r => setTimeout(r, 1200));           // 這三段只驗旗標,不需要等鏡頭
  const info = await page.evaluate(() => __outline());
  R('?mark=none:不建殼也不畫浮標', info.mode === 'none' && info.hulls === 0 && !(await page.evaluate(() => !!(window.__hudmk && window.__hudmk[0]))), JSON.stringify(info));
  R('none:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- FX_LOW(手機/低階):整組關 ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html?turbo=8&mark=outline&fx=low');
  await page.evaluate(stage);
  await new Promise(r => setTimeout(r, 1200));           // 這三段只驗旗標,不需要等鏡頭
  const info = await page.evaluate(() => __outline());
  R('?fx=low:描邊整組關(hulls=0,省 ~20 draw call/角色)', info.low === true && info.hulls === 0, JSON.stringify(info));
  R('fx=low:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
