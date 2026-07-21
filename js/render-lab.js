// render-lab.js — v2 魔法實驗室場景(復刻使用者的 arcane containment 原型,非換皮):
// 完整採用原型的渲染管線 —— MeshStandard + emissive 貼圖(真自發光)、ACES 電影調色、
// sRGB 輸出、PCFSoft 陰影、局部點光源。只在 v2.html 啟用(每頁獨立 renderer,單機零影響)。
// 原型單位:1 unit = 1 tile;我們的世界:1 tile = 32px → 一律乘 LAB_SCALE 換算,
// builder 幾乎逐字移植。碰撞/模擬完全不動(牆的碰撞仍在 30×20 核心邊界)。
import { W, H, TILE, COLS, ROWS } from './constants.js';
import { renderer, scene, camera, IS_MOBILE, loadFrostBottleGlb, frostBottleReady, loadBarrelGlb, barrelReady, loadFireHatGlb, fireHatReady } from './render-core.js';
import { floor as floorGrid, FL } from './v2-floor.js'; // 地板化學狀態(唯讀);render→v2-floor 同 render→sim 方向,無循環

const LAB_SCALE = TILE;                 // 1 原型單位 = 32 世界px
const CX = W / 2, CZ = H / 2;           // 場地中心(世界px)
const SCENE_W = 34, SCENE_D = 30;       // 總場景(tiles) — 牆外含裝飾帶
const CORE_W = 30, CORE_D = 20;         // 戰鬥核心區(tiles) = 現行模擬場地(=W/H)
const CORE_HX = CORE_W / 2, CORE_HZ = CORE_D / 2; // 核心半寬/半深(15/10;戰區導引/地標用)
const CENTER_SCALE = 0.68;              // 中央清運口(收容平台+分揀陣列+斑馬安全圈)整體縮放;純視覺,不動 POD 判定半徑
export const LAB = { SCENE_W, SCENE_D, CORE_W, CORE_D, CX, CZ, S: LAB_SCALE };

// 低效能模式(?fx=low):關陰影/剝裝飾性點光/關玻璃 transmission(額外整景渲染 pass)。
// SwiftShader headless 測試與低階機用;觀感主體(emissive/ACES/additive)全保留。
const _fxParam = new URLSearchParams(location.search).get('fx');
export const FX_LOW = _fxParam ? _fxParam === 'low' : IS_MOBILE; // 手機自動低效能(2026-07 卡頓診斷:18 點光+13 transmission=主因,低配主執行緒 2.1×);?fx=low / ?fx=full 手動覆蓋
export const labAnimated = [];          // { update(t, dt) } — updateLabScene 每幀跑
let labBuilt = false;

/* ---------- 地板化學動態 tile(第四刀 MVP 粗色塊)----------
   讀 v2-floor 的狀態格,每幀更新一層貼在地板上的半透明 quad。危險醒目、底料低調;
   衰退最後 40% 淡出、cell.warn 期閃爍(用 updateLabScene 傳入的 ta → LOW_FLICKER 時凍結,光敏無障礙)。
   之後要精緻化(粒子/符文/加色發光)只換這裡的材質,狀態機/邏輯層完全不動。 */
const FLOOR_FX_COL = {          // MVP 顏色
  [FL.FIRE]: 0xff6a2a, [FL.ICE]: 0xbfe6ff, [FL.POISON]: 0xa24bd8,
  [FL.CHARGED]: 0x8fdcff, [FL.WATER]: 0x2f6a9a, [FL.OIL]: 0x171720,
};
const FLOOR_FX_ALPHA = {       // 底料低調、危險醒目
  [FL.FIRE]: 0.60, [FL.ICE]: 0.50, [FL.POISON]: 0.50,
  [FL.CHARGED]: 0.60, [FL.WATER]: 0.34, [FL.OIL]: 0.52,
};
let floorFxGroup = null, floorFxGeo = null;
const floorFxPool = [];
function getFloorTile(i) {
  if (floorFxPool[i]) return floorFxPool[i];
  if (!floorFxGeo) { floorFxGeo = new THREE.PlaneGeometry(TILE, TILE); floorFxGeo.rotateX(-Math.PI / 2); }
  const m = new THREE.Mesh(floorFxGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
  m.renderOrder = 2; m.visible = false; floorFxGroup.add(m); floorFxPool[i] = m; return m;
}
function updateFloorFx(ta) {
  if (!floorFxGroup) return;
  let i = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = floorGrid[y][x];
    if (!c) continue;
    const col = FLOOR_FX_COL[c.st]; if (col === undefined) continue;
    const m = getFloorTile(i++);
    m.visible = true;
    m.position.set(x * TILE + TILE / 2, 0.6, y * TILE + TILE / 2);
    let a = FLOOR_FX_ALPHA[c.st] ?? 0.5;
    const frac = c.max > 0 ? c.ttl / c.max : 1;
    if (frac < 0.4) a *= Math.max(0, frac / 0.4);                       // 衰退最後 40% 淡出
    if (c.warn) a *= 0.55 + 0.45 * Math.sin(ta * 18);                   // 預警閃爍(ta 凍結時不閃 = 光敏友善)
    m.material.color.setHex(col);
    m.material.opacity = Math.max(0, a);
  }
  for (; i < floorFxPool.length; i++) floorFxPool[i].visible = false;   // 隱藏本幀沒用到的池 mesh
}

/* ---------- 地板貼圖(v2_10 工業改版:灰綠金屬石磚 + 凹陷維護縫[淡琥珀維護電流]+ 稀疏符文汙染;
   map+emissive 雙貼圖;canvas 逐字移植自使用者原型,像素空間不吃 LAB_SCALE) ---------- */
function makeFloorTextures(){
  const S=1024, tiles=8, t=S/tiles;
  const c=document.createElement('canvas'); c.width=c.height=S;
  const g=c.getContext('2d');
  const e=document.createElement('canvas'); e.width=e.height=S;
  const ge=e.getContext('2d');
  ge.fillStyle='#000'; ge.fillRect(0,0,S,S);

  // base tiles with variation
  for(let y=0;y<tiles;y++)for(let x=0;x<tiles;x++){
    const v=0.85+Math.random()*0.3;
    const r=Math.floor(34*v), gg=Math.floor(39*v), b=Math.floor(39*v);
    g.fillStyle=`rgb(${r},${gg},${b})`;
    g.fillRect(x*t,y*t,t,t);
    // subtle inner bevel
    g.strokeStyle='rgba(255,255,255,0.04)';
    g.lineWidth=3; g.strokeRect(x*t+4,y*t+4,t-8,t-8);
  }
  // wear / soft noise
  for(let i=0;i<2200;i++){
    g.fillStyle=`rgba(${Math.random()>0.5?220:20},${Math.random()>0.5?205:25},${Math.random()>0.5?175:25},${Math.random()*0.028})`;
    g.fillRect(Math.random()*S, Math.random()*S, Math.random()*8+1, Math.random()*8+1);
  }
  // scratches
  for(let i=0;i<90;i++){
    const x=Math.random()*S, y=Math.random()*S, a=Math.random()*Math.PI, L=20+Math.random()*90;
    g.strokeStyle=`rgba(200,200,230,${0.03+Math.random()*0.06})`;
    g.lineWidth=1;
    g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*L, y+Math.sin(a)*L); g.stroke();
  }
  // stains
  for(let i=0;i<26;i++){
    const x=Math.random()*S, y=Math.random()*S, r=18+Math.random()*55;
    const grad=g.createRadialGradient(x,y,0,x,y,r);
    const hue=Math.random()<0.4?'24,34,29':'18,16,13';
    grad.addColorStop(0,`rgba(${hue},0.35)`); grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad; g.beginPath(); g.arc(x,y,r,0,7); g.fill();
  }
  // magical scorch marks
  for(let i=0;i<14;i++){
    const x=Math.random()*S, y=Math.random()*S, r=25+Math.random()*45;
    const grad=g.createRadialGradient(x,y,0,x,y,r);
    grad.addColorStop(0,'rgba(5,3,10,0.85)');
    grad.addColorStop(0.6,'rgba(52,24,20,0.30)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad; g.beginPath(); g.arc(x,y,r,0,7); g.fill();
    // faint magic residue ring on emissive
    ge.strokeStyle=`rgba(${Math.random()<0.5?'158,92,255':'70,205,235'},0.12)`;
    ge.lineWidth=2; ge.beginPath(); ge.arc(x,y,r*0.55,Math.random()*3,Math.random()*3+3); ge.stroke();
  }
  // cracks
  for(let i=0;i<22;i++){
    let x=Math.random()*S, y=Math.random()*S;
    g.strokeStyle='rgba(8,5,16,0.8)'; g.lineWidth=1.6;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<6;s++){ x+=(Math.random()-0.5)*46; y+=(Math.random()-0.5)*46; g.lineTo(x,y); }
    g.stroke();
  }
  // recessed industrial seams; only a faint maintenance-current glow remains
  g.strokeStyle='rgba(8,12,13,0.95)'; g.lineWidth=5;
  ge.strokeStyle='rgba(214,151,38,0.22)'; ge.lineWidth=2;
  for(let i=0;i<=tiles;i++){
    g.beginPath(); g.moveTo(i*t,0); g.lineTo(i*t,S); g.stroke();
    g.beginPath(); g.moveTo(0,i*t); g.lineTo(S,i*t); g.stroke();
    ge.beginPath(); ge.moveTo(i*t,0); ge.lineTo(i*t,S); ge.stroke();
    ge.beginPath(); ge.moveTo(0,i*t); ge.lineTo(S,i*t); ge.stroke();
  }
  // fade grout glow with random dark gaps (worn energy lines)
  for(let i=0;i<160;i++){
    ge.fillStyle='rgba(0,0,0,0.85)';
    const along=Math.random()<0.5;
    const gx=Math.floor(Math.random()*(tiles+1))*t;
    if(along) ge.fillRect(gx-4, Math.random()*S, 8, 20+Math.random()*60);
    else      ge.fillRect(Math.random()*S, gx-4, 20+Math.random()*60, 8);
  }
  // sparse magical contamination decals — magic is pollution, not decoration
  const runes='ᚠᚢᚦᚨᚱᚲᛃᛇᛉᛋᛏᛒᛖᛗᛚᛝ';
  for(let i=0;i<4;i++){
    const x=Math.random()*S, y=Math.random()*S;
    const col=['rgba(120,80,255,','rgba(70,220,255,','rgba(120,255,150,'][Math.floor(Math.random()*3)];
    ge.strokeStyle=col+'0.7)'; ge.lineWidth=2;
    ge.beginPath(); ge.arc(x,y,16,0,7); ge.stroke();
    ge.fillStyle=col+'0.8)';
    ge.font='20px serif'; ge.textAlign='center'; ge.textBaseline='middle';
    ge.fillText(runes[Math.floor(Math.random()*runes.length)],x,y);
  }
  const map=new THREE.CanvasTexture(c); map.encoding=THREE.sRGBEncoding;
  const emissive=new THREE.CanvasTexture(e);
  map.wrapS=map.wrapT=emissive.wrapS=emissive.wrapT=THREE.RepeatWrapping;
  map.repeat.set(SCENE_W/16, SCENE_D/16); emissive.repeat.set(SCENE_W/16, SCENE_D/16);
  return {map, emissive};
}

/* ---------- 中央「電弧分揀陣列」(v2_10:回收三角 sigil + 四色元素導軌 + 儀式錨點 + 條碼檢測痕;
   蓋在收容艙腳下的地面貼圖;逐字移植) ---------- */
