// Meshy 分件模型 → punch-studio 掛載 bundle 轉換器
// (幾何分類 13 部位/接觸面法找接縫/重定位到作者空間/縮放到骨架身高/GLTFExporter 匯出)
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
import { readFileSync, writeFileSync, existsSync } from 'fs';
// 用法:node meshy-convert.mjs <輸入分件GLB> <輸出bundle.glb> [three-160 node_modules 路徑]
// 需求:npm i puppeteer three-160@npm:three@0.160.0(離線環境靠攔截 unpkg 餵本地檔)
const GLB = process.argv[2];
const OUT = process.argv[3] || 'meshy-mannequin.glb';
const T3 = (process.argv[4] || './node_modules/three-160') + '/';
if (!GLB) { console.error('用法:node meshy-convert.mjs <輸入.glb> <輸出.glb>'); process.exit(1); }
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({width:900,height:900});
p.on('console', m => { if(!/GLTFExporter|THREE\./.test(m.text())) console.log('[page]', m.text()); });
p.on('pageerror', e => console.error('PAGEERROR:', e.message));
await p.setRequestInterception(true);
p.on('request', req => { const u=req.url();
  const m=u.match(/^https:\/\/unpkg\.com\/three@0\.160\.0\/(.+?)(\?.*)?$/);
  if(m){const fp=T3+m[1]; if(existsSync(fp)) return req.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:readFileSync(fp)}); return req.abort();}
  req.continue(); });
await p.setContent(`<!doctype html><html><head>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body></body></html>`);

