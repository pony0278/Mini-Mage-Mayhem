// punch-studio — slim:匯出遊戲角色檔(瘦身;ugc-2)
// 古典 script(非 module):與其他 ps/*.js 共享全域;載於 avatar.js 之後(要用它的 AVATAR_LAST_* / loadAvatarBuffer)。
//
// 為什麼:玩家角色檔(VRoid → GLB)實測 18.21MB、遊戲開機 16s——61% 是貼圖(含 1.79MB 只有 VRM 選單
// 用的 thumbnail)、外加 399 個遊戲不驅動的 morph target(表情)與 VRM extension。瘦身在匯入實驗室做
// 一次,玩家存下「遊戲角色檔」,之後遊戲載的永遠是小檔。這裡也是未來「上傳規範」的把關點(同一個出口)。
//
// 做法=**GLB 原地空殼化(不重排索引)**:
//   ① JSON 層 delete:morph target(mesh.primitives[].targets/weights)、animations、VRM 系 extension
//   ② 貼圖:material 有引用的 → createImageBitmap 縮到 ≤SLIM_MAX_TEX、**一律重編成 PNG**
//      (JPEG 禁用:SwiftShader 上傳 YUV 底的 JPEG ImageBitmap 會全黑,見 slimEncodeImage 注解);
//      **沒被引用的(VRM thumbnail)→ 換成 1×1 PNG**
//   ③ 重寫 BIN:只抄「仍被引用的 accessor 的 bufferView + 新貼圖」;孤兒 view 縮成 4-byte 空殼。
//      **所有陣列長度與索引都不動、零重排**——GLTFLoader 是惰性載入(accessor/bufferView 只有被
//      primitive/skin/image 引用才會讀),沒人引用的空殼條目永遠不會被碰。這比「完整 prune+重排索引」
//      少一個量級的程式碼與出錯面。
// 安全網:UI 按鈕瘦完會自動把瘦身檔**載回實驗室**(跟遊戲同一條 loader 路)驗證,失敗=保留原檔+報錯。
// Draco / KTX2(basisu)/ meshopt 壓縮檔直接拒絕——遊戲的裸 GLTFLoader 本來就讀不了。

const SLIM_MAX_TEX = 512;      // 貼圖最長邊(角色在遊戲裡 ~78px 高、頭像快照 96px,512 已很寬裕)

function slimParseGlb(ab) {
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('不是 GLB(magic 不符)');
  const total = dv.getUint32(8, true);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    const data = new Uint8Array(ab, off + 8, clen);
    if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data));
    else if (ctype === 0x004E4942) bin = data;
    off += 8 + clen;
  }
  if (!json || !bin) throw new Error('GLB 缺 JSON/BIN chunk');
  return { json, bin };
}

function slimWriteGlb(json, bin) {
  const js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - js.length % 4) % 4, bpad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + js.length + jpad + 8 + bin.length + bpad;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  let o = 12;
  dv.setUint32(o, js.length + jpad, true); dv.setUint32(o + 4, 0x4E4F534A, true); o += 8;
  out.set(js, o); for (let i = 0; i < jpad; i++) out[o + js.length + i] = 0x20; o += js.length + jpad;
  dv.setUint32(o, bin.length + bpad, true); dv.setUint32(o + 4, 0x004E4942, true); o += 8;
  out.set(bin, o);                             // bpad 留 0(Uint8Array 預設值)
  return out.buffer;
}

async function slimOnePixel() {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// 縮圖。回傳 {bytes, mime};縮完反而更大且沒縮尺寸 → 保留原檔。
// ⚠ **一律輸出 PNG,絕不輸出 JPEG**(2026-07-30 實測踩到):Chrome 把 JPEG 解成 YUV 底的 ImageBitmap,
// 2D canvas 取樣會軟體轉 RGB(顏色全對),但 SwiftShader 的 WebGL 上傳把它變**全零=貼圖全黑**。
// readRenderTargetPixels 逐張量化:黑的 6/6 全是 JPEG、好的 9/9 全是 PNG,規律無一例外。
// 真 GPU 大多沒事,但我們的 headless 驗收全在 SwiftShader 上,而低階裝置也可能走軟體路——PNG 貴一點但到處能用。
async function slimEncodeImage(bytes, mime, maxTex) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }));
  const scale = Math.min(1, maxTex / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const out = new Uint8Array(await blob.arrayBuffer());
  // 沒縮尺寸且沒變小 → 保留原 PNG;原檔是 JPEG 的照樣換成 PNG(不然黑貼圖問題原封不動)
  if (out.length >= bytes.length && scale === 1 && (mime || '') !== 'image/jpeg')
    return { bytes: new Uint8Array(bytes), mime: mime || 'image/png' };
  return { bytes: out, mime: 'image/png' };
}

