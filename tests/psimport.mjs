// punch-studio 匯入實驗室(ugc-1/1b;使用者:「punch-studio 改成匯入實驗室」)驗收:
// ①蒙皮 GLB 載得進去(舊版只吃剛體分件,VRM 命名會被 AVATAR_REQUIRED 擋下=「缺骨頭」硬失敗)
// ②骨名別名表:遊戲原生命名 + VRoid/VRM `J_Bip_*` 都收滿 16 骨
// ③rest 正規化:A-pose(VRoid 出廠,偏 45°)開校正後殘差→0,且同幀骨頭方向與 T-pose 版一致
// ④**內建 base-avatar 不套校正**——與遊戲同一條規則(遊戲只對匯入角色校正)。這條是 WYSIWYG 命脈:
//   實驗室要是校正了內建角色(腿刻意外八 13°),這裡編的姿勢進遊戲就會偏
// ⑤匯入檢查報告:骨頭對照表 + 蒙皮/面數 + 提醒(缺骨/面數/無貼圖/morph/多蒙皮網格)
// ⑥缺骨頭的模型=明確失敗 + 報告指出缺哪幾根(不是靜默壞掉)
// ⑦無 page/console 錯誤
// 陷阱:①studio 吃 CDN(r128/GLTFLoader/DRACOLoader),egress 擋 → setRequestInterception 餵本地 three-128
//         (**要帶 access-control-allow-origin:\***)②rest 是**載入時烤死**的 → 切校正開關要重載才生效
//       ③測試 GLB 由 fixtures/mkskin.mjs 當場產(骨名/rest 版本 = 別名表與校正的規格書)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { buildSkinGlb } from './fixtures/mkskin.mjs';

const R128 = 'node_modules/three-128/build/three.min.js';
const GLTF = 'node_modules/three-128/examples/js/loaders/GLTFLoader.js';
const DRACO = 'node_modules/three-128/examples/js/loaders/DRACOLoader.js';
for (const f of [R128, GLTF, DRACO]) if (!fs.existsSync(f)) { console.log('SKIP psimport:缺 three-128(npm i three-128@npm:three@0.128.0)'); process.exit(0); }

const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.setRequestInterception(true);
page.on('request', r => {
  const u = r.url(), hdr = { 'access-control-allow-origin': '*', 'content-type': 'application/javascript' };
  if (/favicon\.ico$/.test(u)) return r.respond({ status: 200, body: '' });
  const local = /three\.min\.js/.test(u) ? R128 : /GLTFLoader\.js/.test(u) ? GLTF : /DRACOLoader\.js/.test(u) ? DRACO : null;
  if (local && /^https?:/.test(u)) return r.respond({ status: 200, headers: hdr, body: fs.readFileSync(local, 'utf8') });
  if (/^https?:\/\/(?!localhost)/.test(u)) return r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
  r.continue();
});
await page.goto('http://localhost:8099/tools/punch-studio.html', { waitUntil: 'networkidle0' });
await page.bringToFront();
await page.waitForFunction('window.__psAvatar', { timeout: 30000 });
await page.waitForFunction('window.__psAvatar.report()', { timeout: 30000 });   // 開機自動載 base-avatar

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };

// 把一顆 GLB 餵進實驗室,回報告 + 同幀上臂→前臂世界方向
const load = (glb, label, fix) => page.evaluate(async (b64, label, fix) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__psAvatar.tposeFix(fix);
  const loaded = await window.__psAvatar.load(u.buffer, label);
  const rep = window.__psAvatar.report(), av = window.__psAvatar.avatar();
  let dir = null;
  if (av && av.by.upperarm_r && av.by.forearm_r) {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    av.by.upperarm_r.bone.getWorldPosition(p); av.by.forearm_r.bone.getWorldPosition(q);
    dir = q.sub(p).normalize().toArray().map(n => +n.toFixed(2));
  }
  return { loaded, dir, skinned: rep.skinned, tris: rep.tris, warn: rep.warn, missing: rep.missing,
           restDev: rep.restDev, restResid: rep.restResid, fixOn: rep.fixOn, builtin: rep.builtin,
           yawFix: rep.yawFix, uarmL: rep.slots.upperarm_l,
           slots: rep.slots, bones: Object.values(rep.slots).filter(Boolean).length };
}, glb.toString('base64'), label, fix);

// ---------- ④ 內建角色:開機載入後不該被校正 ----------
const boot = await page.evaluate(() => { const r = window.__psAvatar.report();
  return { label: r.label, builtin: r.builtin, fixOn: r.fixOn, dev: r.restDev, resid: r.restResid,
           skinned: r.skinned, heads: r.headsAfter, chibiFit: r.chibiFit }; });
