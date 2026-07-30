// 蒙皮 GLB 角色管線(ugc-1「玩家自製角色」路線 B 核心三項,使用者拍板 2026-07-29)驗收:
// ①別名表:遊戲原生命名 **與** VRoid/VRM(J_Bip_*)命名都收滿 16 骨(修前 VRM 只收到 8)
// ②重綁骨架:兩個 fighter 的 skeleton 各自獨立(不共用引用)、bones 全落在自己的 wrap 底下
//   ——`Object3D.clone()` 不重綁,漏了就是兩人共用 template 骨架 + 蒙皮完全不動(實測形變 0.0081=死的)
// ③蒙皮真的跟著重定向變形(模型空間點雲位移 > 門檻)
// ④渲染定位:世界包圍盒中心≈fighter 座標、腳貼地、standH 與方塊人同量級(漏 ②=角色卡在世界原點、原始 GLB 尺寸 1.6)
// ⑤per-part 縮放對蒙皮改成「縮骨頭」:rhook 的 aR_scale 進得去 forearm_r 骨;hand_r 是子骨**不重複縮**(不然 s²)
// ⑥剛體分件的預設角色(base-avatar.glb)不受影響:skinned=false、16 骨、走的還是縮網格那條路
// ⑦無 console 錯誤
// 陷阱:①headless rAF 節流——形變/縮放都用「輪詢取極值」別抓單幀 ②fighter 1 是 AI 會自己動,
//       「兩人獨立」不能用位移差來證(要看 skeleton 引用/骨頭歸屬這種結構事實)
//       ③測試 GLB 由 fixtures/mkskin.mjs 當場產生(骨名版本=別名表的規格書),用 request 攔截餵進頁面
import puppeteer from 'puppeteer';
import { buildSkinGlb } from './fixtures/mkskin.mjs';

const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errs = [];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };

// glb=null → 不攔截,用 repo 的剛體 base-avatar.glb
async function openPage(glb, query) {
  const page = await B.newPage();
  page.on('pageerror', e => errs.push('PAGE ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
  if (glb) {
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.url().includes('assets/rigs/base-avatar.glb')) {
        r.respond({ status: 200, contentType: 'model/gltf-binary', headers: { 'access-control-allow-origin': '*' }, body: glb });
      } else r.continue();
    });
  }
  await page.goto('http://localhost:8099/v2.html?turbo=8' + (query || ''), { waitUntil: 'networkidle0' });
  await page.bringToFront();
  await page.waitForFunction('window.__avatars && window.__avatars.length >= 2', { timeout: 30000 });
  return page;
}

// 頁內共用探測(骨頭清單/骨架歸屬/形變/定位)
const PROBE = async () => {
  const A = window.__avatars, v2 = window.__v2, out = {};
  out.boneCount = Object.keys(A[0].by).length;
  out.bones = Object.keys(A[0].by).sort();
  out.skinned = A.map(a => !!a.skinned);
  const skins = A.map(a => { let m = null; a.wrap.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); return m; });
  out.hasSkin = skins.map(Boolean);
  out.sharedSkeleton = !!(skins[0] && skins[1] && skins[0].skeleton === skins[1].skeleton);
  const inside = (o, w) => { let p = o; while (p) { if (p === w) return true; p = p.parent; } return false; };
  out.skelInsideOwnWrap = skins.map((m, i) => !m || m.skeleton.bones.every(b => inside(b, A[i].wrap)));

  if (skins[0]) {   // 模型空間點雲(boneTransform 回傳 model space,已抵銷 matrixWorld)
    const cloud = (m) => {
      const P = m.geometry.attributes.position, v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(P.count / 200)), arr = [];
      for (let i = 0; i < P.count; i += step) { m.boneTransform(i, v.set(P.getX(i), P.getY(i), P.getZ(i))); arr.push(v.x, v.y, v.z); }
      return arr;
    };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c0 = cloud(skins[0]);
    v2.punch(v2.fighters[0]);
    let d = 0;
    for (let i = 0; i < 10; i++) { await frame(); const c1 = cloud(skins[0]);
      let s = 0; for (let j = 0; j < c0.length; j++) s += Math.abs(c0[j] - c1[j]); d = Math.max(d, s / (c0.length / 3)); }
    out.deform = +d.toFixed(4);
  }
  const bb = new THREE.Box3().setFromObject(A[0].wrap);
  out.cx = +((bb.min.x + bb.max.x) / 2).toFixed(1); out.cz = +((bb.min.z + bb.max.z) / 2).toFixed(1);
  out.footY = +bb.min.y.toFixed(1); out.standH = +A[0].standH.toFixed(1);
  out.fx = +v2.fighters[0].x.toFixed(1); out.fy = +v2.fighters[0].y.toFixed(1);
  out.handMeshes = A[0].by.hand_r ? A[0].by.hand_r.meshes.length : -1;
  out.handRig = !!A[0].handRig;
  return out;
};