function makeCircleTexture(){
  const S=1024, c=document.createElement('canvas'); c.width=c.height=S;
  const g=c.getContext('2d'); const cx=S/2, cy=S/2;
  g.clearRect(0,0,S,S);

  const colors=['#f07635','#62c8dd','#9b72e7','#73d980'];
  const dark='rgba(15,19,19,0.88)';

  // industrial outer rings
  g.strokeStyle='rgba(224,163,45,0.92)'; g.lineWidth=14;
  g.setLineDash([70,28,18,28]);
  g.beginPath(); g.arc(cx,cy,470,0,Math.PI*2); g.stroke();
  g.setLineDash([]);
  g.strokeStyle='rgba(205,198,165,0.52)'; g.lineWidth=5;
  g.beginPath(); g.arc(cx,cy,420,0,Math.PI*2); g.stroke();
  g.strokeStyle='rgba(73,84,82,0.95)'; g.lineWidth=10;
  g.beginPath(); g.arc(cx,cy,235,0,Math.PI*2); g.stroke();

  // four colored sorting lanes
  const dirs=[
    {a:-Math.PI/2,c:colors[1]}, // frost / north
    {a:0,c:colors[2]},          // electric / east
    {a:Math.PI/2,c:colors[3]},  // slime / south
    {a:Math.PI,c:colors[0]},    // fire / west
  ];
  dirs.forEach((d)=>{
    const x1=cx+Math.cos(d.a)*150, y1=cy+Math.sin(d.a)*150;
    const x2=cx+Math.cos(d.a)*410, y2=cy+Math.sin(d.a)*410;
    g.strokeStyle=d.c; g.lineWidth=20; g.globalAlpha=0.18;
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
    g.globalAlpha=0.9;
    // arrow head 指向中央(內端 x1,朝 −d;對齊「送進回收艙」方向)
    g.save(); g.translate(x1,y1); g.rotate(d.a+Math.PI);
    g.fillStyle=d.c; g.beginPath();
    g.moveTo(26,0); g.lineTo(-20,-18); g.lineTo(-8,0); g.lineTo(-20,18); g.closePath(); g.fill();
    g.restore();
  });
  g.globalAlpha=1;

  // (removed the circular arc arrows — the recycle mark is now a triangular
  //  three-arrow glyph, so a round arc layer behind it would fight the read)

  // scanner center — larger recycling sigil, more fused with the magic circle
  const grad=g.createRadialGradient(cx,cy,0,cx,cy,110);
  grad.addColorStop(0,'rgba(255,187,58,0.58)');
  grad.addColorStop(0.45,'rgba(158,100,230,0.18)');
  grad.addColorStop(0.75,'rgba(110,180,174,0.14)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=grad; g.beginPath(); g.arc(cx,cy,110,0,Math.PI*2); g.fill();

  // inner ritual ring to blend the recycle mark into the arcane scanner
  g.strokeStyle='rgba(236,198,94,0.95)'; g.lineWidth=5;
  g.beginPath(); g.arc(cx,cy,88,0,Math.PI*2); g.stroke();
  g.strokeStyle='rgba(158,100,230,0.62)'; g.lineWidth=3;
  g.setLineDash([10,12]);
  g.beginPath(); g.arc(cx,cy,70,0,Math.PI*2); g.stroke();
  g.setLineDash([]);
  g.strokeStyle='rgba(232,220,181,0.92)'; g.lineWidth=6;
  g.beginPath(); g.arc(cx,cy,54,0,Math.PI*2); g.stroke();

  // six ritual anchor nodes around the center
  for(let i=0;i<6;i++){
    const a=-Math.PI/2+i*Math.PI*2/6;
    const px=cx+Math.cos(a)*88, py=cy+Math.sin(a)*88;
    g.fillStyle=i%2===0 ? 'rgba(255,149,38,0.95)' : 'rgba(168,124,255,0.95)';
    g.beginPath(); g.arc(px,py,7,0,Math.PI*2); g.fill();
    g.strokeStyle='rgba(242,228,186,0.85)'; g.lineWidth=2;
    g.beginPath(); g.arc(px,py,12,0,Math.PI*2); g.stroke();
  }

  // orange triangular magic guides that echo the recycling arrows
  g.strokeStyle='rgba(255,140,34,0.72)'; g.lineWidth=3;
  for(let i=0;i<3;i++){
    const a=-Math.PI/2+i*Math.PI*2/3;
    const p1=[cx+Math.cos(a)*34, cy+Math.sin(a)*34];
    const p2=[cx+Math.cos(a+0.58)*62, cy+Math.sin(a+0.58)*62];
    const p3=[cx+Math.cos(a-0.58)*62, cy+Math.sin(a-0.58)*62];
    g.beginPath();
    g.moveTo(p1[0],p1[1]); g.lineTo(p2[0],p2[1]); g.lineTo(p3[0],p3[1]); g.closePath();
    g.stroke();
  }

  // large bright orange recycling sigil at the exact center
  // Drawn procedurally instead of using the ♻ font glyph so it renders reliably
  // across Windows/Chrome/CanvasTexture environments.
  const coreGrad=g.createRadialGradient(cx,cy,0,cx,cy,118);
  coreGrad.addColorStop(0,'rgba(255,184,72,0.52)');
  coreGrad.addColorStop(0.42,'rgba(255,122,34,0.26)');
  coreGrad.addColorStop(0.72,'rgba(164,96,245,0.13)');
  coreGrad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=coreGrad; g.beginPath(); g.arc(cx,cy,118,0,Math.PI*2); g.fill();

  // universal (triangular) recycling mark: three straight arrows running along
  // the three edges of an equilateral triangle, each turning the corner (chasing).
  (function drawRecycleTriangle(){
    const R=118, band=20;
    const V=[];
    for(let i=0;i<3;i++){ const a=-Math.PI/2+i*Math.PI*2/3; V.push([cx+Math.cos(a)*R, cy+Math.sin(a)*R]); }
    for(let i=0;i<3;i++){
      const A=V[i], B=V[(i+1)%3];
      const dx=B[0]-A[0], dy=B[1]-A[1];
      const len=Math.hypot(dx,dy), ux=dx/len, uy=dy/len;
      const px=-uy, py=ux;                 // edge normal
      const s=[A[0]+ux*46, A[1]+uy*46];    // inset start (leaves the fold gap)
      const e=[B[0]-ux*58, B[1]-uy*58];    // inset end (room for the arrowhead)

      g.save();
      g.lineCap='butt'; g.lineJoin='round';
      // magical underglow
      g.shadowColor='rgba(255,120,20,1)'; g.shadowBlur=34;
      g.strokeStyle='rgba(255,124,22,0.95)'; g.lineWidth=band+12;
      g.beginPath(); g.moveTo(s[0],s[1]); g.lineTo(e[0],e[1]); g.stroke();
      // bright core band
      g.shadowBlur=15;
      g.strokeStyle='rgba(255,186,74,0.98)'; g.lineWidth=band;
      g.beginPath(); g.moveTo(s[0],s[1]); g.lineTo(e[0],e[1]); g.stroke();

      // chevron arrowhead at the end, pointing around the corner
      const hl=42, hw=24;
      const tip=[e[0]+ux*hl, e[1]+uy*hl];
      const b1=[e[0]+px*hw, e[1]+py*hw];
      const b2=[e[0]-px*hw, e[1]-py*hw];
      g.shadowColor='rgba(255,120,20,1)'; g.shadowBlur=26;
      g.fillStyle='rgba(255,150,32,0.99)';
      g.strokeStyle='rgba(255,224,158,0.75)'; g.lineWidth=3;
      g.beginPath(); g.moveTo(tip[0],tip[1]); g.lineTo(b1[0],b1[1]); g.lineTo(b2[0],b2[1]); g.closePath();
      g.fill(); g.stroke();

      // small purple rune notch mid-band
      const mx=(s[0]+e[0])/2, my=(s[1]+e[1])/2;
      g.shadowColor='rgba(180,120,255,0.9)'; g.shadowBlur=12;
      g.fillStyle='rgba(190,132,255,0.95)';
      g.beginPath(); g.arc(mx,my,6,0,Math.PI*2); g.fill();
      g.restore();
    }
  })();

  // inner arcane triangle binds the recycle mark into the magic-circle language
  g.save();
  g.translate(cx,cy);
  g.shadowColor='rgba(166,105,255,0.75)';
  g.shadowBlur=18;
  g.strokeStyle='rgba(196,150,255,0.72)';
  g.lineWidth=4;
  g.beginPath();
  for(let i=0;i<3;i++){
    const a=-Math.PI/2+i*Math.PI*2/3;
    const x=Math.cos(a)*53, y=Math.sin(a)*53;
    if(i===0) g.moveTo(x,y); else g.lineTo(x,y);
  }
  g.closePath(); g.stroke();
  g.restore();

  // small center core so the scanner still reads as machinery + magic
  g.shadowColor='rgba(255,145,34,0.95)'; g.shadowBlur=22;
  g.fillStyle='rgba(255,205,116,0.99)'; g.beginPath(); g.arc(cx,cy,11,0,Math.PI*2); g.fill();
  g.shadowBlur=0;
  g.strokeStyle='rgba(255,145,34,0.95)'; g.lineWidth=3;
  g.beginPath(); g.arc(cx,cy,23,0,Math.PI*2); g.stroke();

  // small barcode-like inspection marks
  g.fillStyle=dark;
  for(let i=0;i<28;i++){
    const a=i/28*Math.PI*2;
    const r=330;
    const w=(i%4===0)?12:6;
    g.save(); g.translate(cx+Math.cos(a)*r,cy+Math.sin(a)*r); g.rotate(a);
    g.fillRect(-w/2,-18,w,36); g.restore();
  }

  // scuffed / damaged gaps so the floor still feels used
  // (kept out to the outer ring band so they never cut the central recycle mark)
  g.globalCompositeOperation='destination-out';
  for(let i=0;i<8;i++){
    const sa=Math.random()*Math.PI*2, sr=235+Math.random()*205;
    let x=cx+Math.cos(sa)*sr, y=cy+Math.sin(sa)*sr;
    g.lineWidth=8+Math.random()*12; g.strokeStyle='rgba(0,0,0,0.9)';
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<4;s++){ x+=(Math.random()-0.5)*90; y+=(Math.random()-0.5)*90; g.lineTo(x,y); }
    g.stroke();
  }
  g.globalCompositeOperation='source-over';
  const tex=new THREE.CanvasTexture(c); tex.encoding=THREE.sRGBEncoding;
  return tex;
}

