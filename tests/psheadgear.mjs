// punch-studio 頭戴道具掛點(item-3b;使用者:「punch studio 的 headgear 也一起改掛 avatar 頭骨」)驗收:
// ①studio 開機自動載 avatar ②火帽掛得上(道具庫 mountProp)③掛點=avatar 頭骨底下的補償 group
// ④**世界位置與舊 headPivot 掛法完全一致**=使用者已存的校準值(s/x/y/z/r*)語意不變、不用重調
// ⑤清除角色=退回素體 headPivot ⑥無 page/console 錯誤。
// 為什麼要補償 group:studio 把 avatar 縮到跟素體同高(avatar.js S=standH/size.y,無放大係數),
//   但 avatar 頭骨的原點/單位跟素體 headPivot 完全不同——直接換父節點會讓存好的校準值跳位。
//   中間插一層 matrix = headBone.matrixWorld⁻¹ × headPivot.matrixWorld → 局部空間等價,數字照用。
// 陷阱:①studio 吃 CDN(r128/GLTFLoader/DRACOLoader),egress 擋 → setRequestInterception 餵本地
//         three-128(**要帶 access-control-allow-origin:\***)。②`__ps.avatar` 是 getter 不是函式。
//       ③素體節點(scene/root/headPivot/AVATAR/PART_MODELS)是古典 script 的 let 全域 → page.evaluate 裸名存取。
//       ④**avatar wrap 掛 scene 不在 root 底下** → 量世界座標要 `scene.updateMatrixWorld(true)`,
//         用 root 會量到補償 group 還沒傳播的舊矩陣(=帽子的局部值),看起來像「跑掉了」。
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const R128 = 'node_modules/three-128/build/three.min.js';
const GLTF = 'node_modules/three-128/examples/js/loaders/GLTFLoader.js';
const DRACO = 'node_modules/three-128/examples/js/loaders/DRACOLoader.js';
for (const f of [R128, GLTF, DRACO]) if (!fs.existsSync(f)) { console.log('SKIP psheadgear:缺 three-128(npm i three-128@npm:three@0.128.0)'); process.exit(0); }
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
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
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

await page.goto('http://localhost:8099/tools/punch-studio.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ps && window.__psEquip', { timeout: 30000 });
const avOk = await page.waitForFunction('!!window.__ps.avatar', { timeout: 30000 }).then(() => true).catch(() => false);
R('studio 開機自動載入 avatar', avOk, JSON.stringify(await page.evaluate('window.__ps.avatar')));

const mount = await page.evaluate(async () => {
  const ok = await __psEquip.mountProp('fire_hat');
  await new Promise(r => requestAnimationFrame(r));           // 等 tick 跑一幀(avatar 重定向後矩陣才是最新)
  const hat = PART_MODELS.headgear;
  if (!hat) return { ok, hat: false };
  scene.updateMatrixWorld(true);                              // avatar wrap 掛 scene(不在 root 下),要從 scene 更新
  const bb = new THREE.Box3().setFromObject(hat);
  return { ok, hat: true, parentName: hat.parent && hat.parent.name,
    onHeadBone: !!(AVATAR && hat.parent && hat.parent.parent === AVATAR.by.head.bone),
    minY: +bb.min.y.toFixed(4), maxY: +bb.max.y.toFixed(4), cx: +((bb.min.x + bb.max.x) / 2).toFixed(4) };
});
R('火帽掛得上(道具庫 mountProp)', mount.ok === true && mount.hat === true, JSON.stringify(mount));
R('掛點=avatar 頭骨下的補償 group(PS_HEADGEAR_MOUNT)',
  mount.parentName === 'PS_HEADGEAR_MOUNT' && mount.onHeadBone === true, JSON.stringify(mount));

// 核心不變量:換父節點後世界位置不能動一分一毫,否則使用者的校準值就得重調
const old = await page.evaluate(() => {
  const hat = PART_MODELS.headgear;
  headPivot.add(hat); applyPartConfig('headgear');          // 強制掛回舊掛法
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(hat);
  return { minY: +bb.min.y.toFixed(4), maxY: +bb.max.y.toFixed(4), cx: +((bb.min.x + bb.max.x) / 2).toFixed(4) };
});
const drift = Math.max(Math.abs(mount.minY - old.minY), Math.abs(mount.maxY - old.maxY), Math.abs(mount.cx - old.cx));
R('世界位置與舊 headPivot 掛法一致(校準值語意不變)', drift < 1e-3, `最大差 ${drift.toFixed(5)}`);

// 清除角色 → 退回素體 headPivot
const cleared = await page.evaluate(() => {
  __psEquip.mountProp && null;
  if (typeof clearAvatar === 'function') clearAvatar();
  const hat = PART_MODELS.headgear;
  return { avatar: !!window.__ps.avatar, parentIsHeadPivot: hat ? hat.parent === headPivot : null };
});
R('清除角色=退回素體 headPivot', cleared.avatar === false && cleared.parentIsHeadPivot === true, JSON.stringify(cleared));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