async function slimAvatarGlb(ab, opts) {
  const maxTex = (opts && opts.maxTex) || SLIM_MAX_TEX;
  const { json: g, bin } = slimParseGlb(ab);
  const stats = { before: ab.byteLength, morphs: 0, thumbs: 0, texBefore: 0, texAfter: 0 };

  // 壓縮擴充=遊戲的裸 GLTFLoader 讀不了(studio 有 DRACOLoader 所以載得進來,別讓人誤會能用)
  const banned = (g.extensionsUsed || []).filter(k => /draco|basisu|meshopt/i.test(k));
  if (banned.length) throw new Error(`含壓縮擴充 ${banned.join('/')}(遊戲讀不了)——請由 Blender 以未壓縮 GLB 重新匯出`);

  // ① 拔 morph target(遊戲不驅動表情)/ 動畫(遊戲用 box rig 重定向,不播 GLB 動畫)/ VRM 系 extension
  (g.meshes || []).forEach(m => {
    delete m.weights;
    if (m.extras) delete m.extras.targetNames;
    (m.primitives || []).forEach(p => { if (p.targets) { stats.morphs += p.targets.length; delete p.targets; } });
  });
  (g.nodes || []).forEach(n => { delete n.weights; });
  delete g.animations;
  for (const key of ['extensions', 'extensionsUsed', 'extensionsRequired']) {
    if (!g[key]) continue;
    if (Array.isArray(g[key])) g[key] = g[key].filter(k => !/^VRM/i.test(k));
    else Object.keys(g[key]).forEach(k => { if (/^VRM/i.test(k)) delete g[key][k]; });
    if (!Object.keys(g[key]).length) delete g[key];    // KHR_materials_unlit/KHR_texture_transform 留著(外觀要一致)
  }

  // ② 貼圖:material 引用鏈(material → texture → image)以外的 image = 孤兒(VRM thumbnail)→ 1×1
  const usedTex = new Set();
  const walkTex = (obj) => { if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') {
        if (/Texture$/i.test(k) && typeof v.index === 'number') usedTex.add(v.index);
        walkTex(v);
      }
    } };
  (g.materials || []).forEach(walkTex);
  const usedImg = new Set();
  usedTex.forEach(ti => { const t = (g.textures || [])[ti]; if (t && t.source != null) usedImg.add(t.source); });

  const onePx = await slimOnePixel();
  const imgs = g.images || [];
  const newImg = {};                                   // imageIndex → {bytes, mime}
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i];
    if (im.bufferView == null) continue;               // uri 圖:不動(view 不存在,不進重寫)
    const bv = g.bufferViews[im.bufferView];
    stats.texBefore += bv.byteLength;
    if (!usedImg.has(i)) { newImg[i] = { bytes: onePx, mime: 'image/png' }; stats.thumbs++; stats.texAfter += onePx.length; continue; }
    try {
      const src = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const r = await slimEncodeImage(src, im.mimeType, maxTex);
      newImg[i] = r; stats.texAfter += r.bytes.length;
    } catch (e) { stats.texAfter += bv.byteLength; }   // 解不開=原樣照抄(下面 keepImgView)
  }

  // ③ 重寫 BIN:仍被引用的 accessor(attributes/indices/skin IBM;targets 已刪=morph accessor 全成孤兒)
  const usedAcc = new Set();
  (g.meshes || []).forEach(m => (m.primitives || []).forEach(p => {
    Object.values(p.attributes || {}).forEach(a => usedAcc.add(a));
    if (p.indices != null) usedAcc.add(p.indices);
  }));
  (g.skins || []).forEach(s => { if (s.inverseBindMatrices != null) usedAcc.add(s.inverseBindMatrices); });
  const usedView = new Set();
  usedAcc.forEach(ai => { const a = (g.accessors || [])[ai]; if (!a) return;
    if (a.bufferView != null) usedView.add(a.bufferView);
    if (a.sparse) {
      if (a.sparse.indices && a.sparse.indices.bufferView != null) usedView.add(a.sparse.indices.bufferView);
      if (a.sparse.values && a.sparse.values.bufferView != null) usedView.add(a.sparse.values.bufferView);
    } });
  const imgViewOf = {};                                // viewIndex → imageIndex(有新 bytes 的)
  Object.keys(newImg).forEach(i => { imgViewOf[imgs[i].bufferView] = +i; });
  const keepImgView = new Set();                       // 沒產出新 bytes 的 image(解碼失敗)→ 原樣照抄
  imgs.forEach((im, i) => { if (im.bufferView != null && newImg[i] === undefined) keepImgView.add(im.bufferView); });

  const parts = []; let off = 0;
  const push = u8 => { parts.push(u8); off += u8.length; };
  const align = () => { const p = (4 - off % 4) % 4; if (p) push(new Uint8Array(p)); };
  (g.bufferViews || []).forEach((bv, vi) => {
    if (imgViewOf[vi] !== undefined) {
      const r = newImg[imgViewOf[vi]];
      align(); bv.byteOffset = off; bv.byteLength = r.bytes.length; delete bv.byteStride;
      imgs[imgViewOf[vi]].mimeType = r.mime;
      push(r.bytes);
    } else if (usedView.has(vi) || keepImgView.has(vi)) {
      align();
      const src = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      bv.byteOffset = off; push(src);
    } else {
      bv.byteOffset = 0; bv.byteLength = 4; delete bv.byteStride;   // 孤兒空殼:惰性載入下永遠沒人讀
    }
  });
  const bin2 = new Uint8Array(off); let c = 0; for (const p of parts) { bin2.set(p, c); c += p.length; }
  g.buffers = [{ byteLength: bin2.length }];
  if (g.asset) g.asset.generator = ((g.asset.generator || '') + ' +mmm-slim').trim();

  const glb = slimWriteGlb(g, bin2);
  stats.after = glb.byteLength;
  return { glb, stats };
}