/* ---------- 建場:管線 profile + 氛圍 + 燈光組 + 地板 + 魔法陣 ---------- */
export function initLabScene() {
  if (labBuilt) return; labBuilt = true;
  // 渲染管線(原型 profile;v2 頁面獨立 renderer,單機不受影響)
  if (renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;         // v2_10:工業暗場 + ACES,曝光略提
    renderer.shadowMap.enabled = !FX_LOW;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  scene.background = new THREE.Color(0x070a0c); // v2_10 工業黑
  scene.fog = new THREE.FogExp2(0x080b0d, 0.017 / LAB_SCALE); // 原型密度按單位換算

  // 燈光組:採 v2_10 的暖 key + 冷 rim + 四角元素點光「工業陰暗實驗室」性格,
  // 但 ambient/hemi 比原型場景值(0.30/0.28)刻意抬高 —— 角色是 Lambert 受光,
  // 太暗會吃掉藍/紅身分色(readability > 純氛圍)。點光=裝飾,?fx=low 剝除。
  scene.add(new THREE.AmbientLight(0x2a3230, 1.05));                 // 冷工業灰綠(原紫 0x37306a)
  scene.add(new THREE.HemisphereLight(0x3a4550, 0x0a0c0d, 0.55));
  const key = new THREE.DirectionalLight(0xf0d9a6, 0.7);             // 暖 key(原型 0xf0d9a6)
  key.position.set(CX + 14 * LAB_SCALE, 26 * LAB_SCALE, CZ + 10 * LAB_SCALE);
  key.target.position.set(CX, 0, CZ); scene.add(key.target);
  key.castShadow = !FX_LOW;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -25 * LAB_SCALE;
  key.shadow.camera.right = key.shadow.camera.top = 25 * LAB_SCALE;
  key.shadow.camera.far = 4000;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a72ff, 0.5);             // 冷 arcane rim,刻出機械輪廓
  rim.position.set(CX - 16 * LAB_SCALE, 12 * LAB_SCALE, CZ - 14 * LAB_SCALE); scene.add(rim);
  // 四角元素站底光(火/冰/毒/雷,對應 Phase 3 四角站位;裝飾性 → fx=low 剝除)
  if (!FX_LOW) for (const [c, x, z] of [
    [0xff6a26, -13.85, -12], [0x53c8ff, 13.85, -12], [0x8dff7a, -13.85, 12], [0xa87cff, 13.85, 12],
  ]) {
    const pl = new THREE.PointLight(c, 1.35, 13 * LAB_SCALE, 2); // perf-1:0.95→1.35、11→13(補償站身 decoLight 退役;全場點光 18→6)
    pl.position.set(CX + x * LAB_SCALE, 2.4 * LAB_SCALE, CZ + z * LAB_SCALE); scene.add(pl);
  }

  // 地板:34×30 總場景一整片(核心+裝飾帶),map+emissive 雙貼圖
  const floorTex = makeFloorTextures();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SCENE_W * LAB_SCALE, SCENE_D * LAB_SCALE),
    new THREE.MeshStandardMaterial({
      map: floorTex.map, emissiveMap: floorTex.emissive,
      emissive: 0xffffff, emissiveIntensity: 0.14, // v2_10:維護縫是淡琥珀微光,不再是紫溝發亮
      roughness: 0.74, metalness: 0.42,
    })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.set(CX, -0.5, CZ);
  floor.receiveShadow = true;
  scene.add(floor);

  // 地板化學動態層(世界座標,獨立於 labGroup 縮放)+ 註冊每幀更新
  floorFxGroup = new THREE.Group(); scene.add(floorFxGroup);
  labAnimated.push({ update: (ta) => updateFloorFx(ta) });

  // 中央分揀陣列(收容艙腳下)+ 琥珀點光。不旋轉 —— 四向元素導軌箭頭要固定指向四方,轉了就錯位。
  const circleMat = new THREE.MeshBasicMaterial({
    map: makeCircleTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, opacity: 0.95,
  });
  const magicCircle = new THREE.Mesh(new THREE.PlaneGeometry(8 * CENTER_SCALE * LAB_SCALE, 8 * CENTER_SCALE * LAB_SCALE), circleMat); // 原型 13 units;鏡頭近縮到 8,再乘 CENTER_SCALE
  magicCircle.rotation.x = -Math.PI / 2; magicCircle.position.set(CX, 1, CZ);
  scene.add(magicCircle);
  _oldPodDecal = magicCircle;                                    // GLB 底座載成後拆(留 circleGlow 點光照亮新底座)
  const circleGlow = new THREE.PointLight(0xffb43a, 1.85, 15 * LAB_SCALE, 2); // v2_10 琥珀(原紫 0x9a5cff)
  circleGlow.position.set(CX, 1.4 * LAB_SCALE, CZ); scene.add(circleGlow);
  scene.add(labGroup);
  buildLabWalls();
  buildLabEnergyTubes();
  buildLabProps();
  buildLabDust();
  // Phase 2:中央結構(收容平台包住分揀陣列)+ 地面物流圖 + 淨戰區導引
  buildCentralScannerDeck();
  loadPodGlb();                                             // 中央底座 GLB(async;載成後換掉上面兩件程序化中央件)
  loadFrostBottleGlb();                                     // 冰霜瓶 GLB(item-1;async 載一次,握持/地面/飛行三狀態 clone;未載成退方塊)
  loadBarrelGlb();                                          // 爆桶 GLB(item-2;同冰瓶三狀態;充能/引信靠疊加光暈)
  loadFireHatGlb();                                         // 火帽 GLB(item-3;持有噴火帽時戴頭上)
  // 四色地面箭頭/「THROW IN!」指示牌:2026-07-19 使用者反饋太突兀,整組拆除(歷史+替代方向見 js/CLAUDE.md;實作在 git c63a0cf 前)
  buildIndustrialFloorMarkings();
  buildCoreCombatGuide();
  if (!FX_LOW) { buildArcaneArm(); buildServicePipeNetwork(); } // Phase 4:純裝飾,低效能模式剝除(決策 #3)
  labAnimated.push({ update: (t) => {                       // 溫和呼吸,不旋轉
    circleMat.opacity = 0.58 + Math.sin(t * 1.1) * 0.08;
    circleGlow.intensity = 1.6 + Math.max(0, Math.sin(t * 1.1)) * 0.6;
  } });
  if (renderer) renderer.compile(scene, camera); // perf-1 預熱:建場後一次性預編譯全部 shader(在載入期=卡頓不可見;免首次入鏡才編譯)
}

/* ---------- 原型材質庫(牆/柱/管用;MeshStandard) ---------- */
const M = {
  // v2_10 工業改版:預設色由紫系改灰系(牆/舊道具傳明色不受影響,只影響 bare 呼叫)
  metal: (c = 0x3b4342) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.48, metalness: 0.82 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x1a2021, roughness: 0.54, metalness: 0.86 }),
  stone: (c = 0x2b302f) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.12 }),
  glow: (c, i = 1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 }),
};
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = shadow && !FX_LOW; m.receiveShadow = true; return m;
}
// 所有原型 builder 都建在這個 ×32 縮放的 group 裡 → 幾何常數可逐字保留(原型單位)
const labGroup = new THREE.Group();
labGroup.scale.setScalar(LAB_SCALE); labGroup.position.set(CX, 0, CZ);

/* ---------- 力場邊界(30×20 核心=碰撞位置):膝蓋高發光矮緣 + 角落矮墩光球。
   高牆已拆——玩家反饋三連(殘影擋視線/單片消失像缺牙/牆後裝飾穿幫)的共同根因
   是低角度鏡頭前的高牆。邊界視覺=矮緣+牆基能量管+角落「力場錨點」光球,
   視線永不被擋,穿牆淡出系統整組退役;帶區裝飾自然變成環繞的實驗室環境。 ---------- */
const WALL_HX = CORE_W / 2 - 0.5;   // 14.5:邊界帶(最外圈 tile)的中心線
const WALL_HZ = CORE_D / 2 - 0.5;   // 9.5
function buildLabWalls() {
  const wall = new THREE.Group();
  function addCurbSide(length, fixedX, fixedZ, rotY, sideIndex) {
    const segCount = Math.ceil(length / 4);
    const seg = length / segCount;
    for (let i = 0; i < segCount; i++) {
      const local = -length / 2 + seg / 2 + i * seg;
      const p = mesh(new THREE.BoxGeometry(seg * 0.96, 0.44, 0.6), M.stone(0x28302f), 0, 0.22, 0); // v2_10 工業灰
      p.scale.y = 0.9 + ((i * 7 + sideIndex * 3) % 5) * 0.06;  // 沿用舊牆板的高低參差
      const trim = mesh(new THREE.BoxGeometry(seg * 0.96, 0.1, 0.22), M.glow(0xd8a12f, 0.6), 0, 0.47 * p.scale.y, 0, false); // 琥珀邊條(原紫)
      const g = new THREE.Group(); g.add(p); g.add(trim);
      g.rotation.y = rotY;
      if (Math.abs(Math.sin(rotY)) < 0.1) g.position.set(local, 0, fixedZ);
      else g.position.set(fixedX, 0, local);
      wall.add(g);
    }
  }
  addCurbSide(CORE_W, 0, -WALL_HZ, 0, 0);           // north
  addCurbSide(CORE_W, 0, WALL_HZ, Math.PI, 1);      // south
  addCurbSide(CORE_D, -WALL_HX, 0, Math.PI / 2, 2); // west
  addCurbSide(CORE_D, WALL_HX, 0, -Math.PI / 2, 3); // east
  // 角落矮墩 + 脈動光球(力場錨點)
  const pillarG = new THREE.CylinderGeometry(0.55, 0.75, 1.1, 8);
  const capG = new THREE.CylinderGeometry(0.62, 0.55, 0.28, 8);
  [[-WALL_HX, -WALL_HZ], [WALL_HX, -WALL_HZ], [-WALL_HX, WALL_HZ], [WALL_HX, WALL_HZ]].forEach(([x, z]) => {
    const pil = mesh(pillarG, M.darkMetal(), x, 0.55, z);
    const cap = mesh(capG, M.metal(0x48504e), x, 1.24, z);                                    // 灰金屬帽(原紫)
    const orb = mesh(new THREE.SphereGeometry(0.3, 12, 12), M.glow(0xe2a52f, 1.4), x, 1.62, z, false); // 琥珀力場錨點(原紫)
    labAnimated.push({ update: t => { orb.material.emissiveIntensity = 1.1 + Math.max(0, Math.sin(t * 2 + x + z)) * 0.5; } });
    wall.add(pil); wall.add(cap); wall.add(orb);
  });
  labGroup.add(wall);
}
/* ---------- 能量管(原型 buildEnergyTubes;沿牆基內側) ---------- */
function buildLabEnergyTubes() {
  const colors = [0xd29b2d, 0x9c3d31, 0x4f8d68, 0x4b7f93]; // v2_10 工業:琥珀/鏽紅/苔綠/鋼藍(原霓虹四色)
  const offX = WALL_HX - 0.6, offZ = WALL_HZ - 0.6;
  function addTube(length, x, z, rotY, color, phase) {
    const tube = mesh(new THREE.CylinderGeometry(0.13, 0.13, length, 10), M.glow(color, 1.0), 0, 0, 0, false);
    tube.rotation.z = Math.PI / 2;
    const g = new THREE.Group(); g.add(tube);
    g.rotation.y = rotY;
    g.position.set(x, 0.5, z);
    labGroup.add(g);
    labAnimated.push({ update: t => { tube.material.emissiveIntensity = 0.8 + Math.max(0, Math.sin(t * 3 + phase)) * 0.35; } });
  }
  addTube(CORE_W - 4, 0, -offZ, 0, colors[0], 0.0);
  addTube(CORE_D - 4, -offX, 0, Math.PI / 2, colors[1], 1.7);
  addTube(CORE_W - 4, 0, offZ, Math.PI, colors[2], 3.4);
  addTube(CORE_D - 4, offX, 0, -Math.PI / 2, colors[3], 5.1);
}

/* ---------- Phase 4:懸浮機械臂(純裝飾;沿場邊高空繞行,細長不擋中央;?fx=low 剝除) ---------- */
function buildArcaneArm() {
  const pivot = new THREE.Group(); labGroup.add(pivot);
  const arm = new THREE.Group();
  arm.position.set(15.5, 5.8, 0);          // +X 外側懸臂,-X 朝中央;高 5.8 只有夾爪接近頭部高度
  pivot.add(arm);
  const metal = M.metal(0x4a524f), dark = M.darkMetal(), steel = M.metal(0x565e5a);
  const amberSoft = M.glow(0xffb257, 0.6), violet = M.glow(0xb27bff, 1.1), podCore = M.glow(0xff9a34, 1.3), grab = M.glow(0xff9a34, 0.5);
  function segment(a, b, w, mat) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const seg = mesh(new THREE.CylinderGeometry(w * 0.7, w, len, 10), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, false);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    return seg;
  }
  arm.add(mesh(new THREE.OctahedronGeometry(0.5, 0), metal, 0, 0, 0, false));
  const core = mesh(new THREE.OctahedronGeometry(0.26, 0), podCore, 0, 0, 0, false); arm.add(core);
  const ring1 = mesh(new THREE.TorusGeometry(0.7, 0.05, 8, 26), amberSoft, 0, 0, 0, false); arm.add(ring1);
  const ring2 = mesh(new THREE.TorusGeometry(0.82, 0.04, 8, 26), violet, 0, 0, 0, false); ring2.rotation.x = Math.PI / 2; arm.add(ring2);
  const E = [-0.85, -0.55, 0], W = [-1.55, -1.10, 0];
  arm.add(segment([0, -0.05, 0], E, 0.2, metal));
  arm.add(mesh(new THREE.SphereGeometry(0.24, 12, 12), dark, E[0], E[1], E[2], false));
  arm.add(mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 18), violet, E[0], E[1], E[2], false));
  arm.add(segment(E, W, 0.16, metal));
  const claw = new THREE.Group(); claw.position.set(W[0], W[1], W[2]);
  claw.add(mesh(new THREE.CylinderGeometry(0.42, 0.58, 0.55, 10), steel, 0, 0, 0, false));
  const fingers = [];
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const fg = new THREE.Group();
    fg.position.set(Math.cos(a) * 0.18, 0.0, Math.sin(a) * 0.18);
    fg.add(mesh(new THREE.BoxGeometry(0.22, 1.2, 0.34), grab, 0, -0.62, 0, false));
    fg.rotation.z = Math.cos(a) * 0.5; fg.rotation.x = Math.sin(a) * 0.5;
    fingers.push({ fg, a }); claw.add(fg);
  }
  claw.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(W[0] - E[0], W[1] - E[1], 0).normalize());
  arm.add(claw);
  const shards = [];
  for (let i = 0; i < 3; i++) { const s = mesh(new THREE.OctahedronGeometry(0.13, 0), violet, 0, 0, 0, false); arm.add(s); shards.push(s); }
  labAnimated.push({ update: t => {
    pivot.rotation.y = t * 0.16;
    arm.position.y = 5.8 + Math.sin(t * 0.9) * 0.25;
    ring1.rotation.z = t * 0.6; ring2.rotation.y = t * 0.5;
    core.material.emissiveIntensity = 1.0 + Math.sin(t * 2.2) * 0.45;
    const open = 0.5 + Math.sin(t * 1.6) * 0.42;
    fingers.forEach(({ fg, a }) => { fg.rotation.z = Math.cos(a) * open; fg.rotation.x = Math.sin(a) * open; });
    shards.forEach((s, i) => {
      const a = t * 0.8 + i * Math.PI * 2 / 3;
      s.position.set(Math.cos(a) * 0.95, Math.sin(t * 1.1 + i) * 0.4, Math.sin(a) * 0.95);
      s.rotation.set(t * 1.2, t * 0.9, 0);
    });
  } });
}