const glbBytes = Array.from(new Uint8Array(readFileSync(GLB)));
const result = await p.evaluate(async (bytes) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(new Uint8Array(bytes).buffer, '', res, rej));
  gltf.scene.updateMatrixWorld(true);

  // ── 1. 抽世界座標(量化→Float32→套矩陣),保留索引與材質色 ──
  const parts = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    let pn = o.parent; while (pn && !/model_part/.test(pn.name)) pn = pn.parent;
    const a = o.geometry.getAttribute('position');
    const pos = new Float32Array(a.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) { v.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(o.matrixWorld); pos[i*3]=v.x; pos[i*3+1]=v.y; pos[i*3+2]=v.z; }
    const idx = o.geometry.index ? Array.from(o.geometry.index.array) : null;
    const col = (o.material && o.material.color) ? o.material.color.getHex() : 0x888888;
    parts.push({ name: pn ? pn.name : o.name, pos, idx, col });
  });

  // ── 2. 全域縮放到骨架身高 1.75,腳底落 y=0、XZ 置中 ──
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for (const q of parts) for (let i=0;i<q.pos.length;i+=3) for (let k=0;k<3;k++){ mn[k]=Math.min(mn[k],q.pos[i+k]); mx[k]=Math.max(mx[k],q.pos[i+k]); }
  const S = 1.75 / (mx[1]-mn[1]);
  const cx=(mn[0]+mx[0])/2, cz=(mn[2]+mx[2])/2;
  for (const q of parts) for (let i=0;i<q.pos.length;i+=3){ q.pos[i]=(q.pos[i]-cx)*S; q.pos[i+1]=(q.pos[i+1]-mn[1])*S; q.pos[i+2]=(q.pos[i+2]-cz)*S; }

  // ── 3. 分類(幾何位置 → 槽名;-X=_l 依編排器「螢幕左」慣例)──
  const info = parts.map(q => {
    let sx=0, sy=0, n=q.pos.length/3;
    for (let i=0;i<q.pos.length;i+=3){ sx+=q.pos[i]; sy+=q.pos[i+1]; }
    return { q, cx: sx/n, cy: sy/n };
  });
  const byName = {};
  const sorted = info.slice();
  const pick = (fltr, sorter) => { const c = sorted.filter(e => !e.slot && fltr(e)); c.sort(sorter); return c; };
  // 手/前臂/上臂:上半身(cy>0.7)按 |cx| 由外而內三對
  const armband = pick(e => e.cy > 0.7 && Math.abs(e.cx) > 0.05, (a,b)=>Math.abs(b.cx)-Math.abs(a.cx));
  const names = ['hand','forearm','upper_arm'];
  for (let pair = 0; pair < 3; pair++) {
    const two = armband.slice(pair*2, pair*2+2).sort((a,b)=>a.cx-b.cx);
    two[0].slot = names[pair]+'_l'; two[1].slot = names[pair]+'_r';
  }
  // 頭/頸/軀幹:中央帶按 cy
  const central = pick(e => Math.abs(e.cx) <= 0.05 || e.cy <= 0.7, (a,b)=>b.cy-a.cy);
  const upperCentral = central.filter(e=>!e.slot);
  upperCentral.sort((a,b)=>b.cy-a.cy);
  upperCentral[0].slot='head'; upperCentral[1].slot='neck'; upperCentral[2].slot='torso';
  // 大腿/小腿:剩四件,cy 高的一對=thigh,低的=calf
  const legs = upperCentral.slice(3).sort((a,b)=>b.cy-a.cy);
  const th = legs.slice(0,2).sort((a,b)=>a.cx-b.cx); th[0].slot='thigh_l'; th[1].slot='thigh_r';
  const ca = legs.slice(2,4).sort((a,b)=>a.cx-b.cx); ca[0].slot='calf_l'; ca[1].slot='calf_r';
  for (const e of info) byName[e.slot] = e;

  // ── 4. 接觸面法:部位與「父部位」貼合的頂點群 = 切割介面(封蓋/開口皆適用)。
  // 接觸群中心=接縫原點;+Y=指向部位質心;+Z=世界 +Z 投影;半徑=群內散佈。
  function contactFrame(q, par, centroid) {
    const eps = 0.004, inv = 1 / eps;                       // 貼合容差(世界單位;量化誤差+浮點)
    const grid = new Map();
    for (let i = 0; i < par.pos.length; i += 3) {
      const k = Math.round(par.pos[i]*inv)+','+Math.round(par.pos[i+1]*inv)+','+Math.round(par.pos[i+2]*inv);
      if (!grid.has(k)) grid.set(k, true);
    }
    const near = (x,y,z) => {
      const gx=Math.round(x*inv), gy=Math.round(y*inv), gz=Math.round(z*inv);
      for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (let dz=-1;dz<=1;dz++)
        if (grid.has((gx+dx)+','+(gy+dy)+','+(gz+dz))) return true;
      return false;
    };
    const patch = [];
    for (let i = 0; i < q.pos.length; i += 3)
      if (near(q.pos[i], q.pos[i+1], q.pos[i+2])) patch.push([q.pos[i], q.pos[i+1], q.pos[i+2]]);
    if (patch.length < 3) return null;
    const c = [0,0,0];
    for (const t of patch){ c[0]+=t[0]; c[1]+=t[1]; c[2]+=t[2]; }
    c[0]/=patch.length; c[1]/=patch.length; c[2]/=patch.length;
    let y = [centroid[0]-c[0], centroid[1]-c[1], centroid[2]-c[2]];
    const yl = Math.hypot(...y)||1; y = [y[0]/yl, y[1]/yl, y[2]/yl];
    let r = 0; for (const t of patch) r += Math.hypot(t[0]-c[0], t[1]-c[1], t[2]-c[2]); r /= patch.length;
    const dF = y[2];
    let z = [0 - y[0]*dF, 0 - y[1]*dF, 1 - y[2]*dF];
    let zl = Math.hypot(...z);
    if (zl < 1e-6) { z = [0 - y[0]*y[1], 1 - y[1]*y[1], 0 - y[2]*y[1]]; zl = Math.hypot(...z)||1; }
    z = [z[0]/zl, z[1]/zl, z[2]/zl];
    const x = [y[1]*z[2]-y[2]*z[1], y[2]*z[0]-y[0]*z[2], y[0]*z[1]-y[1]*z[0]];
    return { c, x, y, z, r, patchN: patch.length };
  }
  const PARENT = { head:'neck', neck:'torso', hand_l:'forearm_l', hand_r:'forearm_r', forearm_l:'upper_arm_l', forearm_r:'upper_arm_r',
    upper_arm_l:'torso', upper_arm_r:'torso', thigh_l:'torso', thigh_r:'torso', calf_l:'thigh_l', calf_r:'thigh_r' };
  const report = [], outScene = new THREE.Scene(), checkScene = new THREE.Scene();
  for (const e of info) {
    const { q } = e, slot = e.slot;
    const n = q.pos.length/3; const centroid=[0,0,0];
    for (let i=0;i<q.pos.length;i+=3){ centroid[0]+=q.pos[i]; centroid[1]+=q.pos[i+1]; centroid[2]+=q.pos[i+2]; }
    centroid[0]/=n; centroid[1]/=n; centroid[2]/=n;
    let frame;
    if (slot === 'torso') { // 根件:原點=包圍盒底中心,軸=世界
      let bmn=[1e9,1e9,1e9], bmx=[-1e9,-1e9,-1e9];
      for (let i=0;i<q.pos.length;i+=3) for (let k=0;k<3;k++){ bmn[k]=Math.min(bmn[k],q.pos[i+k]); bmx[k]=Math.max(bmx[k],q.pos[i+k]); }
      frame = { c:[(bmn[0]+bmx[0])/2, bmn[1], (bmn[2]+bmx[2])/2], x:[1,0,0], y:[0,1,0], z:[0,0,1], r:0 };
    } else {
      const par = byName[PARENT[slot]];
      frame = contactFrame(q, par.q, centroid);
      if (!frame) throw new Error(slot + ': 找不到與父部位的接觸面');
      e.loopCount = frame.patchN;
    }
    // 重定位:p' = [x·(p−c), y·(p−c), z·(p−c)]
    const rp = new Float32Array(q.pos.length); let maxY=0;
    for (let i=0;i<q.pos.length;i+=3){
      const px=q.pos[i]-frame.c[0], py=q.pos[i+1]-frame.c[1], pz=q.pos[i+2]-frame.c[2];
      rp[i]  =px*frame.x[0]+py*frame.x[1]+pz*frame.x[2];
      rp[i+1]=px*frame.y[0]+py*frame.y[1]+pz*frame.y[2];
      rp[i+2]=px*frame.z[0]+py*frame.z[1]+pz*frame.z[2];
      if (rp[i+1]>maxY) maxY=rp[i+1];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    geo.setIndex(q.idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: q.col, roughness: 0.85 }));
    mesh.name = slot;
    const grp = new THREE.Group(); grp.name = slot; grp.add(mesh); outScene.add(grp);
    // 驗證場景:用 frame 逆變換擺回原位 → 應重組成原始人形
    const chk = mesh.clone();
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.x), new THREE.Vector3(...frame.y), new THREE.Vector3(...frame.z)).setPosition(...frame.c);
    chk.applyMatrix4(M); checkScene.add(chk);
    report.push({ slot, r: +frame.r.toFixed(4), lenY: +maxY.toFixed(3), loops: e.loopCount || 0, col: '#'+q.col.toString(16).padStart(6,'0') });
  }
  // ── 5. 匯出 bundle + 驗證截圖 ──
  const ab = await new GLTFExporter().parseAsync(outScene, { binary: true });
  // 渲染驗證場景
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(900, 900);
  document.body.appendChild(renderer.domElement);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 100); cam.position.set(0.7, 1.1, 2.6); cam.lookAt(0, 0.85, 0);
  checkScene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(2,3,2); checkScene.add(dl);
  renderer.render(checkScene, cam);
  return { bytes: Array.from(new Uint8Array(ab)), report };
}, glbBytes);
console.table ? console.table(result.report) : console.log(result.report);
for (const r of result.report) console.log(`${r.slot.padEnd(12)} 接縫r=${r.r} 長度=${r.lenY} 接觸點=${r.loops} 色=${r.col}`);
writeFileSync(OUT, Buffer.from(result.bytes));
console.log('bundle 已寫出:', (result.bytes.length/1024).toFixed(0), 'KB');
await p.screenshot({ path: OUT.replace(/\.glb$/, '') + '_reassembled.png' }); // 重組驗證圖
await b.close();