ok(boot.label === 'base-avatar.glb' && boot.builtin === true, `④ 開機自動載內建 base-avatar(${boot.label})`);
ok(boot.fixOn === false && boot.resid === boot.dev,
  `④ 內建角色**不套** rest 校正(dev ${boot.dev}° = resid ${boot.resid}°;與遊戲同規則=WYSIWYG)`);
ok(boot.skinned === false, '④ 內建 base-avatar 認得出是剛體分件');

// ---------- ①② 蒙皮 + 別名表 ----------
const nat = await load(buildSkinGlb('native'), 'native.glb', true);
ok(nat.loaded === true && nat.skinned === true, '① 蒙皮 GLB 載得進實驗室');
ok(nat.bones === 16 && nat.missing.length === 0, `② 原生命名收滿 16 骨(${nat.bones})`);

const vrm = await load(buildSkinGlb('vrm'), 'vrm.glb', true);
ok(vrm.loaded === true && vrm.bones === 16, `② VRM(J_Bip_*)命名也收滿 16 骨(${vrm.bones};修前 8=載入被拒)`);
ok(/J_Bip/.test(vrm.slots.upperarm_l || ''), `② 報告列出對到的原始骨名(${vrm.slots.upperarm_l})`);

// ---------- ②b rest yaw 正規化(ugc-2e;與遊戲 restYawSnap 同規格)----------
// 反著擺的骨架(VRM0 出廠面向 −Z)要量到 180°、轉回 +Z、**重收骨頭**(左右重判,否則靜默鏡像)。
const y180 = await load(buildSkinGlb('native-yaw180'), 'yaw180.glb', true);
ok(y180.loaded === true && y180.yawFix === 180,
  `②b 反向骨架量到並修正 yaw(yawFix=${y180.yawFix};報告有提醒=${y180.warn.some(w => /面向/.test(w))})`);
ok(y180.uarmL === nat.uarmL, `②b 轉完重收=左右重判(upperarm_l=${y180.uarmL} 同 native)`);
ok(nat.yawFix === 0, `②b 慣例合規的角色不動(native yawFix=${nat.yawFix})`);

// ---------- ②c 肢段粗細(ugc-4;與遊戲 bakeLimbThickness 同規格)----------
const tk = await page.evaluate(() => { const a = window.__psAvatar.avatar();
  return a && a.thickRep ? { shin: a.thickRep.shin_l, ua: a.thickRep.upperarm_l } : null; });
ok(tk && tk.shin > 1.8 && tk.shin <= 2.5,
  `②c 白針小腿加粗係數落在預期(shin ${tk && tk.shin};目標=素體橫截 19.9%身高)`);

// ---------- ③ rest 正規化 ----------
const aOff = await load(buildSkinGlb('native-apose'), 'apose.glb', false);
ok(aOff.restDev >= 40 && aOff.restResid === aOff.restDev, `③ A-pose 未校正=偏離留著(${aOff.restDev}°)`);
const aOn = await load(buildSkinGlb('native-apose'), 'apose.glb', true);
ok(aOn.restDev >= 40 && aOn.restResid <= 1, `③ A-pose 開校正→殘差歸零(${aOn.restDev}° → ${aOn.restResid}°)`);
// ⚠ 比**夾角**不比逐分量:每次載入都在不同的動畫相位上取樣,同名幀的姿勢本來就差幾度
//(抖動 ~4°,而沒校正的病徵是 45°)。逐分量門檻抓得到抖動=假 FAIL,夾角 15° 才是有鑑別力的線。
const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0]*v[0] + u[1]*v[1] + u[2]*v[2]))) * 180 / Math.PI;
ok(aOn.dir && nat.dir && ang(aOn.dir, nat.dir) < 15,
  `③ 校正後 A-pose 的骨頭方向 = T-pose 版(夾角 ${aOn.dir && nat.dir ? ang(aOn.dir, nat.dir).toFixed(1) : '?'}°)`);
ok(aOff.dir && nat.dir && ang(aOff.dir, nat.dir) > 25,
  `③ 反證:未校正時方向明顯不同(夾角 ${aOff.dir && nat.dir ? ang(aOff.dir, nat.dir).toFixed(1) : '?'}°)`);

// ---------- ⑤ 報告內容 ----------
ok(nat.tris > 0 && typeof nat.skinned === 'boolean', `⑤ 報告帶面數/蒙皮(${nat.tris} 面)`);
ok(aOn.warn.some(w => /rest 偏離/.test(w)), '⑤ A-pose 會出「rest 偏離」提醒');
ok(nat.warn.some(w => /貼圖/.test(w)), '⑤ 無貼圖模型會出貼圖提醒');