/* ---------- Phase 4:牆面服務管線(北牆水平管 + 側牆立管閥;非發光工業件;?fx=low 剝除) ---------- */
function buildServicePipeNetwork() {
  const g = new THREE.Group();
  const cols = [0x6f5b31, 0x6f3530, 0x335a4a];
  [-11.5, -8.6, -5.7].forEach((x, i) => {
    const p = mesh(new THREE.CylinderGeometry(0.22, 0.22, 8.2, 10), M.metal(cols[i]), x, 4.4, -14.45);
    p.rotation.z = Math.PI / 2; g.add(p);
    for (let j = 0; j < 4; j++) {
      const clamp = mesh(new THREE.TorusGeometry(0.25, 0.055, 6, 10), M.darkMetal(), x - 3 + j * 2, 4.4, -14.45); clamp.rotation.x = Math.PI / 2; g.add(clamp);
    }
  });
  [-13.9, 13.9].forEach((x, side) => {
    for (let i = 0; i < 2; i++) {
      const px = x + (side ? -0.55 : 0.55) * i;
      g.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.9, 10), M.metal(i ? 0x6f3530 : 0x415b50), px, 3.2, 14.35));
      const valve = mesh(new THREE.TorusGeometry(0.38, 0.07, 6, 12), M.metal(0xa16d2a), px, 4.1, 14.0); valve.rotation.y = Math.PI / 2; g.add(valve);
    }
  });
  labGroup.add(g);
}
/* ==========================================================================
   帶區裝飾 —— 模組化:下面全是純 builder(回傳 Group,原型逐字移植),
   佈置由 LAB_LAYOUT 編排表決定(改佈局=改表;單位=tile,原點=場地中心)。
   預設編排原則:南帶是鏡頭前景 → 只放矮件;四座元素站在北帶(牆後露出,
   景深最佳);水槽/高傢俱進東西帶。
   ========================================================================== */
M.glass = (c = 0x7fe8ff, o = 0.22) => new THREE.MeshPhysicalMaterial({
  color: c, transparent: true, opacity: o, roughness: 0.05, metalness: 0,
  // perf-1(2026-07-20 桌機卡頓診斷):transmission 全平台退役——13 面玻璃任一入鏡=three.js 整景多渲一趟,
  // 近站區 draw calls 220→434=「走到特定位置突然卡」主因;風格化玻璃(透明+emissive)在深色場景已驗證讀得出。
  transmission: 0, emissive: c, emissiveIntensity: 0.08, side: THREE.DoubleSide });
M.wood = () => new THREE.MeshStandardMaterial({ color: 0x3a2b3f, roughness: 0.85 });

// 裝飾性點光:perf-1(2026-07-20)全平台退役——three.js forward 不剔除光源,18 盞點光=每個像素
// 每幀算 18 盞(透射 pass 期間再算一次)=桌機幀成本底噪主因。氛圍主力=emissive/貼花(手機已驗證),
// 四角元素色改由場燈的角落底光(0.95→1.35 補強)承擔。回傳恆 null,動畫端判空(既有慣例)。
function decoLight() {
  return null;
}
function groundDecal(g, color, r = 2.8) { // 站台腳下的發光環貼花(各站自帶,顏色=站的元素色)
  const d = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r + 0.2, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d);
  labAnimated.push({ update: t => { d.material.opacity = 0.25 + Math.sin(t * 2 + g.position.x) * 0.12; } });
}

/* ========== Phase 3:v2_10 回收主題道具(取代舊實驗室道具全套;逐字移植,
   原型 new PointLight → decoLight(…×LAB_SCALE) 兼 fx=low 剝除,animated→labAnimated) ========== */

/* 回收料斗:矮工業桶身 + 半開翻蓋 + 回收箭頭 + 露出的雜物 + 狀態燈 */
function recyclingHopper(color = 0x5ff0e0, contents = 'orb') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.45, 1.7, 0.5, 12), M.darkMetal(), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.28, 1.48, 1.75, 12), M.metal(0x38403e), 0, 1.28, 0));
  const rim = mesh(new THREE.TorusGeometry(1.3, 0.18, 8, 18), M.glow(color, 0.8), 0, 2.18, 0, false);
  rim.rotation.x = Math.PI / 2; g.add(rim);
  const mouth = mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.12, 12), M.glow(color, 0.75), 0, 2.16, 0, false);
  g.add(mouth);
  const lid = mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.16, 12), M.metal(0x4b5350), 0, 2.65, -0.52);
  lid.rotation.x = 0.75; g.add(lid);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const mark = mesh(new THREE.BoxGeometry(0.42, 0.12, 0.12), M.glow(color, 1.15), Math.cos(a) * 1.5, 1.45, Math.sin(a) * 1.5, false);
    mark.rotation.y = -a; mark.rotation.z = 0.35; g.add(mark);
  }
  const junk = [];
  for (let i = 0; i < 6; i++) {
    const col = [color, 0xffc14f, 0xb58cff, 0x53c8ff][i % 4];
    let j;
    if (i % 3 === 0) j = mesh(new THREE.BoxGeometry(0.28, 0.22, 0.38), M.glow(col, 0.55), 0, 0, 0, false);
    else if (i % 3 === 1) j = mesh(new THREE.OctahedronGeometry(0.18), M.glow(col, 0.75), 0, 0, 0, false);
    else j = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.38, 7), M.glow(col, 0.65), 0, 0, 0, false);
    const a = i / 6 * Math.PI * 2 + 0.4;
    j.position.set(Math.cos(a) * (0.45 + 0.25 * (i % 2)), 2.30 + 0.05 * (i % 2), Math.sin(a) * (0.45 + 0.25 * (i % 2)));
    j.rotation.set(i * 0.3, i * 0.6, i * 0.2); junk.push(j); g.add(j);
  }
  const status = mesh(new THREE.BoxGeometry(0.75, 0.18, 0.12), M.glow(color, 1.4), 0, 0.85, 1.5, false); g.add(status);
  const light = decoLight(color, 0.9, 6 * LAB_SCALE); if (light) { light.position.set(0, 2.2 * LAB_SCALE, 0); g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    status.material.emissiveIntensity = 0.8 + (Math.sin(t * 3 + g.position.x) > 0 ? 0.9 : 0.15);
    mouth.material.emissiveIntensity = 0.55 + Math.sin(t * 2.1 + g.position.z) * 0.22;
    junk.forEach((j, i) => { j.rotation.y += dt * (0.2 + i * 0.04); });
    if (light) light.intensity = 0.7 + Math.sin(t * 2.2 + g.position.z) * 0.18;
  } });
  return g;
}

/* 廢料架:三層貨架塞滿分色廢件 + 危害標籤燈 */
function scrapRack() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.7, 3.4, 0.82), M.darkMetal(), 0, 1.7, 0));
  const cols = [0xff914d, 0x78ddff, 0xa87cff, 0x78ff9b, 0xffc14f];
  for (let row = 0; row < 3; row++) {
    g.add(mesh(new THREE.BoxGeometry(2.4, 0.1, 0.72), M.metal(0x59615c), 0, 0.9 + row * 0.95, 0.02));
    for (let i = 0; i < 5; i++) {
      const x = -0.95 + i * 0.48 + (row % 2) * 0.08;
      const col = cols[(i + row) % cols.length];
      let part;
      if ((i + row) % 3 === 0) part = mesh(new THREE.TorusGeometry(0.14, 0.045, 6, 10), M.glow(col, 0.45), x, 1.18 + row * 0.95, 0.1, false);
      else if ((i + row) % 3 === 1) part = mesh(new THREE.BoxGeometry(0.26, 0.34, 0.38), M.stone(0x434944), x, 1.15 + row * 0.95, 0.08);
      else part = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.46, 7), M.glow(col, 0.65), x, 1.18 + row * 0.95, 0.08, false);
      part.rotation.set(i * 0.2, row * 0.3, i * 0.12); g.add(part);
    }
  }
  const tag = mesh(new THREE.BoxGeometry(0.7, 0.18, 0.08), M.glow(0xffc14f, 1.0), 0, 3.15, 0.43, false); g.add(tag);
  labAnimated.push({ update: t => { tag.material.emissiveIntensity = 0.65 + Math.sin(t * 2) * 0.3; } });
  return g;
}

/* 壓實機:雙滾筒壓縮 + 發光進料槽 + 回收箭頭 + 警示燈 */
function compactorUnit() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.8, 2.25, 1.7), M.darkMetal(), 0, 1.12, 0));
  g.add(mesh(new THREE.BoxGeometry(3.0, 0.34, 1.9), M.metal(0x59615c), 0, 2.38, 0));
  const rollers = [];
  for (let i = 0; i < 2; i++) {
    const r = mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 12), M.metal(0x737b75), -0.58 + i * 1.16, 1.18, 0.83);
    r.rotation.x = Math.PI / 2; rollers.push(r); g.add(r);
  }
  const slot = mesh(new THREE.BoxGeometry(1.75, 0.56, 0.1), M.glow(0xd6a12e, 0.24), 0, 1.75, 0.86, false); g.add(slot);
  for (let i = 0; i < 3; i++) {
    const a = mesh(new THREE.BoxGeometry(0.42, 0.11, 0.08), M.glow(0xd6a12e, 0.20), -0.55 + i * 0.55, 0.55, 0.88, false);
    a.rotation.z = -0.35; g.add(a);
  }
  [0xff5c5c, 0xffc14f, 0x6dff9e].forEach((c, i) => {
    const d = mesh(new THREE.SphereGeometry(0.1, 8, 8), M.glow(c, 1.5), -0.65 + i * 0.65, 2.58, 0.55, false); g.add(d);
    labAnimated.push({ update: t => { d.material.emissiveIntensity = (Math.sin(t * 5 + i * 1.8) > 0.2) ? 1.8 : 0.25; } });
  });
  labAnimated.push({ update: (t, dt) => {
    rollers[0].rotation.z += dt * 1.8; rollers[1].rotation.z -= dt * 1.8;
    slot.material.emissiveIntensity = 0.65 + Math.sin(t * 4) * 0.35;
  } });
  return g;
}