// ===== UI:匯出鈕(插在匯入檢查報告下方)=====
(function () {
  const rep = document.getElementById('avatarReport'); if (!rep) return;
  const row = document.createElement('div'); row.className = 'util'; row.style.marginTop = '4px';
  row.innerHTML =
    `<button id="slimExport" title="拔 morph target/動畫/VRM 縮圖、貼圖縮到 ≤${SLIM_MAX_TEX} PNG(不轉 JPEG:軟體渲染上傳會全黑),存成遊戲用的小角色檔。瘦完會自動載回驗證,失敗保留原檔">⬇ 匯出遊戲角色檔(瘦身)</button>` +
    `<span id="slimStatus" style="font-size:10px;color:var(--dim)"></span>`;
  rep.parentElement.insertBefore(row, rep.nextSibling);
  document.getElementById('slimExport').addEventListener('click', async () => {
    const st = document.getElementById('slimStatus');
    if (typeof AVATAR_LAST_BUF === 'undefined' || !AVATAR_LAST_BUF) { st.textContent = '先載入角色再匯出。'; return; }
    st.textContent = '瘦身中…';
    try {
      const { glb, stats } = await slimAvatarGlb(AVATAR_LAST_BUF.slice(0));
      const name = (AVATAR_LAST_LABEL || 'avatar').replace(/\.(glb|gltf|vrm)$/i, '') + '-slim.glb';
      // 安全網:載回實驗室(= 遊戲同一條 loader 路)驗證;失敗就不給檔
      const okBack = await loadAvatarBuffer(glb.slice(0), name, AVATAR_LAST_BUILTIN);
      if (!okBack) throw new Error('瘦身檔載回失敗(原檔未動)');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const mb = n => (n / 1048576).toFixed(2);
      st.textContent = `${mb(stats.before)}MB → ${mb(stats.after)}MB(拔 ${stats.morphs} 個 morph、${stats.thumbs} 張孤兒縮圖;貼圖 ${mb(stats.texBefore)}→${mb(stats.texAfter)}MB)。已下載 ${name}`;
    } catch (e) {
      console.error(e);
      st.textContent = '瘦身失敗:' + (e.message || e);
    }
  });
  // headless 健檢入口(__ps 屬於 game-bridge;比照 __psEquip/__psAvatar 用自己的命名空間)
  window.__psSlim = { slim: slimAvatarGlb, parse: slimParseGlb, write: slimWriteGlb };
})();