// ---------- ⑥ 缺骨頭=明確失敗 ----------
// 把四根手臂骨的名字換成無意義字串 → 應該載入失敗並在報告列出缺哪幾根。
// ⚠ **等長替換**:GLB 檔頭記著 JSON chunk 長度,改長度會讓整個檔解析失敗
//(那是「壞檔」不是「缺骨頭」,測錯東西——第一版 UpperArmL(9)→10 個 z 就炸在 JSON.parse)。
const badGlb = Buffer.from(Buffer.from(buildSkinGlb('native')).toString('latin1')
  .replace(/"UpperArmL"/g, '"zzzzzzzzz"').replace(/"UpperArmR"/g, '"zzzzzzzzy"')   // 9 → 9
  .replace(/"ForearmL"/g, '"zzzzzzzy"').replace(/"ForearmR"/g, '"zzzzzzzx"'),      // 8 → 8
  'latin1');
const br = await load(badGlb, 'broken.glb', true);
ok(br.loaded === false, '⑥ 缺必要骨頭=載入明確失敗(不是靜默壞掉)');
ok(br.missing.length >= 4 && br.warn.some(w => /缺 \d+ 根必要骨頭/.test(w)),
  `⑥ 報告指出缺哪幾根(${br.missing.join('/')})`);

// ---------- ⑧ chibi 比例正規化(ugc-1c):**必須與遊戲一致** ----------
// 使用者拍板「維持 chibi 風格,其他 GLB 只是外觀套進來,骨子還是 chibi」。studio 要是不做同一件事,
// 這裡看到 8 頭身、遊戲裡是 3 頭身,編出來的姿勢進遊戲就偏——這是 WYSIWYG 命脈。
// ⚠ 頭身比自 ugc-2d 起量**真頭高(下巴→頭頂)**,基準 2.95(舊定義的 3.08/3.15 已作廢)。
const measure = (glb, label, on) => page.evaluate(async (b64, label, on) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__psAvatar.chibiFit(on);
  const loaded = await window.__psAvatar.load(u.buffer, label);
  if (typeof setActiveKey === 'function') setActiveKey(0);   // 0f=idle,雙腳著地(才能拿腳底當地面基準)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rep = window.__psAvatar.report(), av = window.__psAvatar.avatar();
  // 真實蒙皮包圍盒(setFromObject 對蒙皮只回 bind pose)
  const box = new THREE.Box3(), v = new THREE.Vector3();
  av.wrap.traverse(o => { if (!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if (!P) return;
    const st = Math.max(1, Math.floor(P.count / 200));
    for (let i = 0; i < P.count; i += st) { v.set(P.getX(i), P.getY(i), P.getZ(i));
      if (o.isSkinnedMesh) o.boneTransform(i, v); box.expandByPoint(v.applyMatrix4(o.matrixWorld)); } });
  return { loaded, chibiFit: rep.chibiFit, before: rep.headsBefore, after: rep.headsAfter,
           soleOffset: av.soleOffset, rootBone: av.by.root.bone.name,
           minY: +box.min.y.toFixed(2), h: +(box.max.y - box.min.y).toFixed(2) };
}, glb.toString('base64'), label, on);

const K1 = await measure(buildSkinGlb('native'), 'chibi-on.glb', true);
const K0 = await measure(buildSkinGlb('native'), 'chibi-off.glb', false);
ok(K1.chibiFit === true && K1.before != null, `⑧ 匯入角色套 chibi 比例(修前頭身比 ${K1.before})`);
ok(K1.after > 2.4 && K1.after < 4.2, `⑧ 壓到 chibi 頭身比(${K1.before} → ${K1.after};基準 2.95)`);
ok(K1.after < K0.after, `⑧ 有差別:開 ${K1.after} vs 關 ${K0.after}`);
ok(K0.chibiFit === false && K0.before === null, '⑧ 開關可關掉(chibiFit(false))');
ok(Math.abs(K1.minY) < 0.15, `⑧ 腳貼地 minY=${K1.minY}(idle 幀雙腳著地;bind pose 盒量不到蒙皮形變)`);
ok(K1.soleOffset != null, `⑧ 蒙皮走腳骨推算踩地(soleOffset=${K1.soleOffset},非 bind pose 包圍盒)`);
ok(/hips|root/i.test(K1.rootBone || ''), `⑧ root 取到真髖骨(${K1.rootBone})`);
const bootHeads = boot.heads;
ok(bootHeads > 2.8 && bootHeads < 3.4, `⑧ 內建 base-avatar 本身就是 chibi 基準(${bootHeads} 頭身)且不被套`);

ok(errs.length === 0, '⑦ 無 page/console 錯誤' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));

await B.close();
console.log(`\n== psimport ${pass}/${pass + fail} ==`);
process.exit(fail ? 1 : 0);
