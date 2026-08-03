// 風壓手套 GLB 右手裝備(item-4;使用者 Azure Turbine Gauntlet)驗收:
// ①GLB 載成(__lab.windGauntletReady)②持風壓手套(item='wind')=右手掛 GLB(__gauntlet 旗可見)
// ③無道具=手套隱藏 ④無 console 錯誤
// 陷阱:手套 clone 掛在 R.armR.wr(actor group 內)非 propGroup;可見性查祖鏈(wrap.visible 切換,不移除)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?avatar=1', { waitUntil: 'networkidle0' });   // ugc-6:方塊人是預設,avatar 功能測試要明確 opt-in(?avatar=1)
await page.waitForFunction('window.__v2 && window.__lab && __gl', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const ready = await page.waitForFunction('__lab.windGauntletReady && __lab.windGauntletReady() === true', { timeout: 20000 }).then(() => true).catch(() => false);
R('風壓手套 GLB 載成(windGauntletReady)', ready);
// gaunt-2/3 剪影+解剖契約(2026-08-03 使用者兩輪反饋:「很不像手套」→「發射時的手掌不對」):
// 程序化 proto 要貼齊被取代的 GLB——①軸系(−z 袖口/+z 指尖/+y 手背渦輪/−y 掌心噴口)②長寬比
// (1.13×1.00×1.78,z=最長軸)③**張開的手指**(不是握拳)④**掌心噴口**(施法姿勢=側掌外推,
// 玩家在發射瞬間看到的就是掌心那面;漏了它=一塊空白藍方塊)。掛載旋轉是照 GLB 軸系調的,軸系跑掉=戴上像根管子。
const sil = await page.evaluate(async () => {
  const M = await import('./js/render-core.js');
  const c = M.windGauntletClone(); c.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(c); const s = b.getSize(new THREE.Vector3());
  let fingers = 0, palmGlow = 0, backGlow = 0, cuff = 0;
  c.traverse(o => { if (!o.isMesh) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    // ⚠ 別用 emissiveIntensity 判「有沒有發光」——MeshStandardMaterial **預設就是 1.0**(即使 emissive 是黑色),
    //   會讓每個 mesh 都通過=斷言形同虛設。要看 emissive 顏色本身。
    const emi = o.material && o.material.emissive && o.material.emissive.getHex() !== 0 && o.material.emissiveIntensity > 0.4;
    if (p.z > 0.30) fingers++;                    // 指區零件(往 +z 伸出的手指/指節)
    if (emi && p.y < -0.10) palmGlow++;           // 掌心噴口的蓄能光(−y)
    if (emi && p.y > 0.10) backGlow++;            // 手背渦輪扇葉/轂心(+y)
    if (p.z < -0.25) cuff++;                      // 袖口區(−z)
  });
  return { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), fingers, palmGlow, backGlow, cuff };
});
R('剪影貼齊 GLB(z=最長軸 1.5~2.0×高、寬 0.9~1.3×高)',
  sil.z / sil.y > 1.5 && sil.z / sil.y < 2.0 && sil.x / sil.y > 0.9 && sil.x / sil.y < 1.3, JSON.stringify(sil));
R('解剖對位:張開手指(+z)+掌心噴口(−y 發光)+手背渦輪(+y 發光)+袖口(−z)',
  sil.fingers >= 8 && sil.palmGlow >= 1 && sil.backGlow >= 4 && sil.cuff >= 2, JSON.stringify(sil));
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

// ---------- ②b 掛點=avatar 手骨(病 3:掛 box 腕=調姿勢脫手;掛手骨=局部對位恆定=永遠貼手) ----------
// 斷言不變量:parent=手骨 + 局部位置=WIND_CAL_AV 校準值(姿勢無關;世界距離會隨校準偏移×骨縮放變,不能當尺)
await page.waitForFunction('window.__avatars && __avatars.length > 0', { timeout: 20000 }).catch(() => { /* avatar 未開時跳過 */ });
const follow = await page.evaluate(() => {
  const av = window.__avatars && __avatars[0]; if (!av) return { skip: true };
  const s = __lab.labGroup.parent; let gw = null; s.traverse(o => { if (o.name === 'GAUNTLET') gw = o; });
  if (!gw) return { onBone: false };
  __v2.punch(__v2.fighters[0]);                                     // 出拳中量(掛 box 腕的舊寫法=parent 不是手骨)
  return { onBone: gw.parent === av.by.hand_r.bone, lp: [gw.position.x, gw.position.y, gw.position.z] };
});
const calOk = follow.skip || (follow.onBone && Math.hypot(follow.lp[0] - 0.02, follow.lp[1] - 0.26, follow.lp[2] - 0.04) < 0.001);
R('掛 avatar 手骨+局部對位=校準值(出拳中不變)', calOk, JSON.stringify(follow));

