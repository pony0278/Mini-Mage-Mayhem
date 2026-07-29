// tests/fixtures/mkskin.mjs — 產「最小蒙皮人形 GLB」給 skinrig 套件用(手寫 glTF,不依賴 GLTFExporter)。
// 為什麼不放已編好的 .glb 進 repo:二進位 fixture 看不出改了什麼,而且這裡才是骨名版本的規格書——
// 'native'=遊戲原生命名 / 'vrm'=VRoid·VRM 命名(J_Bip_*),兩份就是別名表(actor-avatar BONE_ALIASES)的驗收對象。
// rest = T-pose(雙臂水平),對齊 actor-avatar 的 tposePose()。每根骨頭一個盒子、頂點 100% 綁該骨
//(測的是管線不是權重平滑度)。

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
  const B = skeleton(NAMES[variant.replace('-apose', '')], variant.endsWith('-apose'));
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

// variant: 'native' | 'vrm'(骨名版本),可加後綴 '-apose'(rest 姿勢版本),如 'native-apose'。
export function buildSkinGlb(variant) { return build(variant); }
