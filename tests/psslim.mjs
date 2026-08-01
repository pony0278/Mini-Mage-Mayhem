// 匯出遊戲角色檔(瘦身)ugc-2 驗收(fixture = mkskin 'native-fat':3 morph + 768 不透明圖 +
// 256 半透明圖 + 只被假 VRM extension 引用的 512 thumbnail,共 ~3.1MB):
// ①大幅變小 ②morph target/動畫全拔 ③VRM extension 拔掉、KHR 系留著
// ④thumbnail(孤兒圖)空殼成 1×1 ⑤不透明大圖 → ≤512 + JPEG ⑥半透明圖 → 留 PNG(alpha 保住)
// ⑦瘦身檔載回實驗室:16 骨/蒙皮/報告 morph=0(r128 loader 過關)
// ⑧瘦身檔進**遊戲**(r149):兩個 fighter 就緒、蒙皮真的會動(空殼化沒弄壞 skin 權重)
// ⑨Draco 等壓縮擴充=明確拒絕(遊戲裸 loader 讀不了,別讓玩家誤會能用)⑩無 console 錯誤
// 陷阱:①studio 吃 CDN → 攔截餵本地 three-128(帶 access-control-allow-origin:*)
//       ②「空殼化不重排索引」的風險=有東西還在讀被空殼的 view——⑧ 的 deform 斷言就是抓這個
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { buildSkinGlb } from './fixtures/mkskin.mjs';

const R128 = 'node_modules/three-128/build/three.min.js';
const GLTF = 'node_modules/three-128/examples/js/loaders/GLTFLoader.js';
const DRACO = 'node_modules/three-128/examples/js/loaders/DRACOLoader.js';
for (const f of [R128, GLTF, DRACO]) if (!fs.existsSync(f)) { console.log('SKIP psslim:缺 three-128(npm i three-128@npm:three@0.128.0)'); process.exit(0); }

const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errs = [];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };

const page = await B.newPage();
page.on('pageerror', e => errs.push('PAGE ' + e.message));
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
await page.waitForFunction('window.__psSlim && window.__psAvatar && window.__psAvatar.report()', { timeout: 30000 });

const fat = buildSkinGlb('native-fat');
const R = await page.evaluate(async (b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const { glb, stats } = await window.__psSlim.slim(u.buffer);
  const { json } = window.__psSlim.parse(glb);
  // 檢圖:逐 image 解碼尺寸(從新 BIN 取 bytes)
  const dv = new DataView(glb);
  const jlen = dv.getUint32(12, true);
  const binOff = 12 + 8 + jlen + 8;
  const imgInfo = [];
  for (const im of (json.images || [])) {
    const bv = json.bufferViews[im.bufferView];
    const bytes = new Uint8Array(glb, binOff + bv.byteOffset, bv.byteLength);
    let w = 0, h = 0;
    try { const bmp = await createImageBitmap(new Blob([bytes.slice()], { type: im.mimeType })); w = bmp.width; h = bmp.height; } catch (e) { /* 記 0 */ }
    imgInfo.push({ mime: im.mimeType, bytes: bv.byteLength, w, h });
  }
  // GPU 上傳回讀(黑貼圖問題的迴歸鉤):第一張圖上傳到 RT 讀平均色
  let gpuAvg = null;
  try {
    const bv0 = json.bufferViews[json.images[0].bufferView];
    const bmp = await createImageBitmap(new Blob([new Uint8Array(glb, binOff + bv0.byteOffset, bv0.byteLength).slice()], { type: json.images[0].mimeType }));
    const ren = new THREE.WebGLRenderer({ antialias: false }); ren.setSize(16, 16);
    const rt = new THREE.WebGLRenderTarget(16, 16);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 1;
    const sc2 = new THREE.Scene();
    const t = new THREE.Texture(bmp); t.needsUpdate = true; t.flipY = false;
    sc2.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: t })));
    ren.setRenderTarget(rt); ren.render(sc2, cam);
    const px = new Uint8Array(16 * 16 * 4); ren.readRenderTargetPixels(rt, 0, 0, 16, 16, px);
    let r = 0, g2 = 0, b2 = 0, n2 = 16 * 16;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g2 += px[i + 1]; b2 += px[i + 2]; }
    gpuAvg = [Math.round(r / n2), Math.round(g2 / n2), Math.round(b2 / n2)];
    ren.dispose();
  } catch (e) { gpuAvg = null; }
  const targets = (json.meshes || []).reduce((n, m) => n + (m.primitives || []).reduce((k, p) => k + (p.targets ? p.targets.length : 0), 0), 0);
  // 載回實驗室驗證(r128,同 loader 家族)
  const okBack = await window.__psAvatar.load(glb.slice(0), 'slim.glb');
  const rep = window.__psAvatar.report();
  return { gpuAvg, before: stats.before, after: stats.after, statMorphs: stats.morphs, thumbs: stats.thumbs,
           targets, anims: 'animations' in json, extUsed: json.extensionsUsed || [], imgInfo,
           okBack, bones: Object.values(rep.slots).filter(Boolean).length, skinned: rep.skinned, repMorphs: rep.morphs,
           glbB64: btoa(String.fromCharCode(...new Uint8Array(glb).subarray(0, 0))) === '' ? (() => {
             const a = new Uint8Array(glb); let s = ''; const CH = 0x8000;
             for (let i = 0; i < a.length; i += CH) s += String.fromCharCode.apply(null, a.subarray(i, i + CH));
             return btoa(s); })() : '' };
}, fat.toString('base64'));