/* UGC 展示櫃:玻璃櫃內一隻「回收的玩家」小人(驚慌姿)+ 回收標牌 */
function ugcDisplayCabinet(color = 0xb58cff, pose = 'panic') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.65, 1.55), M.darkMetal(), 0, 0.33, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 1.85, 1.28), M.glass(color, 0.14), 0, 1.55, 0, false));
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.22, 1.55), M.metal(0x59615c), 0, 2.55, 0));
  const dummy = new THREE.Group();
  const head = mesh(new THREE.SphereGeometry(0.32, 12, 12), M.stone(0xd9c6ff), 0, 0.42, 0, false);
  const body = mesh(new THREE.CylinderGeometry(0.27, 0.36, 0.62, 10), M.glow(color, 0.45), 0, -0.02, 0, false);
  const hat = mesh(new THREE.ConeGeometry(0.36, 0.6, 10), M.stone(0x3d315f), 0, 0.93, 0, false);
  dummy.add(head, body, hat);
  const arm1 = mesh(new THREE.BoxGeometry(0.13, 0.58, 0.13), M.glow(color, 0.35), -0.37, 0.06, 0, false);
  const arm2 = mesh(new THREE.BoxGeometry(0.13, 0.58, 0.13), M.glow(color, 0.35), 0.37, 0.06, 0, false);
  arm1.rotation.z = pose === 'panic' ? -0.9 : -0.2; arm2.rotation.z = pose === 'panic' ? 0.9 : 0.2;
  dummy.add(arm1, arm2); dummy.position.y = 1.38; g.add(dummy);
  g.add(mesh(new THREE.BoxGeometry(1.05, 0.22, 0.08), M.glow(0xffc14f, 0.7), 0, 0.58, 0.81, false));
  const l = decoLight(color, 0.65, 4 * LAB_SCALE); if (l) { l.position.set(0, 2.0 * LAB_SCALE, 0); g.add(l); }
  labAnimated.push({ update: (t) => {
    dummy.rotation.y = Math.sin(t * 0.65 + g.position.x) * 0.18;
    dummy.position.y = 1.38 + Math.sin(t * 1.6) * 0.06;
  } });
  return g;
}

/* 輸送帶:滾筒 + 邊燈 + 移動包裹(fx=low 保留幾何、砍捲動動畫) */
function conveyorBelt(length = 8, color = 0x78ddff) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(length, 0.3, 1.6), M.darkMetal(), 0, 0.32, 0));
  g.add(mesh(new THREE.BoxGeometry(length - 0.2, 0.12, 1.2), M.metal(0x444c49), 0, 0.53, 0));
  const rollers = [];
  for (let x = -length / 2 + 0.45; x < length / 2; x += 0.65) {
    const r = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.12, 8), M.metal(0x68706b), x, 0.61, 0, false);
    r.rotation.x = Math.PI / 2; rollers.push(r); g.add(r);
  }
  g.add(mesh(new THREE.BoxGeometry(length, 0.08, 0.08), M.glow(color, 0.22), 0, 0.63, -0.65, false));
  g.add(mesh(new THREE.BoxGeometry(length, 0.08, 0.08), M.glow(color, 0.22), 0, 0.63, 0.65, false));
  const parcels = [];
  for (let i = 0; i < 4; i++) {
    const p = i % 2 === 0
      ? mesh(new THREE.BoxGeometry(0.45, 0.35, 0.45), M.stone(0x454b46), -length / 2 + 1 + i * 1.7, 0.86, 0, false)
      : mesh(new THREE.OctahedronGeometry(0.25), M.glow([0xff914d, 0xa87cff, 0x78ff9b][i % 3], 0.7), -length / 2 + 1 + i * 1.7, 0.9, 0, false);
    p.userData.base = -length / 2 + 1 + i * 1.7; parcels.push(p); g.add(p);
  }
  if (!FX_LOW) labAnimated.push({ update: (t, dt) => {  // fx=low:砍輸送帶動畫(只留靜態幾何)
    rollers.forEach(r => r.rotation.z += dt * 2.5);
    parcels.forEach((p, i) => { p.position.x = -length / 2 + ((t * 0.7 + i * 1.9) % (length - 0.8)) + 0.4; p.rotation.y += dt * 0.55; });
  } });
  return g;
}

/* 中央出貨閘:分段壓縮門 + 回收環 + 箭頭 + 雙警示燈(北牆地標) */
function centralShippingGate() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(6.4, 4.4, 1.2), M.darkMetal(), 0, 2.2, 0));
  g.add(mesh(new THREE.BoxGeometry(5.4, 3.3, 0.22), M.metal(0x444c49), 0, 2.0, 0.68));
  for (let i = 0; i < 5; i++) {
    g.add(mesh(new THREE.BoxGeometry(5.0, 0.48, 0.12), M.metal(i % 2 ? 0x59615c : 0x323937), 0, 0.78 + i * 0.58, 0.84));
  }
  const ring = mesh(new THREE.TorusGeometry(0.72, 0.12, 8, 20), M.glow(0xd9a22f, 0.28), 0, 2.0, 0.95, false);
  ring.rotation.x = Math.PI / 2; g.add(ring);
  for (let i = 0; i < 3; i++) {
    const arrow = mesh(new THREE.BoxGeometry(0.6, 0.14, 0.08), M.glow(0xd9a22f, 0.24), -0.7 + i * 0.7, 3.65, 0.82, false);
    arrow.rotation.z = -0.45; g.add(arrow);
  }
  const lampL = mesh(new THREE.SphereGeometry(0.14, 8, 8), M.glow(0xff5c5c, 1.6), -2.7, 3.55, 0.75, false);
  const lampR = mesh(new THREE.SphereGeometry(0.14, 8, 8), M.glow(0x6dff9e, 1.6), 2.7, 3.55, 0.75, false);
  g.add(lampL, lampR);
  labAnimated.push({ update: (t, dt) => {
    ring.rotation.z += dt * 0.35;
    lampL.material.emissiveIntensity = (Math.sin(t * 3) > 0) ? 1.8 : 0.25;
    lampR.material.emissiveIntensity = (Math.sin(t * 3 + Math.PI) > 0) ? 1.8 : 0.25;
  } });
  return g;
}

/* 牆上警告牌(hazard 斜紋 + ⚠ + 符文;可指定色) */
function warningSign(color = 0xffc14f) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#181228'; g2.fillRect(0, 0, S, S);
  g2.save(); g2.beginPath(); g2.rect(8, 8, S - 16, S - 16); g2.clip();
  for (let i = -S; i < S * 2; i += 34) {
    g2.fillStyle = i / 34 % 2 ? '#e8a83c' : '#141020';
    g2.beginPath(); g2.moveTo(i, 0); g2.lineTo(i + 34, 0); g2.lineTo(i + 34 - S, S); g2.lineTo(i - S, S); g2.fill();
  }
  g2.restore();
  g2.fillStyle = '#181228'; g2.fillRect(34, 34, S - 68, S - 68);
  g2.strokeStyle = '#e8a83c'; g2.lineWidth = 6; g2.strokeRect(34, 34, S - 68, S - 68);
  g2.fillStyle = '#e8a83c'; g2.font = 'bold 110px serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText('⚠', S / 2, S / 2 - 14);
  g2.font = 'bold 26px monospace'; g2.fillText('ᛗᚨᚷᛁᚲ', S / 2, S / 2 + 62);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.8, side: THREE.DoubleSide }));
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6), M.darkMetal(), 0, 1.0, 0));
  m.position.y = 2.05; g.add(m); return g;
}

/* 靠牆裂玻璃板(emissive 裂痕貼圖) */
function crackedGlassPanel() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g2 = c.getContext('2d');
  g2.strokeStyle = 'rgba(190,230,255,0.8)'; g2.lineWidth = 2;
  const cx = S * 0.4 + Math.random() * S * 0.2, cy = S * 0.4 + Math.random() * S * 0.2;
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * 6.28 + Math.random() * 0.4;
    let x = cx, y = cy;
    g2.beginPath(); g2.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += Math.cos(a) * (20 + Math.random() * 20); y += Math.sin(a) * (20 + Math.random() * 20); g2.lineTo(x, y); }
    g2.stroke();
  }
  for (let r = 18; r < 70; r += 20) { g2.beginPath(); g2.arc(cx, cy, r + Math.random() * 8, Math.random() * 3, Math.random() * 3 + 2.5); g2.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05,
      emissiveMap: tex, emissive: 0xbfe6ff, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  const g = new THREE.Group(); m.position.y = 1.25; m.rotation.x = -0.1; g.add(m); return g;
}

