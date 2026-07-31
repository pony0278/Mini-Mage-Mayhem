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
// ⚠ 火帽 GLB 是 async fetch 的,**不能用固定 sleep 等**:CONC=3 下載入變慢,900ms 到期時帽子還沒掛
//(實測 ugc-2d 全跑時這條假 FAIL,單跑 41/41 全綠)。改成輪詢條件、上限 25s。
await pH.evaluate(() => { const v = __v2, a = v.fighters[0];
  v.v2s.introT = 0; a.item = 'fire'; a.itemUses = 9; });
const gOf = () => {                                  // 取 fighter 的渲染 group(userData.avatar 指回 av)
  const av = window.__avatars[0]; let g = null, scene = av.wrap;
  while (scene.parent) scene = scene.parent;
  scene.traverse(o => { if (o.userData && o.userData.avatar === av) g = o; });
  return g;
};
await pH.waitForFunction(`(${gOf.toString()})()?.userData?.hatOnAvatar === true`, { timeout: 25000 })
  .catch(() => { /* 留給下面的斷言報失敗,別在這裡炸掉整支 */ });
await pH.waitForFunction('window.__avatars[0].handRig', { timeout: 25000 })   // rigged 手 async 載入(8b 陷阱:別用固定 sleep)
  .catch(() => { /* 同上 */ });
const H = await pH.evaluate((src) => {
  const av = window.__avatars[0];
  const g = new Function('return (' + src + ')()')();
  const hb = av.by.head.localBox, hd = av.by.head.localBoxDeep;
  const sz = b => { if (!b || b.isEmpty()) return null; const s = new THREE.Vector3(); b.getSize(s); return +s.y.toFixed(3); };
  // ⑪ 拳套模式(ugc-3):拳套 wrap 的世界朝向要 = base 戴法(Δ·wrapQT·GLOVE_REST);跟腕的 box driver
  // 節點世界朝向差一個常數 offset,兩隻手各自量「wrap 世界四元數 vs 腕節點世界四元數」的夾角應該
  // 左右**相等**(同一個 rig 常數)——掛錯基準(qT / GLB 陳列朝向,都踩過)左右會不對稱或差 180°。
  let glove = null;
  if (av.handRig && av.gloveMode) {
    const T = window.THREE, q1 = new T.Quaternion(), q2 = new T.Quaternion();
    const ang = (slot, side) => { av.handWraps[side].getWorldQuaternion(q1);
      av.by[slot].node().getWorldQuaternion(q2);
      return +(2 * Math.acos(Math.min(1, Math.abs(q1.dot(q2)))) * 180 / Math.PI).toFixed(1); };
    const s = new T.Vector3(); new T.Box3().setFromObject(av.handWraps.L).getSize(s);
    glove = { showing: av.handShowingRigged, offL: ang('hand_l', 'L'), offR: ang('hand_r', 'R'),
              worldMax: +Math.max(s.x, s.y, s.z).toFixed(1), standH: av.standH };
  }
  return { headMeshes: (av.by.head.meshes || []).length, hatOnAvatar: !!(g && g.userData.hatOnAvatar),
           exactH: sz(hb), deepH: sz(hd), handBox: !!av.by.hand_r.localBox, handRig: !!av.handRig,
           gloveMode: !!av.gloveMode, glove };
}, gOf.toString());
await pH.close();
ok(H.headMeshes === 0, `⑩ 蒙皮角色 by.head.meshes 確實是空的(${H.headMeshes})——剛體那條路對它無效`);
ok(H.exactH > 0, `⑩ localBox(exact:主導骨=head)量到頭部高度 ${H.exactH}`);
ok(H.deepH >= H.exactH, `⑩ localBoxDeep(含頭髮等未對照子骨)≥ exact(${H.deepH} ≥ ${H.exactH})`);
ok(H.handBox, '⑩ 其他骨頭也有 localBox(手骨,X光/裝備可用)');
ok(H.hatOnAvatar === true, '⑩ **火帽掛在 avatar 頭骨上**(修前=false → 退回 box rig,帽子在脖子)');
// ⑪ 拳套(ugc-3,使用者:「現在不是拳套了,有什麼辦法讓皮套在拳套嗎?」):蒙皮角色=**常戴拳套模式**
// (rigged 手當拳套裝備永遠顯示、罩住自己的手;ugc-2c 的紫色手=「扛人才換手」的突兀,常戴後不存在)。
// 剛體 base-avatar 照舊(平時原生色塊拳套,抓握才換 rigged 手)。
ok(H.handRig === true && H.gloveMode === true && H.glove && H.glove.showing === true,
  '⑪ 蒙皮角色掛 rigged 手=**常戴拳套**(gloveMode,永遠顯示)');