const mb = n => (n / 1048576).toFixed(2);
// 門檻 0.5:fixture 的雜訊貼圖是 PNG 的最壞情況(壓不動);真實動漫貼圖(平塗+漸層)壓得多得多
//(實測使用者 VRoid 檔 18.2MB → ~3MB)。這裡驗的是「結構有拔乾淨」,不是壓縮率極限。
ok(R.after < R.before * 0.5, `① 大幅變小:${mb(R.before)}MB → ${mb(R.after)}MB`);
ok(R.targets === 0 && R.statMorphs === 3 && !R.anims, `② morph target 全拔(拔了 ${R.statMorphs} 個)、無動畫`);
ok(!R.extUsed.some(k => /^VRM/i.test(k)), `③ VRM extension 拔掉(extensionsUsed=${JSON.stringify(R.extUsed)})`);
ok(R.thumbs === 1 && R.imgInfo[2] && R.imgInfo[2].bytes < 300 && R.imgInfo[2].w === 1,
  `④ 孤兒 thumbnail 空殼成 1×1(${R.imgInfo[2] ? R.imgInfo[2].bytes : '?'} bytes)`);
// ⚠ 一律 PNG,禁 JPEG:Chrome 的 JPEG ImageBitmap 是 YUV 底,SwiftShader WebGL 上傳會**全黑**
//(2D canvas 取樣正常=看不出來;readRenderTargetPixels 量化抓到 6/6 JPEG 全黑、9/9 PNG 全好)。
ok(R.imgInfo[0] && R.imgInfo[0].mime === 'image/png' && Math.max(R.imgInfo[0].w, R.imgInfo[0].h) <= 512,
  `⑤ 不透明大圖 768 → ${R.imgInfo[0] ? R.imgInfo[0].w + '×' + R.imgInfo[0].h : '?'} **PNG**(禁 JPEG:SwiftShader 上傳全黑)`);
ok(R.imgInfo[1] && R.imgInfo[1].mime === 'image/png' && R.imgInfo[1].w === 256,
  `⑥ 半透明圖 PNG(alpha 保住,${R.imgInfo[1] ? R.imgInfo[1].w + '×' + R.imgInfo[1].h : '?'})`);
// GPU 上傳驗證:瘦身檔的貼圖用遊戲同款 pipeline 上傳後回讀,不得是黑的
ok(R.gpuAvg && R.gpuAvg.some(v => v > 24), `⑥b GPU 上傳回讀非全黑(avg ${JSON.stringify(R.gpuAvg)})`);
ok(R.okBack === true && R.bones === 16 && R.skinned === true && R.repMorphs === 0,
  `⑦ 瘦身檔載回實驗室:16 骨/蒙皮/morph=0(r128 loader 過關)`);

// ---------- ⑧ 瘦身檔進遊戲(r149) ----------
const slimGlb = Buffer.from(R.glbB64, 'base64');
const gp = await B.newPage();
gp.on('pageerror', e => errs.push('PAGE ' + e.message));
gp.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await gp.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await gp.setRequestInterception(true);
gp.on('request', r => {
  if (r.url().includes('assets/rigs/base-avatar.glb')) {
    r.respond({ status: 200, contentType: 'model/gltf-binary', headers: { 'access-control-allow-origin': '*' }, body: slimGlb });
  } else r.continue();
});
await gp.goto('http://localhost:8099/v2.html?turbo=8&chibi=0&avatar=1', { waitUntil: 'networkidle0' });   // ugc-6:方塊人是預設,avatar 功能測試要明確 opt-in(?avatar=1)
await gp.bringToFront();
await gp.waitForFunction('window.__avatars && window.__avatars.length >= 2', { timeout: 30000 });
const G = await gp.evaluate(async () => {
  const av = window.__avatars[0], v2 = window.__v2;
  let skin = null; av.wrap.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
  const cloud = () => { const P = skin.geometry.attributes.position, v = new THREE.Vector3();
    const step = Math.max(1, Math.floor(P.count / 200)), arr = [];
    for (let i = 0; i < P.count; i += step) { skin.boneTransform(i, v.set(P.getX(i), P.getY(i), P.getZ(i))); arr.push(v.x, v.y, v.z); }
    return arr; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c0 = cloud(); v2.punch(v2.fighters[0]);
  let d = 0;
  for (let i = 0; i < 10; i++) { await frame(); const c1 = cloud();
    let sum = 0; for (let j = 0; j < c0.length; j++) sum += Math.abs(c0[j] - c1[j]); d = Math.max(d, sum / (c0.length / 3)); }
  return { bones: Object.keys(av.by).length, skinned: av.skinned, standH: +av.standH.toFixed(1), deform: +d.toFixed(4) };
});
ok(G.bones === 16 && G.skinned === true && G.standH > 40 && G.standH < 140,
  `⑧ 瘦身檔進遊戲:16 骨/蒙皮/站高 ${G.standH}px`);
ok(G.deform > 0.05, `⑧ 蒙皮真的會動(deform ${G.deform})——空殼化沒弄壞 skin 權重`);
await gp.close();

// ---------- ⑨ 壓縮擴充=明確拒絕 ----------
const rej = await page.evaluate(async (b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const { json, bin: bb } = window.__psSlim.parse(u.buffer);
  json.extensionsUsed = ['KHR_draco_mesh_compression'];
  const patched = window.__psSlim.write(json, bb);
  try { await window.__psSlim.slim(patched); return { threw: false }; }
  catch (e) { return { threw: true, msg: String(e.message || e) }; }
}, buildSkinGlb('native').toString('base64'));
ok(rej.threw && /Draco|draco/i.test(rej.msg), `⑨ Draco 壓縮檔明確拒絕(${rej.msg.slice(0, 40)}…)`);

ok(errs.length === 0, '⑩ 無 page/console 錯誤' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));

await B.close();
console.log(`\n== psslim ${pass}/${pass + fail} ==`);
process.exit(fail ? 1 : 0);