/* --- 四座廢料處理站(火/冰/毒/雷;原型逐字,PointLight→decoLight) --- */
function fireStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 2.0, 0.5, 10), M.stone(0x33203a), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.9, 10), M.darkMetal(), 0, 0.95, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 10), M.metal(0x4a2f3a), 0, 1.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 10), M.glow(0xff7a2a, 2.2), 0, 1.85, 0, false));
  const flames = [];
  const fcols = [0xffd24f, 0xff8c2e, 0xff5c2a];
  for (let i = 0; i < 3; i++) {
    const f = mesh(new THREE.ConeGeometry(0.85 - i * 0.22, 1.9 - i * 0.35, 8),
      new THREE.MeshBasicMaterial({ color: fcols[i], transparent: true, opacity: 0.55 - i * 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
      0, 2.7 + i * 0.15, 0, false);
    flames.push(f); g.add(f);
  }
  const embers = [];
  for (let i = 0; i < 8; i++) {
    const e = mesh(new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb04f, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      (Math.random() - 0.5) * 1.2, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.2, false);
    embers.push(e); g.add(e);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10), M.metal(0x5a2f2a), 1.8, 0.7, 0.6));
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10), M.metal(0x5a2f2a), 1.8, 0.7, -0.6));
  const light = decoLight(0xff7a2a, 2.4, 12 * LAB_SCALE); if (light) { light.position.set(0, 3 * LAB_SCALE, 0); g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    flames.forEach((f, i) => {
      f.scale.set(1 + Math.sin(t * 9 + i) * 0.12, 1 + Math.sin(t * 11 + i * 2) * 0.18, 1 + Math.cos(t * 9 + i) * 0.12);
      f.rotation.y += dt * (1 + i * 0.5);
    });
    embers.forEach((e, i) => {
      e.position.y += dt * (0.8 + i * 0.1);
      e.material.opacity = Math.max(0, e.material.opacity - dt * 0.4);
      if (e.position.y > 4.4) { e.position.y = 2.1; e.position.x = (Math.random() - 0.5) * 1.2; e.position.z = (Math.random() - 0.5) * 1.2; e.material.opacity = 0.9; }
    });
    if (light) light.intensity = 2.0 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.25;
  } });
  return g;
}
function frostStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.4, 10), M.metal(0x2a3350), 0, 0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.6, 12), M.glass(0x9fe8ff, 0.3), 0, 1.9, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1.05, 0.5, 12), M.metal(0x3a4a70), 0, 3.4, 0));
  const frozen = mesh(new THREE.OctahedronGeometry(0.5), M.glow(0x9fe8ff, 0.8), 0, 1.9, 0, false);
  g.add(frozen);
  const crys = M.glass(0xbdf2ff, 0.5); crys.emissive = new THREE.Color(0x7fdcff); crys.emissiveIntensity = 0.6;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28, r = 1.4 + Math.random() * 0.8;
    const s = mesh(new THREE.ConeGeometry(0.22 + Math.random() * 0.18, 0.9 + Math.random() * 1.3, 5), crys,
      Math.cos(a) * r, 0.4, Math.sin(a) * r);
    s.rotation.z = (Math.random() - 0.5) * 0.9; s.rotation.x = (Math.random() - 0.5) * 0.9;
    g.add(s);
  }
  const mist = mesh(new THREE.TorusGeometry(1.9, 0.35, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    0, 0.35, 0, false);
  mist.rotation.x = Math.PI / 2; g.add(mist);
  const light = decoLight(0x7fdcff, 1.8, 11 * LAB_SCALE); if (light) { light.position.set(0, 2.5 * LAB_SCALE, 0); g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    frozen.rotation.y += dt * 0.15;
    frozen.material.emissiveIntensity = 0.6 + Math.sin(t * 1.2) * 0.3;
    mist.scale.setScalar(1 + Math.sin(t * 1.5) * 0.08);
    mist.material.opacity = 0.09 + Math.sin(t * 1.5) * 0.04;
    if (light) light.intensity = 1.6 + Math.sin(t * 1.8) * 0.3;
  } });
  return g;
}
function poisonStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 1.5, 2.2, 12), M.metal(0x2c3a2e), 0, 1.1, 0));
  const rim = mesh(new THREE.TorusGeometry(1.7, 0.16, 8, 16), M.darkMetal(), 0, 2.2, 0);
  rim.rotation.x = Math.PI / 2; g.add(rim);
  const liquid = mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.12, 12), M.glow(0x6dff5c, 1.8), 0, 2.18, 0, false);
  g.add(liquid);
  const bubbles = [];
  for (let i = 0; i < 7; i++) {
    const b = mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 8, 8), M.glow(0x8aff6d, 1.2),
      (Math.random() - 0.5) * 2.2, 2.25, (Math.random() - 0.5) * 2.2, false);
    b.userData.s = 0.4 + Math.random(); bubbles.push(b); g.add(b);
  }
  const pipe = mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.4, 8), M.metal(0x3a4a3a), 1.2, 3.3, 0);
  pipe.rotation.z = 0.5; g.add(pipe);
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.1, 8), M.metal(0x3a4a3a), 2.1, 3.9, 0));
  const spill = mesh(new THREE.CircleGeometry(2.6, 16),
    new THREE.MeshBasicMaterial({ color: 0x4fdd3c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    0.6, 0.035, 0.6, false);
  spill.rotation.x = -Math.PI / 2; g.add(spill);
  const light = decoLight(0x6dff5c, 1.7, 11 * LAB_SCALE); if (light) { light.position.set(0, 3.2 * LAB_SCALE, 0); g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    bubbles.forEach((b, i) => {
      const ph = (t * b.userData.s + i) % 2;
      b.position.y = 2.25 + ph * 0.35;
      b.scale.setScalar(Math.max(0.01, 1 - ph * 0.5));
    });
    liquid.material.emissiveIntensity = 1.5 + Math.sin(t * 2.6) * 0.4;
    if (light) light.intensity = 1.5 + Math.sin(t * 2.6) * 0.35;
  } });
  return g;
}
function lightningStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 10), M.darkMetal(), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.2, 10), M.metal(0x3a3260), 0, 2.6, 0));
  for (let i = 0; i < 4; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.85, 0.1, 8, 16), M.glow(0x9a6bff, 1.2), 0, 1.4 + i * 0.9, 0, false);
    ring.rotation.x = Math.PI / 2; g.add(ring);
    labAnimated.push({ update: t => { ring.material.emissiveIntensity = 0.8 + Math.sin(t * 5 - i * 1.2) * 0.7; } });
  }
  const orb = mesh(new THREE.SphereGeometry(0.6, 14, 14), M.glow(0xcaa8ff, 2.4), 0, 5.2, 0, false);
  g.add(orb);
  const rods = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * 6.28 + 0.4;
    const rod = mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.6, 6), M.metal(0x4a4080), Math.cos(a) * 2.3, 0.8, Math.sin(a) * 2.3);
    const tip = mesh(new THREE.SphereGeometry(0.15, 8, 8), M.glow(0xb58cff, 1.5), Math.cos(a) * 2.3, 1.7, Math.sin(a) * 2.3, false);
    rods.push(tip.position.clone()); g.add(rod); g.add(tip);
  }
  const arcMat = new THREE.LineBasicMaterial({ color: 0xd9c2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const arcs = rods.map(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, arcMat.clone()); g.add(line); return line;
  });
  const top = new THREE.Vector3(0, 5.2, 0);
  function boltPoints(a, b) {
    const pts = []; const N = 9;
    for (let i = 0; i <= N; i++) {
      const p = a.clone().lerp(b, i / N);
      if (i > 0 && i < N) { p.x += (Math.random() - 0.5) * 0.45; p.y += (Math.random() - 0.5) * 0.45; p.z += (Math.random() - 0.5) * 0.45; }
      pts.push(p);
    }
    return pts;
  }
  const light = decoLight(0xb58cff, 1.8, 13 * LAB_SCALE); if (light) light.position.set(0, 4.5 * LAB_SCALE, 0), g.add(light);
  let boltT = 0;
  labAnimated.push({ update: (t, dt) => {
    orb.material.emissiveIntensity = 2.0 + Math.sin(t * 6) * 0.8;
    orb.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    boltT -= dt;
    if (boltT <= 0) {
      boltT = 0.08 + Math.random() * 0.12;
      arcs.forEach((line, i) => {
        const on = Math.random() < 0.55;
        line.visible = on;
        if (on) line.geometry.setFromPoints(boltPoints(top, rods[i]));
      });
      if (light) light.intensity = 1.2 + Math.random() * 2.2;
    }
  } });
  return g;
}

/* ---------- 四角站「通電光環」(拉閘因果演出) ----------
   玩家反饋 2026-07:拉桿→四道電束太不自然 → 改成場邊四座大型處理站被「魔法光環」觸發:
   拉閘瞬間腳下亮起元素色光環 + 一圈擴散閃光(通電甦醒),armed 期間光環常駐=「機器活著」。
   開局(未拉閘)光環全暗;round reset(stationsArmed=false)自動熄。ramp 用幀數推進(免時鐘耦合);
   常駐態不脈動(對齊減閃爍方向),只有拉閘那一下的單次擴散閃光。 */
const powerHalos = [];         // { ring, flashRing, orb, ramp }
let stationsPowered = false;
function addPowerHalo(g, color) {
  const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const mk = (rIn, rOut) => new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 40), mat());
  const ring = mk(2.3, 3.1); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);       // 常駐光環(通電後亮;寬環=遠看得見)
  const flashRing = mk(2.2, 2.7); flashRing.rotation.x = -Math.PI / 2; flashRing.position.y = 0.12; g.add(flashRing); // 拉閘擴散閃光(單次)
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1.35, 18, 14), mat());                             // 站頂光暈球:高處的光不被牆擋,任何鏡頭角度都讀得到
  orb.position.y = 3.4; g.add(orb);
  powerHalos.push({ ring, flashRing, orb, ramp: 0 });
}
export function setStationsPowered(on) { stationsPowered = !!on; if (!on) for (const h of powerHalos) { h.ramp = 0; h.ring.material.opacity = 0; h.flashRing.material.opacity = 0; h.flashRing.scale.setScalar(1); h.orb.material.opacity = 0; } }
labAnimated.push({ update: () => {
  if (!stationsPowered) return;
  for (const h of powerHalos) {
    if (h.ramp < 1) {
      h.ramp = Math.min(1, h.ramp + 0.035);                                    // 幀推進 ~0.5s 通電
      const over = Math.sin(h.ramp * Math.PI);                                 // 過衝(甦醒感)
      h.ring.material.opacity = 0.75 * h.ramp + 0.25 * over;
      h.orb.material.opacity = 0.4 * h.ramp + 0.35 * over;
      const fs = 1 + h.ramp * 2.0;                                             // 擴散閃光:放大+淡出(單次)
      h.flashRing.scale.setScalar(fs); h.flashRing.material.opacity = 0.85 * (1 - h.ramp);
    } else { h.ring.material.opacity = 0.75; h.orb.material.opacity = 0.4; h.flashRing.material.opacity = 0; } // 常駐:靜態(不脈動)
  }
} });

/* ---------- LAB_LAYOUT(v2_10 place 編排;四角站 + 邊帶物流;原點=場地中心,單位=tile) ---------- */
function buildLabProps() {
  const HX = SCENE_W / 2, HZ = SCENE_D / 2;                    // 17 / 15(總場景半寬/半深)
  const NORTH_EDGE = -HZ + 1.65, SOUTH_EDGE = HZ - 1.65, WEST_EDGE = -HX + 1.65, EAST_EDGE = HX - 1.65;
  const HAZARD_X = CORE_HX - 1.15, HAZARD_Z = CORE_HZ + 2.0;   // 13.85 / 12(四角站)
  const place = (obj, x, z, ry = 0) => { obj.position.set(x, 0, z); obj.rotation.y = ry; labGroup.add(obj); return obj; };
  // 四角廢料處理站(採新四角站位)+ 通電光環(拉閘因果演出:玩家反饋 2026-07 電束不自然 → 改場邊大型機具「被魔法光環觸發」)
  addPowerHalo(place(fireStation(), -HAZARD_X, -HAZARD_Z, Math.PI * 0.25), 0xff7a2a);
  addPowerHalo(place(frostStation(), HAZARD_X, -HAZARD_Z, -Math.PI * 0.25), 0x78ddff);
  addPowerHalo(place(poisonStation(), -HAZARD_X, HAZARD_Z, -Math.PI * 0.2), 0xb06bff);
  addPowerHalo(place(lightningStation(), HAZARD_X, HAZARD_Z, 0), 0x9fd0ff);
  // 回收料斗(沿牆帶)
  place(recyclingHopper(0x5ff0e0, 'orb'), -5.7, NORTH_EDGE + 0.15, 0);
  place(recyclingHopper(0xff8ad0, 'crystal'), 5.7, NORTH_EDGE + 0.15, 0);
  place(recyclingHopper(0x8aff6d, 'cube'), WEST_EDGE + 0.15, -4.8, Math.PI / 2);
  place(recyclingHopper(0xb58cff, 'orb'), WEST_EDGE + 0.15, 4.8, Math.PI / 2);
  place(recyclingHopper(0x53c8ff, 'crystal'), EAST_EDGE - 0.15, -4.8, -Math.PI / 2);
  // 邊帶物流:壓實 / 廢料架 / UGC 展示(分揀台已移除——樣本水晶+瓶讀成舊魔法標本,與工業主題衝突)
  place(compactorUnit(), EAST_EDGE, 4.6, -Math.PI / 2);
  place(compactorUnit(), -8.7, SOUTH_EDGE, Math.PI);
  place(scrapRack(), 8.8, SOUTH_EDGE, Math.PI);
  place(scrapRack(), EAST_EDGE, 0, -Math.PI / 2);
  place(ugcDisplayCabinet(0xffc14f, 'panic'), -5.8, SOUTH_EDGE - 0.15, Math.PI);
  place(ugcDisplayCabinet(0x53e0ff, 'panic'), 5.4, SOUTH_EDGE - 0.15, Math.PI);
  place(ugcDisplayCabinet(0xb58cff, 'panic'), WEST_EDGE + 0.15, 0, Math.PI / 2);
  // 輸送帶(核心外)
  place(conveyorBelt(8.5, 0xd8a12f), -8.5, NORTH_EDGE + 0.05, 0);
  place(conveyorBelt(8.5, 0xb76531), 8.5, NORTH_EDGE + 0.05, 0);
  place(conveyorBelt(7.2, 0xd8a12f), WEST_EDGE + 0.12, 8.3, Math.PI / 2);
  // 中央出貨閘(北牆地標)
  place(centralShippingGate(), 0, -HZ + 0.82, 0);
  // 牆上警告牌
  [[-2, -HZ - 0.02, 0], [9, -HZ - 0.02, 0], [HX + 0.02, 8, -Math.PI / 2], [-HX - 0.02, -8, Math.PI / 2]].forEach(([x, z, ry]) => {
    const s = warningSign(); s.position.set(x, 2.1, z); s.rotation.y = ry; labGroup.add(s);
  });
  // 靠牆裂玻璃
  const cg1 = crackedGlassPanel(); cg1.position.set(-9.8, 1.25, -HZ + 0.45); cg1.rotation.x = -0.12; labGroup.add(cg1);
  const cg2 = crackedGlassPanel(); cg2.position.set(HX - 0.45, 1.25, -8.8); cg2.rotation.y = -Math.PI / 2; cg2.rotation.x = -0.1; labGroup.add(cg2);
  // 散落小箱(限邊帶,不污染 30×20 核心)
  for (let i = 0; i < 8; i++) {
    const side = Math.floor(Math.random() * 4); let x = 0, z = 0;
    if (side === 0) { x = (Math.random() - 0.5) * (SCENE_W - 5); z = -(CORE_HZ + 1.6 + Math.random() * 2.4); }
    if (side === 1) { x = (Math.random() - 0.5) * (SCENE_W - 5); z = (CORE_HZ + 1.6 + Math.random() * 2.4); }
    if (side === 2) { x = -(CORE_HX + 0.65 + Math.random() * 0.9); z = (Math.random() - 0.5) * (CORE_D - 2); }
    if (side === 3) { x = (CORE_HX + 0.65 + Math.random() * 0.9); z = (Math.random() - 0.5) * (CORE_D - 2); }
    const crate = mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.stone(0x343a36), x, 0.35, z);
    crate.rotation.y = Math.random() * Math.PI;
    const band = mesh(new THREE.BoxGeometry(0.74, 0.12, 0.74), M.glow(0xd8a12f, 0.20), 0, 0, 0, false);
    crate.add(band); labGroup.add(crate);
  }
  // 站腳處理區發光地環
  [[-HAZARD_X, -HAZARD_Z, 0xff7a2a], [HAZARD_X, -HAZARD_Z, 0x7fdcff], [-HAZARD_X, HAZARD_Z, 0x6dff5c], [HAZARD_X, HAZARD_Z, 0xb58cff]]
    .forEach(([x, z, c]) => {
      const d = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.0, 24),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      d.rotation.x = -Math.PI / 2; d.position.set(x, 0.04, z); labGroup.add(d);
      labAnimated.push({ update: t => { d.material.opacity = 0.16 + Math.sin(t * 2 + x) * 0.06; } });
    });
}

