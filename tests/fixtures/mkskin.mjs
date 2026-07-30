// tests/fixtures/mkskin.mjs — 產「最小蒙皮人形 GLB」給 skinrig/psslim 套件用(手寫 glTF,不依賴 GLTFExporter)。
// 為什麼不放已編好的 .glb 進 repo:二進位 fixture 看不出改了什麼,而且這裡才是骨名版本的規格書——
// 'native'=遊戲原生命名 / 'vrm'=VRoid·VRM 命名(J_Bip_*),兩份就是別名表(actor-avatar BONE_ALIASES)的驗收對象。
// rest = T-pose(雙臂水平),對齊 actor-avatar 的 tposePose()。每根骨頭一個盒子、頂點 100% 綁該骨
//(測的是管線不是權重平滑度)。

import { deflateSync } from 'node:zlib';

// ── 手寫 PNG(RGBA 8-bit,filter 0)——'-fat' 變體的貼圖用;node:zlib 出 IDAT、自算 CRC32。
function crc32(buf) {
  const t = crc32.t || (crc32.t = (() => { const T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; } return T; })());
  let c = ~0; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}
function makePng(w, h, rgba) {
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunks = [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    chunks.push(len, td, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  chunk('IHDR', ihdr); chunk('IDAT', deflateSync(raw)); chunk('IEND', Buffer.alloc(0));
  return Buffer.concat(chunks);
}
function noiseRgba(w, h, alpha) {   // 雜訊像素=deflate 壓不動 → 貼圖佔真實位元組,瘦身前後大小才有鑑別力
  const b = Buffer.alloc(w * h * 4);
  for (let i = 0; i < b.length; i += 4) { b[i] = Math.random() * 256; b[i + 1] = Math.random() * 256; b[i + 2] = Math.random() * 256; b[i + 3] = alpha; }
  return b;
}

const NAMES = {
  native: { root: 'Root', torso: 'Torso', neck: 'Neck', head: 'Head',
    uarm: s => `UpperArm${s}`, farm: s => `Forearm${s}`, hand: s => `Hand${s}`,
    thigh: s => `Thigh${s}`, shin: s => `Shin${s}`, foot: s => `Foot${s}` },
  // VRoid Studio 匯出的典型命名(VRM humanoid)
  vrm: { root: 'J_Bip_C_Hips', torso: 'J_Bip_C_Spine', neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head',
    uarm: s => `J_Bip_${s}_UpperArm`, farm: s => `J_Bip_${s}_LowerArm`, hand: s => `J_Bip_${s}_Hand`,
    thigh: s => `J_Bip_${s}_UpperLeg`, shin: s => `J_Bip_${s}_LowerLeg`, foot: s => `J_Bip_${s}_Foot` },
};

// 骨頭:名字 + 世界 rest 位置 + 父。單位≈公尺(遊戲會照 bbox 重新縮放)
// apose=true → 雙臂往下 45°(VRoid / 多數 DCC 的出廠姿勢)。用來驗 rest 正規化:
// 重定向的基準線是角色自己的 rest,rest 偏了每個姿勢都帶著偏差,不校正的話所有動作手臂低 45°。
function skeleton(N, apose) {
  const A = apose ? Math.SQRT1_2 : 1, D = apose ? Math.SQRT1_2 : 0;   // 手臂方向:T=沿 X 水平 / A=往下 45°
  return [
    { n: N.root,        w: [0, 0.90, 0], p: -1 },
    { n: N.torso,       w: [0, 1.00, 0], p: 0 },
    { n: N.neck,        w: [0, 1.42, 0], p: 1 },
    { n: N.head,        w: [0, 1.52, 0], p: 2 },
    { n: N.uarm('L'),   w: [0.18, 1.38, 0], p: 1 },
    { n: N.farm('L'),   w: [0.18 + 0.26 * A, 1.38 - 0.26 * D, 0], p: 4 },
    { n: N.hand('L'),   w: [0.18 + 0.48 * A, 1.38 - 0.48 * D, 0], p: 5 },
    { n: N.uarm('R'),   w: [-0.18, 1.38, 0], p: 1 },
    { n: N.farm('R'),   w: [-(0.18 + 0.26 * A), 1.38 - 0.26 * D, 0], p: 7 },
    { n: N.hand('R'),   w: [-(0.18 + 0.48 * A), 1.38 - 0.48 * D, 0], p: 8 },
    { n: N.thigh('L'),  w: [0.09, 0.88, 0], p: 0 },
    { n: N.shin('L'),   w: [0.09, 0.48, 0], p: 10 },
    { n: N.foot('L'),   w: [0.09, 0.08, 0], p: 11 },
    { n: N.thigh('R'),  w: [-0.09, 0.88, 0], p: 0 },
    { n: N.shin('R'),   w: [-0.09, 0.48, 0], p: 13 },
    { n: N.foot('R'),   w: [-0.09, 0.08, 0], p: 14 },
  ];
}

function build(variant) {
  const base = variant.split('-')[0];
  const B = skeleton(NAMES[base], variant.includes('-apose'));
  const fat = variant.includes('-fat');
  const nb = B.length;
  // 每根骨頭一個盒子(頂點 100% 綁該骨)——測的是管線,不是權重平滑度
  const pos = [], joints = [], weights = [], idx = [];
  const half = [0.075, 0.075, 0.075];
  B.forEach((b, i) => {
    // 盒子從本骨延伸到子骨(無子骨=末端小盒)
    const kid = B.find(x => x.p === i);
    const c = kid ? [(b.w[0] + kid.w[0]) / 2, (b.w[1] + kid.w[1]) / 2, (b.w[2] + kid.w[2]) / 2] : b.w.slice();
    const ext = kid ? [Math.max(half[0], Math.abs(kid.w[0] - b.w[0]) / 2), Math.max(half[1], Math.abs(kid.w[1] - b.w[1]) / 2), half[2]] : half;
    const base = pos.length / 3;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      pos.push(c[0] + sx * ext[0], c[1] + sy * ext[1], c[2] + sz * ext[2]);
      joints.push(i, 0, 0, 0); weights.push(1, 0, 0, 0);
    }
    const F = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
    for (const [a, b2, c2, d] of F) idx.push(base+a, base+b2, base+c2, base+a, base+c2, base+d);
  });

  // inverseBindMatrices = rest 世界矩陣的逆(這裡只有平移 → 逆=負平移)
  const ibm = [];
  for (const b of B) ibm.push(1,0,0,0, 0,1,0,0, 0,0,1,0, -b.w[0], -b.w[1], -b.w[2], 1);

  const posA = new Float32Array(pos), jntA = new Uint8Array(joints), wgtA = new Float32Array(weights);
  const idxA = new Uint16Array(idx), ibmA = new Float32Array(ibm);
  const pad4 = n => (4 - (n % 4)) % 4;
  const parts = [posA, jntA, wgtA, idxA, ibmA];
  // '-fat' = 模擬 VRoid 原檔的肥料:3 個 morph target、貼圖 quad(768 不透明 + 256 半透明)、
  // 只被假 VRM extension 引用的 512 thumbnail——psslim 的驗收對象。
  let fatParts = null;
  if (fat) {
    const mk = d => { const a = new Float32Array(posA.length); for (let i = 0; i < a.length; i++) a[i] = d; return a; };
    const qPos = new Float32Array([-0.2, 1.0, 0.3, 0.2, 1.0, 0.3, -0.2, 1.4, 0.3, 0.2, 1.4, 0.3]);
    const qUv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const qIdx = new Uint16Array([0, 1, 2, 2, 1, 3]);
    fatParts = { morphs: [mk(0.05), mk(0.10), mk(0.15)], qPos, qUv, qIdx,
      imgs: [makePng(768, 768, noiseRgba(768, 768, 255)),      // 0 不透明大圖 → 應縮 512 + 轉 JPEG
             makePng(256, 256, noiseRgba(256, 256, 128)),      // 1 半透明 → 應留 PNG(alpha 保住)
             makePng(512, 512, noiseRgba(512, 512, 255))] };   // 2 thumbnail(只被 VRM ext 引用)→ 應空殼成 1×1
    parts.push(...fatParts.morphs, qPos, qUv, qIdx, ...fatParts.imgs.map(b => new Uint8Array(b)));
  }
  const views = []; let off = 0;
  for (const p of parts) { const bl = p.byteLength; views.push({ byteOffset: off, byteLength: bl }); off += bl + pad4(bl); }
  const bin = Buffer.alloc(off);
  parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(bin, views[i].byteOffset));

  // 節點:0..nb-1=骨頭(local 位移),nb=SkinnedMesh 節點
  const nodes = B.map((b, i) => {
    const par = b.p >= 0 ? B[b.p].w : [0, 0, 0];
    const t = [b.w[0] - par[0], b.w[1] - par[1], b.w[2] - par[2]];
    const kids = B.map((x, j) => x.p === i ? j : -1).filter(j => j >= 0);
    const n = { name: b.n, translation: t };
    if (kids.length) n.children = kids;
    return n;
  });
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });

  const gltf = {
    asset: { version: '2.0', generator: 'mmm-skin-probe' },
    scene: 0, scenes: [{ nodes: [0, nb] }],
    nodes,
    meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] }],
    skins: [{ joints: B.map((_, i) => i), inverseBindMatrices: 4, skeleton: 0 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posA.length / 3, type: 'VEC3',
        min: [Math.min(...pos.filter((_, i) => i % 3 === 0)), Math.min(...pos.filter((_, i) => i % 3 === 1)), Math.min(...pos.filter((_, i) => i % 3 === 2))],
        max: [Math.max(...pos.filter((_, i) => i % 3 === 0)), Math.max(...pos.filter((_, i) => i % 3 === 1)), Math.max(...pos.filter((_, i) => i % 3 === 2))] },
      { bufferView: 1, componentType: 5121, count: jntA.length / 4, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: wgtA.length / 4, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: idxA.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: nb, type: 'MAT4' },
    ],
    bufferViews: views.map(v => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength })),
    buffers: [{ byteLength: off }],
  };

  if (fat) {
    // view 索引:0-4 基本、5-7 morph、8 qPos、9 qUv、10 qIdx、11-13 圖
    gltf.accessors.push(
      { bufferView: 5, componentType: 5126, count: posA.length / 3, type: 'VEC3' },   // 5 morph d0
      { bufferView: 6, componentType: 5126, count: posA.length / 3, type: 'VEC3' },   // 6 morph d1
      { bufferView: 7, componentType: 5126, count: posA.length / 3, type: 'VEC3' },   // 7 morph d2
      { bufferView: 8, componentType: 5126, count: 4, type: 'VEC3', min: [-0.2, 1.0, 0.3], max: [0.2, 1.4, 0.3] },
      { bufferView: 9, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 10, componentType: 5123, count: 6, type: 'SCALAR' });
    gltf.meshes[0].primitives[0].targets = [{ POSITION: 5 }, { POSITION: 6 }, { POSITION: 7 }];
    gltf.meshes[0].weights = [0, 0, 0];
    gltf.meshes.push({ name: 'Deco', primitives: [
      { attributes: { POSITION: 8, TEXCOORD_0: 9 }, indices: 10, material: 0 },
      { attributes: { POSITION: 8, TEXCOORD_0: 9 }, indices: 10, material: 1 }] });
    gltf.nodes.push({ name: 'decoquad', mesh: 1 });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    gltf.images = [{ bufferView: 11, mimeType: 'image/png' }, { bufferView: 12, mimeType: 'image/png' }, { bufferView: 13, mimeType: 'image/png' }];
    gltf.textures = [{ source: 0 }, { source: 1 }, { source: 2 }];
    gltf.materials = [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1 } }, alphaMode: 'BLEND' }];
    gltf.extensions = { VRM: { meta: { title: 'fat-probe', texture: 2 } } };   // thumbnail 只從這裡被引用
    gltf.extensionsUsed = ['VRM'];
  }

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc(pad4(bin.length), 0)]);
  const total = 12 + 8 + jsonPad.length + 8 + binPad.length;
  const out = Buffer.alloc(total); let o = 0;
  out.write('glTF', o); o += 4; out.writeUInt32LE(2, o); o += 4; out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonPad.length, o); o += 4; out.writeUInt32LE(0x4E4F534A, o); o += 4;
  jsonPad.copy(out, o); o += jsonPad.length;
  out.writeUInt32LE(binPad.length, o); o += 4; out.writeUInt32LE(0x004E4942, o); o += 4;
  binPad.copy(out, o);
  return out;
}

// variant: 'native' | 'vrm'(骨名版本),可加後綴 '-apose'(rest 姿勢)與 '-fat'(morph+貼圖+假 VRM thumbnail,psslim 用),如 'native-fat'。
export function buildSkinGlb(variant) { return build(variant); }