ok(H.glove && Math.abs(H.glove.offL - H.glove.offR) < 1,
  `⑪ 拳套朝向=base 戴法(vs 腕 driver 的常數 offset 左右對稱:L ${H.glove && H.glove.offL}° ≈ R ${H.glove && H.glove.offR}°)`);
ok(H.glove && H.glove.worldMax > 0.15 * H.glove.standH && H.glove.worldMax < 0.45 * H.glove.standH,
  `⑪ 拳套尺寸照身高佔比(最長邊 ${H.glove && H.glove.worldMax}px,standH ${H.glove && H.glove.standH})——不跟角色細手走,拳套感才在`);
ok(R.handRig === true, `⑪ 剛體 base-avatar 照舊掛 rigged 手(${R.handRig};平時藏、抓握才顯)`);

// ---- ⑫ 頭要坐在脖子上(ugc-2d;使用者反饋「人物的頭身腿是不是都不在同一面上」)----
// 舊 ③ 只拿「頭骨關節**以上**」的高度算放大倍率、繞關節原點縮放。內建 base-avatar 的頭幾乎整顆在關節
// 之上(下巴只低 1.5%身高)所以看不出問題;**真人骨架的 head 骨在顱底、下巴在它下面** → 放大 2.7×
// 連下巴一起往下拉 2.7 倍,實測 VRoid 下巴沉到脖子關節下 3.2%身高、整顆頭陷進胸口。
// 修法=改解兩條件(頭頂到 headTop、下巴停在 jawDrop),倍率照整顆頭高算,再把頭骨抬回去。
// 另外補上軀幹長度(root→neck):匯入角色是寫實 7~8 頭身,軀幹佔比比 chibi 短(VRoid 23.3% vs 30.4%)。
const propOf = (page) => page.evaluate(() => {
  const av = window.__avatars[0], T = window.THREE;
  const hbone = av.by.head.bone;
  const inHead = (b) => { for (let o = b; o; o = o.parent) if (o === hbone) return true; return false; };
  const all = new T.Box3(), head = new T.Box3(), v = new T.Vector3();
  av.wrap.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if (!P) return;
    const step = Math.max(1, Math.floor(P.count / 2000));
    const SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
    for (let i = 0; i < P.count; i += step) {
      let hit = false;
      if (o.isSkinnedMesh && SI && SW) {
        let bi = SI.getX(i), bw = SW.getX(i);
        for (const [ix, w] of [[SI.getY(i), SW.getY(i)], [SI.getZ(i), SW.getZ(i)], [SI.getW(i), SW.getW(i)]])
          if (w > bw) { bw = w; bi = ix; }
        const b = o.skeleton.bones[bi]; hit = !!b && inHead(b);
      } else hit = inHead(o);
      v.set(P.getX(i), P.getY(i), P.getZ(i));
      if (o.isSkinnedMesh) o.boneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      all.expandByPoint(v); if (hit) head.expandByPoint(v);
    }
  });
  const H = all.max.y - all.min.y, pct = (n) => +(n / H * 100).toFixed(1);
  const wy = (k) => { const e = av.by[k]; if (!e) return null;
    e.bone.updateWorldMatrix(true, false); return e.bone.getWorldPosition(new T.Vector3()).y; };
  // 正數 = 下巴在脖子關節**之上**(正常);負數 = 下巴陷進胸口
  return { jawAboveNeck: pct(head.min.y - wy('neck')), torso: pct(wy('neck') - wy('root')),
           headH: pct(head.max.y - head.min.y), heads: av.headsAfter };
});
const pD = await openPage(buildSkinGlb('native'), '&chibi=1');  const D = await propOf(pD);  await pD.close();
const pD0 = await openPage(buildSkinGlb('native'), '&chibi=0'); const D0 = await propOf(pD0); await pD0.close();
const pDB = await openPage(null, '');                          const DB = await propOf(pDB); await pDB.close();
ok(D.jawAboveNeck > -1,
  `⑫ 下巴不再陷進胸口(下巴高於脖子關節 ${D.jawAboveNeck}%身高;內建基底 ${DB.jawAboveNeck}%)`);