// ---------- ②c 兩條掛載路必須等價(gaunt-4,使用者 2026-08-03「發射時掌心變成垂直的」) ----------
// 病史:`WIND_CAL`(box 腕)是 avatar 當預設時期的粗略佔位(rx90/ry0/rz0),**ugc-6 把方塊人翻回預設後
// 大家看到的就是這條沒校準過的路**——實測掌心朝側面(rz 少了 −95°)、尺寸大 26%。
// 這裡在 ?avatar=1 下(box rig 是隱形 driver,兩個掛點同時存在)驗「box 腕套上 WIND_CAL 後的世界變換
// == avatar 手骨那條(使用者 punch-studio 校準的真相)」,姿勢無關。
const equiv = await page.evaluate(async () => {
  const AB = await import('./js/actor-brawler.js');
  const s = __lab.labGroup.parent; let gw = null; s.traverse(o => { if (o.name === 'GAUNTLET') gw = o; });
  if (!gw) return { skip: true };
  let actor = gw; while (actor && !(actor.userData && actor.userData.rig)) actor = actor.parent;
  const wr = actor.userData.rig.armR.wr;
  s.updateMatrixWorld(true);
  const D2R = Math.PI / 180, C = AB.WIND_CAL;
  const want = gw.getWorldQuaternion(new THREE.Quaternion());                       // avatar 路=真相
  const qBox = wr.getWorldQuaternion(new THREE.Quaternion())
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(C.rx * D2R, C.ry * D2R, C.rz * D2R)));
  const dot = Math.abs(want.dot(qBox));
  const wsG = new THREE.Vector3(); gw.getWorldScale(wsG);
  const wsW = new THREE.Vector3(); wr.getWorldScale(wsW);
  return { angDeg: +(2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI).toFixed(1),   // 兩條路的朝向夾角
    boxSize: +(C.size * AB.BRAWLER_SPEC.boxScale).toFixed(2),                       // box 模式的世界尺度
    avSize: +(wsG.x / wsW.x).toFixed(2) };                                          // avatar 路換算到同一基準
});
R('box 腕校準 ≡ avatar 手骨校準(朝向 <5°、尺寸差 <8%)',
  equiv.skip || (equiv.angDeg < 5 && Math.abs(equiv.boxSize - equiv.avSize) / equiv.avSize < 0.08), JSON.stringify(equiv));

// ---------- ②c 最後一發:useItem 清 item,但施法未走完(itemCastCd>0)手套仍在(item-4h) ----------
await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
const lastUse = await page.evaluate(() => {
  const f = __v2.fighters[0];
  f.item = 'wind'; f.itemUses = 1; f.itemCastCd = 0; f._itemCastAt = 0; f._itemVisType = null; f.stunned = false;
  __v2.useItem(f);
  return { itemCleared: f.item === null, visType: f._itemVisType, cd: f.itemCastCd > 0 };
});
const stillWorn = await page.waitForFunction(`${COUNT} >= 1`, { timeout: 5000 }).then(() => true).catch(() => false);
R('item-4h:最後一發 item 已清但施法中(_itemVisType+cd)手套仍在', lastUse.itemCleared && lastUse.visType === 'wind' && lastUse.cd && stillWorn);
// 施法走完(itemCastCd 歸零)手套才收——直接把冷卻歸零(等它自然倒數在併發下會超時,且測的是同一個閘)
await page.evaluate(() => { const f = __v2.fighters[0]; f.itemCastCd = 0; f._itemCastAt = 0; f._itemCastType = null; });
const tucked = await page.waitForFunction(`${COUNT} === 0`, { timeout: 20000 }).then(() => true).catch(() => false);
R('施法完成後(itemCastCd→0)手套自動收', tucked);

// ---------- ③ 無道具 = 手套隱藏 ----------
await pin(null);
const hidden = await page.waitForFunction(`${COUNT} === 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('無道具=手套隱藏(__gauntlet 不可見)', hidden);

await page.evaluate(() => { if (window.__pin) clearInterval(window.__pin); });
R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