// ---- ① native 命名 + ②③④ ----
const NATIVE_BONES = ['foot_l', 'foot_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'head', 'neck',
  'root', 'shin_l', 'shin_r', 'thigh_l', 'thigh_r', 'torso', 'upperarm_l', 'upperarm_r'].join(',');

const pN = await openPage(buildSkinGlb('native'), '');
const N = await pN.evaluate(PROBE);
ok(N.boneCount === 16 && N.bones.join(',') === NATIVE_BONES, `① 原生命名收滿 16 骨(${N.boneCount})`);
ok(N.skinned[0] === true && N.hasSkin[0] === true, '① 認得出是蒙皮角色(av.skinned)');
ok(N.sharedSkeleton === false, '② 兩個 fighter 的 skeleton 不共用引用');
ok(N.skelInsideOwnWrap[0] && N.skelInsideOwnWrap[1], '② skeleton.bones 全落在自己的 wrap 底下(重綁成功)');
ok(N.deform > 0.05, `③ 蒙皮跟著重定向變形(點雲位移 ${N.deform},修前 0.008=死的)`);
ok(Math.abs(N.cx - N.fx) < 20 && Math.abs(N.cz - N.fy) < 20, `④ 渲染在 fighter 位置(中心 ${N.cx},${N.cz} vs ${N.fx},${N.fy})`);
ok(N.footY < 6 && N.standH > 40 && N.standH < 140, `④ 腳貼地 ${N.footY}、站高 ${N.standH}px(非原始 GLB 1.6)`);
await pN.close();

// ---- ⑤ per-part 縮放=縮骨頭(rhook 的 aR_scale 最高 1.9) ----
const pS = await openPage(buildSkinGlb('native'), '&clip=rhook');
const S = await pS.evaluate(async () => {
  const av = window.__avatars[0];
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let fa = 1, hd = 1;
  for (let i = 0; i < 120; i++) { await frame();
    fa = Math.max(fa, av.by.forearm_r.bone.scale.x);
    hd = Math.max(hd, av.by.hand_r.bone.scale.x); }
  return { fa: +fa.toFixed(3), hd: +hd.toFixed(3) };
});
ok(S.fa > 1.05, `⑤ aR_scale 進得去 forearm_r 骨(峰值 ${S.fa})`);
ok(S.hd < 1.01, `⑤ hand_r 是子骨、不重複縮(${S.hd};重複縮=s² 爆手)`);
await pS.close();

// ---- ① VRM(VRoid)命名 ----
const pV = await openPage(buildSkinGlb('vrm'), '');
const V = await pV.evaluate(PROBE);
ok(V.boneCount === 16 && V.bones.join(',') === NATIVE_BONES, `① VRM(J_Bip_*)命名也收滿 16 骨(${V.boneCount};修前 8)`);
ok(V.deform > 0.05, `① VRM 命名同樣驅動得動(${V.deform})`);
await pV.close();

// ---- ⑥ 預設剛體角色不受影響 ----
const pR = await openPage(null, '');
const R = await pR.evaluate(PROBE);
ok(R.boneCount === 16, `⑥ 剛體 base-avatar 仍收滿 16 骨(${R.boneCount})`);
ok(R.skinned[0] === false && R.hasSkin[0] === false, '⑥ 剛體角色不被誤判成蒙皮');
ok(R.handMeshes > 0, `⑥ 剛體仍走「骨頭下掛網格」那條路(hand_r 網格 ${R.handMeshes})`);
ok(Math.abs(R.cx - R.fx) < 20 && Math.abs(R.cz - R.fy) < 20, `⑥ 剛體渲染定位不變(${R.cx},${R.cz})`);
await pR.close();