ok(D.jawAboveNeck > D0.jawAboveNeck - 40 && D.headH > D0.headH * 1.5,
  `⑫ 頭還是放大成 chibi 大頭(頭高 ${D0.headH}% → ${D.headH}%)——修的是位置不是取消放大`);
ok(Math.abs(D.torso - 30.4) < 6,
  `⑫ 軀幹長度壓到 chibi 目標 30.4%(實測 ${D.torso}%;修前 ${D0.torso}%,內建 ${DB.torso}%)`);
// 頭身比改量真頭高(下巴→頭頂):舊定義「頭頂−頭骨關節」在頭骨被抬起後低估頭高、把數字吹高
ok(Math.abs(D.heads - DB.heads) < 0.6,
  `⑫ 頭身比貼齊內建基底(${D.heads} vs ${DB.heads};舊定義下會報 3.85)`);

// ---- ⑬ rest yaw 正規化(ugc-2e;使用者截圖「面向箭頭朝左、人朝右」)----
// 慣例=rest 面向 +Z,VRM0/VRoid 出廠面向 −Z → bQT 把反向烤進基準線=整隻反 180° 而且左右鏡像;
// normalizeRest 看不見 yaw(只對齊骨→子骨方向:脊椎/腿垂直、T-pose 手臂左右橫,繞垂直軸轉 180° 全不變,
// 左右判定又是世界 X ——轉了以後照樣「各就各位」)→ 零殘差、零警告,靜默反向。修法=量腳尖 rest 朝向
//(fixture 的腳因此有前伸腳尖盒),貼齊 90° 檔位轉回 +Z,**再重收骨頭**(左右重判)。
const yawOf = (page) => page.evaluate(() => {
  const av = window.__avatars[0], T = window.THREE, f = __v2.fighters[0];
  av.wrap.updateMatrixWorld(true);
  const fx = Math.cos(f.facing), fz = Math.sin(f.facing);
  const bones = [av.by.foot_l, av.by.foot_r].filter(Boolean).map(e => e.bone);
  const inSet = (b) => { for (let o = b; o; o = o.parent) if (bones.includes(o)) return true; return false; };
  const bc = new T.Vector3(), v = new T.Vector3();
  bones.forEach(b => { b.getWorldPosition(v); bc.add(v); }); bc.multiplyScalar(1 / bones.length);
  let fwd = -1e9, back = -1e9;
  av.wrap.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const P = o.geometry.attributes.position, SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
    for (let i = 0; i < P.count; i += 2) {
      let bi = SI.getX(i), bw = SW.getX(i);
      for (const [ix, w] of [[SI.getY(i), SW.getY(i)], [SI.getZ(i), SW.getZ(i)], [SI.getW(i), SW.getW(i)]])
        if (w > bw) { bw = w; bi = ix; }
      const b = o.skeleton.bones[bi]; if (!b || !inSet(b)) continue;
      v.fromBufferAttribute(P, i); o.boneTransform(i, v); v.applyMatrix4(o.matrixWorld).sub(bc);
      const p = v.x * fx + v.z * fz;                          // 沿 facing 的分量
      fwd = Math.max(fwd, p); back = Math.max(back, -p);
    }
  });
  return { yawFix: av.yawFixDeg, fwd: +fwd.toFixed(1), back: +back.toFixed(1),
           uarmL: av.by.upperarm_l ? av.by.upperarm_l.bone.name : null, bones: Object.keys(av.by).length };
});
const pY0 = await openPage(buildSkinGlb('native'), '&chibi=1');        const Y0 = await yawOf(pY0); await pY0.close();
const pY1 = await openPage(buildSkinGlb('native-yaw180'), '&chibi=1'); const Y1 = await yawOf(pY1); await pY1.close();
ok(Y0.yawFix === 0, `⑬ 慣例合規(rest 面向 +Z)的角色不動(yawFix=${Y0.yawFix})`);
ok(Y1.yawFix === 180, `⑬ 反著擺的骨架(VRM0 慣例)量到 180° 並修正(yawFix=${Y1.yawFix})`);
ok(Y1.fwd > Y1.back, `⑬ 修正後腳尖朝 facing(前伸 ${Y1.fwd} > 後伸 ${Y1.back};修前=倒過來)`);
ok(Y1.uarmL === Y0.uarmL && Y1.bones === Y0.bones,
  `⑬ 轉完**重收骨頭**=左右重判(upperarm_l=${Y1.uarmL} 同 native;${Y1.bones} 骨)——沒重收就是左右鏡像`);