/* ---------- 飄浮魔塵(原型 atmosphere;Points 便宜,低效能也開) ---------- */
function buildLabDust() {
  const dustGeo = new THREE.BufferGeometry();
  const N = 260, pos = new Float32Array(N * 3), spd = [];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = CX + (Math.random() - 0.5) * SCENE_W * LAB_SCALE;
    pos[i * 3 + 1] = Math.random() * 8 * LAB_SCALE + 16;
    pos[i * 3 + 2] = CZ + (Math.random() - 0.5) * SCENE_D * LAB_SCALE;
    spd.push((0.1 + Math.random() * 0.25) * LAB_SCALE);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xb9a8ff, size: 0.09 * LAB_SCALE, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(dust);
  labAnimated.push({ update: (t, dt) => {
    const p = dust.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      p[i * 3 + 1] += spd[i] * dt;
      if (p[i * 3 + 1] > 9 * LAB_SCALE) p[i * 3 + 1] = 13;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  } });
}

/* ========== Phase 2:中央結構(v2_10 逐字移植;scene.add→labGroup.add、animated→labAnimated) ========== */

/* 中央「收容平台」:開口環甲板(不埋掉分揀陣列)+ 鋼領環 + 四液壓鎖 + 周緣螺栓 + 掃描柱燈 */
function buildCentralScannerDeck() {
  const g = new THREE.Group();
  const IN_R = 6.7, OUT_R = 7.28, DECK_H = 0.34, DECK_Y = DECK_H / 2;
  const deckMat = M.metal(0x343c3a);
  const topPlate = mesh(new THREE.RingGeometry(IN_R, OUT_R, 48), deckMat, 0, DECK_H, 0, false);
  topPlate.rotation.x = -Math.PI / 2; g.add(topPlate);
  const outWall = mesh(new THREE.CylinderGeometry(OUT_R, OUT_R, DECK_H, 48, 1, true), deckMat, 0, DECK_Y, 0, false);
  g.add(outWall);
  const inWall = mesh(new THREE.CylinderGeometry(IN_R, IN_R, DECK_H, 48, 1, true), M.darkMetal(), 0, DECK_Y, 0, false);
  inWall.material.side = THREE.BackSide; g.add(inWall);
  const ring1 = mesh(new THREE.TorusGeometry(6.72, 0.22, 10, 48), M.darkMetal(), 0, 0.38, 0); ring1.rotation.x = Math.PI / 2; g.add(ring1);
  const ring2 = mesh(new THREE.TorusGeometry(5.95, 0.12, 8, 48), M.metal(0x69716b), 0, 0.40, 0); ring2.rotation.x = Math.PI / 2; g.add(ring2);
  [[0, -6.25, 0], [6.25, 0, -Math.PI / 2], [0, 6.25, Math.PI], [-6.25, 0, Math.PI / 2]].forEach(([x, z, ry], i) => {
    const lock = new THREE.Group();
    lock.add(mesh(new THREE.BoxGeometry(1.45, 0.72, 0.95), M.darkMetal(), 0, 0.55, 0));
    lock.add(mesh(new THREE.BoxGeometry(1.15, 0.16, 1.0), M.glow(i === 0 ? 0xdca52e : 0x8a5b2e, 0.18), 0, 0.98, 0, false));
    const piston = mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.25, 8), M.metal(0x818983), 0, 0.76, -0.88); piston.rotation.x = Math.PI / 2; lock.add(piston);
    lock.position.set(x, 0, z); lock.rotation.y = ry; g.add(lock);
  });
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 8), M.metal(0x90968d), Math.cos(a) * 6.75, 0.47, Math.sin(a) * 6.75));
  }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const post = mesh(new THREE.BoxGeometry(0.32, 1.65, 0.32), M.darkMetal(), Math.cos(a) * 5.4, 0.98, Math.sin(a) * 5.4); g.add(post);
    const lamp = mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), M.glow(0xdca52e, 0.38), Math.cos(a) * 5.4, 1.86, Math.sin(a) * 5.4, false); g.add(lamp);
    labAnimated.push({ update: t => { lamp.material.emissiveIntensity = 0.14 + (Math.sin(t * 2.2 + i * 1.2) > 0.55 ? 0.55 : 0.08); } });
  }
  g.scale.setScalar(CENTER_SCALE); // 整體縮小(順帶壓低掃描柱高度,減少擋視線)
  labGroup.add(g);
  _oldPodDeck = g;                                               // GLB 底座載成後拆
}

/* ---------- 中央回收艙底座 GLB(使用者資產 assets/scene/recycling-pod.glb;2026-07 換掉程序化底座) ----------
   Cosmic Recycling Wheel:直立輪 → 轉平沉入地面近齊平(微凸 ~4px=地板嵌件,玩家走進艙不穿模;
   使用者拍板)。載入成功=移除舊程序化件(分揀陣列貼圖+環甲板/液壓鎖/掃描柱);失敗=保留舊底座(graceful)。
   離線已 gltf-transform 解 Draco+simplify(80.7k→32.8k tris)+quantize(838KB)——遊戲端零解碼成本。 */
let _oldPodDecal = null, _oldPodDeck = null, _podGlbReady = false;
function loadPodGlb() {
  if (!THREE.GLTFLoader) { console.warn('[lab] GLTFLoader 未載入,保留程序化底座'); return; }
  fetch('assets/scene/recycling-pod.glb')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
    .then(gltf => {
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } }); // 嵌地件不投影
      root.rotation.x = -Math.PI / 2;                            // 素材=直立輪 → 轉平(碟面朝上)
      root.scale.setScalar(5.44 / 1.9);                          // 目標直徑 5.44 lab units(≈174px,對齊原分揀陣列)
      // 沉入基準=「主盤面」而非最高點(輪頂不平:中央轂尖 z≈0.264、盤面 p90 z≈0.167 實測)——
      // 用 bbox.max 會把整個盤面埋進地下只露轂尖。盤面微凸 +0.125 units(≈4px),中央轂凸 ~13px 當艙心凸飾。
      const FACE_Z = 0.167;                                      // 盤面高(原始單位,頂點分佈 p90 實測)
      root.position.set(0, 0.125 - FACE_Z * (5.44 / 1.9), 0);
      labGroup.add(root);
      if (_oldPodDecal) { _oldPodDecal.removeFromParent(); _oldPodDecal = null; } // 拆分揀陣列貼圖(被輪盤蓋住)
      // 舊環甲板保留(使用者反饋 2026-07:加回更立體)——輪盤 r2.72 / 甲板 r4.56-4.95 不重疊,分層:輪盤嵌件→符文環帶→金屬甲板
      buildRuneRing();                                                            // 符文環帶填輪盤與甲板之間的地面
      _podGlbReady = true;
      if (renderer) renderer.compile(scene, camera); // perf-1 預熱:GLB 換裝的新材質就地預編譯(否則首次入鏡才編譯=初始移動卡頓的第二刀)
      console.log('[lab] 回收艙 GLB 底座就位');
    })
    .catch(e => console.warn('[lab] 回收艙 GLB 載入失敗,保留程序化底座', e));
}

/* ---------- 符文環帶(使用者反饋 2026-07:回收艙地面要更多魔法符文感) ----------
   填 GLB 輪盤(r≈2.72 units)與舊環甲板(內緣 r≈4.56)之間的地面:程序化符文(索引種子=確定性,
   免每次載入長不同)+ 雙層反向緩轉(轉動=魔法陣活著;非閃爍,不違背減閃爍方向)。additive+
   toneMapped:false 保色。 */
function makeRuneRingTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2, cy = S / 2;
  const rand = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); }; // 索引種子
  // 內外細圈
  g.strokeStyle = 'rgba(236,198,94,0.9)'; g.lineWidth = 4;
  g.beginPath(); g.arc(cx, cy, 490, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(178,124,255,0.7)'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 345, 0, Math.PI * 2); g.stroke();
  // 24 格符文(每格 2-4 筆程序化筆畫,朝外站立;琥珀/紫交替)
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * 418, cy + Math.sin(a) * 418); g.rotate(a + Math.PI / 2);
    g.strokeStyle = i % 2 ? 'rgba(255,190,80,0.95)' : 'rgba(190,140,255,0.95)';
    g.lineWidth = 7; g.lineCap = 'round';
    const strokes = 2 + Math.floor(rand(i, 0) * 3);
    for (let k = 0; k < strokes; k++) {
      g.beginPath();
      g.moveTo((rand(i, k * 4 + 1) - 0.5) * 44, (rand(i, k * 4 + 2) - 0.5) * 60);
      g.lineTo((rand(i, k * 4 + 3) - 0.5) * 44, (rand(i, k * 4 + 4) - 0.5) * 60);
      if (rand(i, k * 4 + 5) > 0.5) g.lineTo((rand(i, k * 4 + 6) - 0.5) * 44, (rand(i, k * 4 + 7) - 0.5) * 60);
      g.stroke();
    }
    g.restore();
    // 格間徑向刻度
    const ta = (i + 0.5) / N * Math.PI * 2;
    g.strokeStyle = 'rgba(232,220,181,0.6)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + Math.cos(ta) * 358, cy + Math.sin(ta) * 358);
    g.lineTo(cx + Math.cos(ta) * 386, cy + Math.sin(ta) * 386); g.stroke();
  }
  // 錨點小圓(雙色交替,呼應舊儀式錨點語彙)
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const px = cx + Math.cos(a) * 470, py = cy + Math.sin(a) * 470;
    g.fillStyle = i % 2 ? 'rgba(255,149,38,0.95)' : 'rgba(168,124,255,0.95)';
    g.beginPath(); g.arc(px, py, 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(242,228,186,0.8)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(px, py, 14, 0, Math.PI * 2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; return tex;
}
function makeDashRingTexture() { // 內側虛線圈(反向轉,做出雙層深度)
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(158,100,230,0.85)'; g.lineWidth = 7; g.setLineDash([26, 20]);
  g.beginPath(); g.arc(S / 2, S / 2, 226, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; return tex;
}
function makePodBaseTexture() { // 艙底盤面:放射漸層(中心暗紫→邊緣深灰,融入實驗室地板)+ 細同心刻紋
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, '#1c1526');   // 中心:暗紫(魔法感)
  grad.addColorStop(0.62, '#151a20');
  grad.addColorStop(1, '#10151a');   // 邊緣:融入場景暗地板
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cx, cx, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(120,110,150,0.14)'; g.lineWidth = 2;              // 細同心刻紋(避免死平)
  for (const r of [120, 176, 226]) { g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; return tex;
}
function buildRuneRing() {
  // 艙底盤面(使用者反饋 2026-07:符文縫隙透出原始地磚):不透明深盤墊在最底,蓋住地磚格線。
  // 高度卡位:y=0.4 —— 壓住地磚(y=0)、但在地板化學 tile(y=0.6)之下 → 艙內冰面/油膜等玩法資訊照常顯示。
  // 形狀=環形非滿盤(使用者反饋:滿盤在 y=0.4 會蓋掉輪盤面 y=0.125,中心回收標誌消失)——
  // 內徑 2.55 塞進輪盤(r2.72)石緣底下無縫、外徑 4.75 伸到甲板內緣下;輪盤中心從洞露出。
  const base = new THREE.Mesh(new THREE.RingGeometry(2.55 * LAB_SCALE, 4.75 * LAB_SCALE, 56),
    new THREE.MeshStandardMaterial({ map: makePodBaseTexture(), roughness: 0.85, metalness: 0.25 }));
  base.rotation.x = -Math.PI / 2; base.position.set(CX, 0.4, CZ); base.receiveShadow = true; scene.add(base);
  const mkPlane = (tex, size, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(CX, y, CZ); scene.add(m); return m;
  };
  const runes = mkPlane(makeRuneRingTexture(), 9.2 * LAB_SCALE, 1.6);          // 符文帶(外)
  const dashes = mkPlane(makeDashRingTexture(), 6.4 * LAB_SCALE, 1.3);         // 虛線圈(內)
  labAnimated.push({ update: (t) => { runes.rotation.z = t * 0.05; dashes.rotation.z = -t * 0.085; } }); // 雙層反向緩轉(魔法陣活著;非閃爍)
}

// (四色箭頭 SORTING_DIRS/buildSortingRoutes 與「THROW IN!」牌 loadSignGlb 已於 2026-07-19 拆除——使用者反饋突兀)

/* 地面模板字(dashed 框 + 標題 + 副標;回傳一片朝上的貼圖平面) */
function makeFloorStencil(text, sub = '', color = '#d7a12e', w = 5.2, h = 1.1) {
  const CW = 1024, CH = 220, c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  g.clearRect(0, 0, CW, CH);
  g.strokeStyle = color; g.lineWidth = 8; g.setLineDash([28, 18]); g.strokeRect(16, 16, CW - 32, CH - 32); g.setLineDash([]);
  g.fillStyle = color; g.globalAlpha = 0.82; g.font = '900 76px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, CW / 2, 86);
  if (sub) { g.globalAlpha = 0.58; g.font = '700 32px Consolas, monospace'; g.fillText(sub, CW / 2, 158); }
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.76, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; return m;
}

/* 工業地標:掃描台周圍安全斑馬框 + 四塊制式地面標語(WIZARD INTAKE / NO MANUAL SORTING / ZONE) */
function buildIndustrialFloorMarkings() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xd5a22f, transparent: true, opacity: 0.34, depthWrite: false });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0x171b1a, transparent: true, opacity: 0.82, depthWrite: false });
  const stripeCount = 18;
  for (let i = 0; i < stripeCount; i++) {
    const a = i / stripeCount * Math.PI * 2, r = 7.78 * CENTER_SCALE; // 隨收容平台一起縮
    const bar = mesh(new THREE.BoxGeometry(0.52, 0.025, 1.05), i % 2 ? mat : stripeMat, Math.cos(a) * r, 0.055, Math.sin(a) * r, false);
    bar.rotation.y = -a; labGroup.add(bar);
  }
  const stencils = [
    ['WIZARD INTAKE', 'CLASSIFY BEFORE DISPOSAL', 0, -8.7, 0],
    ['NO MANUAL SORTING', 'USE APPROVED FORCE', 0, 8.65, Math.PI],
    ['ZONE 01', 'MOLTEN', -11.2, -7.8, Math.PI / 2],
    ['ZONE 03', 'CHARGED', 11.2, 7.8, -Math.PI / 2],
  ];
  stencils.forEach(([t, sub, x, z, ry]) => {
    const d = makeFloorStencil(t, sub, '#d7a12e', 5.4, 1.18); d.position.set(x, 0.066, z); d.rotation.z = ry; labGroup.add(d);
  });
}

/* 30×20 淨戰區導引(純視覺,無碰撞):琥珀虛線框 + 四角 L 記號 + 極淡暖色底 */
function buildCoreCombatGuide() {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector3(-CORE_HX, 0.065, -CORE_HZ), new THREE.Vector3(CORE_HX, 0.065, -CORE_HZ),
    new THREE.Vector3(CORE_HX, 0.065, CORE_HZ), new THREE.Vector3(-CORE_HX, 0.065, CORE_HZ),
  ];
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xd5a22f, transparent: true, opacity: 0.30, blending: THREE.NormalBlending })
  );
  g.add(line);
  const cornerMat = M.glow(0xd5a22f, 0.28);
  const lx = 1.45, thick = 0.08;
  [[-CORE_HX, -CORE_HZ, 1, 1], [CORE_HX, -CORE_HZ, -1, 1], [CORE_HX, CORE_HZ, -1, -1], [-CORE_HX, CORE_HZ, 1, -1]].forEach(([x, z, sx, sz]) => {
    g.add(mesh(new THREE.BoxGeometry(lx, 0.035, thick), cornerMat, x + sx * lx / 2, 0.08, z, false));
    g.add(mesh(new THREE.BoxGeometry(thick, 0.035, lx), cornerMat, x, 0.08, z + sz * lx / 2, false));
  });
  const coreTint = new THREE.Mesh(
    new THREE.PlaneGeometry(CORE_W, CORE_D),
    new THREE.MeshBasicMaterial({ color: 0xc8952b, transparent: true, opacity: 0.018, blending: THREE.NormalBlending, depthWrite: false })
  );
  coreTint.rotation.x = -Math.PI / 2; coreTint.position.y = 0.045; g.add(coreTint);
  labAnimated.push({ update: t => {
    line.material.opacity = 0.22 + Math.max(0, Math.sin(t * 1.2)) * 0.12;
    cornerMat.emissiveIntensity = 0.18 + Math.max(0, Math.sin(t * 1.2)) * 0.16;
  } });
  labGroup.add(g);
}

/* ---------- 每幀更新(facade render3D 呼叫;dt 由 t 差分) ---------- */
// 減閃爍(玩家反饋:光汙染傷眼):凍結動畫時鐘 → 所有 sin(t) 脈動光固定在單一亮度;
// dt 照常傳 → 純運動(魔塵/氣泡/旋轉)不受影響。雷電弧另在自己的 updater 裡讀這旗標。
export let LOW_FLICKER = false;
export function setLabFlicker(low) { LOW_FLICKER = low; }
/* ---------- 收容演出:玻璃罩+掃描環(v2.js 每幀 setPodPerform 驅動;sim 不 import render)----------
   使用者拍板:透明玻璃罩罩住被收容者。FX_LOW 降級成純透明殼(transmission 太貴,SwiftShader/低端跑不動)。
   相位:capture=罩升起 / struggle=晃罩(掙扎)/ scan=掃描環頭→腳 / classify+resolve(n≥2)=紅燈 / resolve(n≤2)=開罩縮+淡出。 */
let _domeGrp = null, _domeShell = null, _domeRim = null, _scanRing = null, _domeShown = false;
const DOME_R = 56; // 世界px;同 v2-state PERFORM_DOME_R(sim/render 不互 import,常數各持一份,改要同步)
function ensurePodDome() {
  if (_domeGrp) return;
  _domeGrp = new THREE.Group(); _domeGrp.position.set(CX, 0, CZ); _domeGrp.visible = false; scene.add(_domeGrp);
  // 殼=加法混色(不走 transmission:SwiftShader/深色地板上幾乎隱形);玻璃感靠緯線蝕刻+底圈+頂部反光點
  const glass = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  _domeShell = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  _domeGrp.add(_domeShell);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false });
  for (const hRatio of [0.35, 0.62, 0.84]) {               // 三圈緯線蝕刻(力場玻璃的讀形線)
    const rr = DOME_R * Math.sqrt(1 - hRatio * hRatio);
    const lat = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.9, 6, 40), lineMat);
    lat.rotation.x = Math.PI / 2; lat.position.y = DOME_R * hRatio; _domeGrp.add(lat);
  }
  const glint = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }));
  glint.position.set(-DOME_R * 0.28, DOME_R * 0.9, -DOME_R * 0.22); _domeGrp.add(glint); // 頂部反光點(定住「有一片玻璃」)
  _domeRim = new THREE.Mesh(new THREE.TorusGeometry(DOME_R, 3, 8, 56), new THREE.MeshBasicMaterial({ color: 0x4dffcf, transparent: true, opacity: 0.95, toneMapped: false }));
  _domeRim.rotation.x = Math.PI / 2; _domeRim.position.y = 3; _domeGrp.add(_domeRim);
  _scanRing = new THREE.Mesh(new THREE.TorusGeometry(DOME_R * 0.7, 1.5, 8, 40), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }));
  _scanRing.rotation.x = Math.PI / 2; _scanRing.visible = false; _domeGrp.add(_scanRing);
}
export function setPodPerform(p) {
  if (!p) { if (_domeShown) { _domeGrp.visible = false; _domeShown = false; } return; }
  ensurePodDome(); _domeGrp.visible = true; _domeShown = true;
  const failing = p.n >= 2 && (p.phase === 'classify' || p.phase === 'resolve');
  _domeRim.material.color.setHex(failing ? 0xff5a4a : 0x4dffcf);
  let sy = 1, jx = 0, jz = 0, op = 1;
  if (p.phase === 'capture') sy = 0.12 + 0.88 * p.pk;                                     // 罩升起
  if (p.phase === 'struggle' && !LOW_FLICKER) { jx = Math.sin(p.pk * 44) * 2.2; jz = Math.cos(p.pk * 37) * 2.2; } // 掙扎晃罩(pk 驅動=hitstop 自然凍結;減閃爍關掉)
  if (p.phase === 'resolve' && p.n <= 2) { sy = Math.max(0.05, 1 - p.pk * 1.15); op = Math.max(0, 1 - p.pk * 1.3); } // 開罩:縮+淡出
  _domeGrp.scale.set(1, Math.max(0.05, sy), 1); _domeGrp.position.set(CX + jx, 0, CZ + jz);
  _domeShell.material.opacity = 0.14 * op; _domeRim.material.opacity = 0.95 * op;
  for (const ch of _domeGrp.children) if (ch !== _domeShell && ch !== _domeRim && ch !== _scanRing) ch.material.opacity = (ch.geometry.type === 'SphereGeometry' ? 0.85 : 0.5) * op; // 緯線+反光點跟著淡出
  _scanRing.visible = p.phase === 'scan';
  if (p.phase === 'scan') _scanRing.position.y = (DOME_R * 0.9 * (1 - p.pk) + 4) / Math.max(0.05, sy); // 掃描環頭→腳(除以 sy 抵銷 group 縮放)
}

window.__lab = { labGroup, labAnimated, flicker: () => LOW_FLICKER, floorFx: () => floorFxGroup, stationsPowered: () => stationsPowered, podGlbReady: () => _podGlbReady, frostBottleReady: () => frostBottleReady(), barrelReady: () => barrelReady(), fireHatReady: () => fireHatReady(), domeVisible: () => _domeShown, fxLow: () => FX_LOW }; // debug hook(headless 測試用)
let _lastT = 0;
export function updateLabScene(t) {
  const dt = Math.min(Math.max(t - _lastT, 0), 0.05); _lastT = t;
  const ta = LOW_FLICKER ? 1.7 : t; // 凍結的動畫時鐘(任選相位)
  for (const a of labAnimated) a.update(ta, dt);
}