// ---- ⑧ rest 姿勢正規化(ugc-1b):A-pose 角色也能用 ----
// 重定向的基準線是角色自己的 rest(目標世界 = Δ · bQT)——rest 偏了,每個姿勢都帶著這個偏差。
// VRoid/多數 DCC 出廠是 A-pose(手臂往下 45°)=所有動作手臂都低 45°。
const restOf = (page) => page.evaluate(() => {
  const av = window.__avatars[0], p = new THREE.Vector3(), q = new THREE.Vector3();
  av.by.upperarm_r.bone.getWorldPosition(p); av.by.forearm_r.bone.getWorldPosition(q);
  return { fix: av.tposeFix, dev: av.restDevDeg, resid: av.restResidDeg,
           dir: q.sub(p).normalize().toArray().map(n => +n.toFixed(2)) };
});
const pT = await openPage(buildSkinGlb('native'), '&tpose=1');       const T = await restOf(pT); await pT.close();
const pAoff = await openPage(buildSkinGlb('native-apose'), '&tpose=0'); const Aoff = await restOf(pAoff); await pAoff.close();
const pAon = await openPage(buildSkinGlb('native-apose'), '&tpose=1');  const Aon = await restOf(pAon); await pAon.close();
ok(Aoff.dev >= 40 && Aoff.resid === Aoff.dev, `⑧ A-pose 未校正=偏離留著(${Aoff.dev}°)`);
ok(Aon.dev >= 40 && Aon.resid <= 1, `⑧ A-pose 開校正→殘差歸零(${Aon.dev}° → ${Aon.resid}°)`);
// ⚠ 比**夾角**不比逐分量:兩個角色在各自的分頁裡跑,idle 呼吸相位不同 → 同名幀的姿勢本來就差幾度
//(實測抖動 ~4°,而沒校正的病徵是 45°)。逐分量 0.05 的門檻抓得到抖動=假 FAIL,夾角 15° 才是有鑑別力的線。
const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0]*v[0] + u[1]*v[1] + u[2]*v[2]))) * 180 / Math.PI;
ok(ang(Aon.dir, T.dir) < 15,
  `⑧ 校正後 A-pose 骨頭方向 = T-pose 版(夾角 ${ang(Aon.dir, T.dir).toFixed(1)}°)`);
ok(ang(Aoff.dir, T.dir) > 25, `⑧ 反證:未校正時方向明顯不同(夾角 ${ang(Aoff.dir, T.dir).toFixed(1)}°)`);
// 內建角色預設不校正(手臂已在 2~5° 內、腿刻意外八 13°,硬拉直=改掉正式角色站姿)
const pB = await openPage(null, ''); const Bi = await restOf(pB); await pB.close();
ok(Bi.fix === false && Bi.resid === Bi.dev, `⑧ 內建 base-avatar 預設**不**校正(dev ${Bi.dev}° = resid ${Bi.resid}°)`);