// ---- ⑭ 肢段粗細(ugc-4):conform 只做長度,粗細烤進蒙皮頂點(白針腿修正)----
// fixture 的肢是 0.15 見方的細盒(≈8%身高)→ 小腿目標 19.9% = 係數 ~2.4。
// ⚠ 兩個 fighter 的 clone **共用 position attribute** → 只能烤一次;f0 的 thickRep 有真係數、
// f1 重量到的是已加粗的幾何(係數≈1)= 單烤不重烤的簽名。多 primitive 共用 attribute 同理。
const thickOf = (page) => page.evaluate(() => {
  const T = window.THREE, out = {};
  // ⚠ 量 **bind 骨局部**不量世界盒:idle 姿勢小腿是斜的,肢段長度會投影進世界橫向(實測把 8% 吹成
  //   17%),加粗前後的比值被稀釋成假 FAIL。bind 空間無姿勢,橫截乾淨。
  const meas = (av) => {
    const bone = av.by.shin_l.bone;
    const bb = new T.Box3(), v = new T.Vector3();
    av.wrap.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const bi0 = o.skeleton.bones.indexOf(bone); if (bi0 < 0) return;
      const m = new T.Matrix4().multiplyMatrices(o.skeleton.boneInverses[bi0], o.bindMatrix);
      const P = o.geometry.attributes.position, SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
      const step = Math.max(1, Math.floor(P.count / 4000));
      for (let i = 0; i < P.count; i += step) {
        let bi = SI.getX(i), bw = SW.getX(i);
        for (const [ix, w] of [[SI.getY(i), SW.getY(i)], [SI.getZ(i), SW.getZ(i)], [SI.getW(i), SW.getW(i)]])
          if (w > bw) { bw = w; bi = ix; }
        if (o.skeleton.bones[bi] !== bone) continue;
        v.fromBufferAttribute(P, i).applyMatrix4(m);
        bb.expandByPoint(v);
      }
    });
    const s = new T.Vector3(); bb.getSize(s);
    return +(Math.max(s.x, s.z) / (av.standH / av.S) * 100).toFixed(1);   // ÷檔案身高=橫截佔比
  };
  for (let fi = 0; fi < 2; fi++) { const av = window.__avatars[fi];
    out['f' + fi] = av && av.skinned ? { shinPct: meas(av), rep: av.thickRep && av.thickRep.shin_l } : null; }
  return out;
});
const pTk = await openPage(buildSkinGlb('native'), '&chibi=1');         const Tk = await thickOf(pTk);  await pTk.close();
const pTk0 = await openPage(buildSkinGlb('native'), '&chibi=1&thick=0'); const Tk0 = await thickOf(pTk0); await pTk0.close();
ok(Tk.f0 && Tk.f0.rep > 1.8 && Tk.f0.rep <= 2.5,
  `⑭ 小腿加粗係數落在預期(${Tk.f0 && Tk.f0.rep};目標 19.9%身高,fixture 現況 ~8%)`);
ok(Tk.f0 && Tk0.f0 && Tk.f0.shinPct > Tk0.f0.shinPct * 1.5,
  `⑭ 世界橫截真的變粗(${Tk0.f0 && Tk0.f0.shinPct}% → ${Tk.f0 && Tk.f0.shinPct}%);?thick=0 可關`);
ok(Tk.f1 && Tk.f1.rep < 1.3 && Math.abs(Tk.f1.shinPct - Tk.f0.shinPct) < Tk.f0.shinPct * 0.4,
  `⑭ 共用 attribute 只烤一次(f1 重量到已加粗幾何,係數 ${Tk.f1 && Tk.f1.rep};兩人粗細一致)——重烤=係數連乘頂點飛出去`);

ok(errs.length === 0, '⑦ 無 console 錯誤' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));

await B.close();
console.log(`\n== skinrig ${pass}/${pass + fail} ==`);
process.exit(fail ? 1 : 0);