// ---- ⑨ 比例正規化(ugc-1c):匯入角色壓成 chibi 骨架比例 ----
// 使用者拍板:「維持 chibi 風格,其他 GLB 只是外觀套進來——原本的大頭就是大頭」。
// ⚠ 量身高/腳底**不能用 Box3.setFromObject**:它拿 geometry bbox × mesh.matrixWorld,而 SkinnedMesh 的
//   matrixWorld 不隨骨頭動 → 對蒙皮永遠回傳 bind pose。比例改完後這個誤差讓角色腳浮空 14px(身高 18%)。
const realBox = (page) => page.evaluate(() => {
  const av = window.__avatars[0], box = new THREE.Box3(), v = new THREE.Vector3();
  av.wrap.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if (!P) return;
    const step = Math.max(1, Math.floor(P.count / 200));
    for (let i = 0; i < P.count; i += step) {
      v.set(P.getX(i), P.getY(i), P.getZ(i));
      if (o.isSkinnedMesh) o.boneTransform(i, v);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  return { minY: +box.min.y.toFixed(1), h: +(box.max.y - box.min.y).toFixed(1),
           chibiFit: av.chibiFit, before: av.headsBefore, after: av.headsAfter,
           standH: +av.standH.toFixed(1), soleOffset: av.soleOffset,
           rootBone: av.by.root ? av.by.root.bone.name : null };
});

const pC = await openPage(buildSkinGlb('native'), '&chibi=1');  const C = await realBox(pC); await pC.close();
const pC0 = await openPage(buildSkinGlb('native'), '&chibi=0'); const C0 = await realBox(pC0); await pC0.close();
const pCB = await openPage(null, '');                        const CB = await realBox(pCB); await pCB.close();

ok(C.chibiFit === true && C.before != null, `⑨ 匯入角色預設套比例正規化(修前頭身比 ${C.before})`);
ok(C.after > 2.4 && C.after < 4.2, `⑨ 壓到 chibi 頭身比(${C.before} → ${C.after};內建基底 ${CB.after})`);
ok(C.after < C.before, `⑨ 確實變矮胖(${C.before} → ${C.after})`);
ok(Math.abs(C.minY) < 3, `⑨ **真實蒙皮腳底貼地** minY=${C.minY}(修前浮空 14;setFromObject 量不到蒙皮形變)`);
ok(C.soleOffset != null, `⑨ 蒙皮走**腳骨推算**踩地(soleOffset=${C.soleOffset});bind pose 包圍盒不隨姿勢動,拿它量會浮空`);
ok(C0.chibiFit === false && C0.before === null, '⑨ ?chibi=0 可關掉(不做比例正規化)');
ok(CB.chibiFit === false, `⑨ 內建 base-avatar 不套(它本身就是比例基準,頭身比 ${CB.after})`);
// ⚠ 門檻 4px(~5%):standH 在 buildAvatar 當下量,box rig 的校正姿勢隨載入時機有 ±2px 抖動
//(CONC=3 實測 75.4 vs 77.5 假 FAIL;沒正規化的病徵是差一個量級的比例,4px 仍有鑑別力)。
ok(Math.abs(C.standH - CB.standH) < 4,
  `⑨ 站高與內建一致(${C.standH} vs ${CB.standH})——使用者要求「大小跟高度跟原本角色一致」`);
ok(C.rootBone === CB.rootBone || /hips|root/i.test(C.rootBone || ''),
  `⑨ root 取到真正的髖骨(${C.rootBone});VRoid 同時有腳底的 Root 與 J_Bip_C_Hips,取錯 root_x 會繞腳踝甩全身`);

// ---- ⑩ 蒙皮版骨局部 bbox(ugc-2b):剛體分件的消費者不能靠 `by[k].meshes`(蒙皮恆空)----
// 病 3 的第四次:火帽拿不到頭部尺寸就 `return false` → 退回 box rig headPivot(隱形 driver)=
// 帽子掛到脖子上。actor-avatar 從 skin weight 反推 bind pose 骨局部 bbox 補上。
const pH = await openPage(buildSkinGlb('native'), '&chibi=1');
const H = await pH.evaluate(async () => {
  const v = __v2, a = v.fighters[0];
  v.v2s.introT = 0; a.item = 'fire'; a.itemUses = 9;
  await new Promise(r => setTimeout(r, 900));
  const av = window.__avatars[0];
  let g = null, scene = av.wrap; while (scene.parent) scene = scene.parent;
  scene.traverse(o => { if (o.userData && o.userData.avatar === av) g = o; });
  const hb = av.by.head.localBox, hd = av.by.head.localBoxDeep;
  const sz = b => { if (!b || b.isEmpty()) return null; const s = new THREE.Vector3(); b.getSize(s); return +s.y.toFixed(3); };
  return { headMeshes: (av.by.head.meshes || []).length, hatOnAvatar: !!(g && g.userData.hatOnAvatar),
           exactH: sz(hb), deepH: sz(hd), handBox: !!av.by.hand_r.localBox, handRig: !!av.handRig };
});
await pH.close();
ok(H.headMeshes === 0, `⑩ 蒙皮角色 by.head.meshes 確實是空的(${H.headMeshes})——剛體那條路對它無效`);
ok(H.exactH > 0, `⑩ localBox(exact:主導骨=head)量到頭部高度 ${H.exactH}`);
ok(H.deepH >= H.exactH, `⑩ localBoxDeep(含頭髮等未對照子骨)≥ exact(${H.deepH} ≥ ${H.exactH})`);
ok(H.handBox, '⑩ 其他骨頭也有 localBox(手骨,X光/裝備可用)');
ok(H.hatOnAvatar === true, '⑩ **火帽掛在 avatar 頭骨上**(修前=false → 退回 box rig,帽子在脖子)');
// ⑪ 紫色手(ugc-2c,使用者反饋「扛人時手是紫色的」):rigged 手是另一顆 chibi 手 GLB、帶自己的膚色,
// 存在的理由是 base-avatar 的手是沒手指的色塊。蒙皮角色本身有帶指骨的手 → **不換手模**。
ok(H.handRig === false, '⑪ 蒙皮角色**不掛 rigged 手**(用自己的手;換上去=不同膚色的手黏在手腕)');
ok(R.handRig === true, `⑪ 剛體 base-avatar 照舊掛 rigged 手(${R.handRig};它的手本來就沒手指)`);

ok(errs.length === 0, '⑦ 無 console 錯誤' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));

await B.close();
console.log(`\n== skinrig ${pass}/${pass + fail} ==`);
process.exit(fail ? 1 : 0);
