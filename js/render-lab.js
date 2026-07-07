// render-lab.js — v2 魔法實驗室場景(復刻使用者的 arcane containment 原型,非換皮):
// 完整採用原型的渲染管線 —— MeshStandard + emissive 貼圖(真自發光)、ACES 電影調色、
// sRGB 輸出、PCFSoft 陰影、局部點光源。只在 v2.html 啟用(每頁獨立 renderer,單機零影響)。
// 原型單位:1 unit = 1 tile;我們的世界:1 tile = 32px → 一律乘 LAB_SCALE 換算,
// builder 幾乎逐字移植。碰撞/模擬完全不動(牆的碰撞仍在 30×20 核心邊界)。
import { W, H, TILE } from './constants.js';
import { renderer, scene } from './render-core.js';

const LAB_SCALE = TILE;                 // 1 原型單位 = 32 世界px
const CX = W / 2, CZ = H / 2;           // 場地中心(世界px)
const SCENE_W = 34, SCENE_D = 30;       // 總場景(tiles) — 牆外含裝飾帶
const CORE_W = 30, CORE_D = 20;         // 戰鬥核心區(tiles) = 現行模擬場地(=W/H)
export const LAB = { SCENE_W, SCENE_D, CORE_W, CORE_D, CX, CZ, S: LAB_SCALE };

// 低效能模式(?fx=low):關陰影/剝裝飾性點光/關玻璃 transmission(額外整景渲染 pass)。
// SwiftShader headless 測試與低階機用;觀感主體(emissive/ACES/additive)全保留。
export const FX_LOW = new URLSearchParams(location.search).get('fx') === 'low';
export const labAnimated = [];          // { update(t, dt) } — updateLabScene 每幀跑
let labBuilt = false;

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
  dirs.forEach((d,i)=>{
    const x1=cx+Math.cos(d.a)*150, y1=cy+Math.sin(d.a)*150;
    const x2=cx+Math.cos(d.a)*410, y2=cy+Math.sin(d.a)*410;
    g.strokeStyle=d.c; g.lineWidth=20; g.globalAlpha=0.18;
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
    g.globalAlpha=0.9;
    // arrow head
    g.save(); g.translate(x2,y2); g.rotate(d.a);
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
    const pl = new THREE.PointLight(c, 0.95, 11 * LAB_SCALE, 2);
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

  // 中央分揀陣列(收容艙腳下)+ 琥珀點光。不旋轉 —— 四向元素導軌箭頭要固定指向四方,轉了就錯位。
  const circleMat = new THREE.MeshBasicMaterial({
    map: makeCircleTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, opacity: 0.95,
  });
  const magicCircle = new THREE.Mesh(new THREE.PlaneGeometry(8 * LAB_SCALE, 8 * LAB_SCALE), circleMat); // 原型 13 units;我們的鏡頭近,縮到 8 才不搶戲
  magicCircle.rotation.x = -Math.PI / 2; magicCircle.position.set(CX, 1, CZ);
  scene.add(magicCircle);
  const circleGlow = new THREE.PointLight(0xffb43a, 1.85, 15 * LAB_SCALE, 2); // v2_10 琥珀(原紫 0x9a5cff)
  circleGlow.position.set(CX, 1.4 * LAB_SCALE, CZ); scene.add(circleGlow);
  scene.add(labGroup);
  buildLabWalls();
  buildLabEnergyTubes();
  buildLabProps();
  buildLabDust();
  labAnimated.push({ update: (t) => {                       // 溫和呼吸,不旋轉
    circleMat.opacity = 0.58 + Math.sin(t * 1.1) * 0.08;
    circleGlow.intensity = 1.6 + Math.max(0, Math.sin(t * 1.1)) * 0.6;
  } });
}

/* ---------- 原型材質庫(牆/柱/管用;MeshStandard) ---------- */
const M = {
  metal: (c = 0x2b2545) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.8 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x1c1832, roughness: 0.5, metalness: 0.85 }),
  stone: (c = 0x241e3e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.1 }),
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
      const p = mesh(new THREE.BoxGeometry(seg * 0.96, 0.44, 0.6), M.stone(0x201a38), 0, 0.22, 0);
      p.scale.y = 0.9 + ((i * 7 + sideIndex * 3) % 5) * 0.06;  // 沿用舊牆板的高低參差
      const trim = mesh(new THREE.BoxGeometry(seg * 0.96, 0.1, 0.22), M.glow(0x7a4dff, 1.2), 0, 0.47 * p.scale.y, 0, false);
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
    const cap = mesh(capG, M.metal(0x352c58), x, 1.24, z);
    const orb = mesh(new THREE.SphereGeometry(0.3, 12, 12), M.glow(0xb08cff, 2), x, 1.62, z, false);
    labAnimated.push({ update: t => { orb.material.emissiveIntensity = 1.6 + Math.sin(t * 2 + x + z) * 0.6; } });
    wall.add(pil); wall.add(cap); wall.add(orb);
  });
  labGroup.add(wall);
}
/* ---------- 能量管(原型 buildEnergyTubes;沿牆基內側) ---------- */
function buildLabEnergyTubes() {
  const colors = [0x53e0ff, 0x8a5cff, 0x6dff9e, 0xffa14f];
  const offX = WALL_HX - 0.6, offZ = WALL_HZ - 0.6;
  function addTube(length, x, z, rotY, color, phase) {
    const tube = mesh(new THREE.CylinderGeometry(0.13, 0.13, length, 10), M.glow(color, 1.4), 0, 0, 0, false);
    tube.rotation.z = Math.PI / 2;
    const g = new THREE.Group(); g.add(tube);
    g.rotation.y = rotY;
    g.position.set(x, 0.5, z);
    labGroup.add(g);
    labAnimated.push({ update: t => { tube.material.emissiveIntensity = 1.1 + Math.sin(t * 3 + phase) * 0.5; } });
  }
  addTube(CORE_W - 4, 0, -offZ, 0, colors[0], 0.0);
  addTube(CORE_D - 4, -offX, 0, Math.PI / 2, colors[1], 1.7);
  addTube(CORE_W - 4, 0, offZ, Math.PI, colors[2], 3.4);
  addTube(CORE_D - 4, offX, 0, -Math.PI / 2, colors[3], 5.1);
}
/* ==========================================================================
   帶區裝飾 —— 模組化:下面全是純 builder(回傳 Group,原型逐字移植),
   佈置由 LAB_LAYOUT 編排表決定(改佈局=改表;單位=tile,原點=場地中心)。
   預設編排原則:南帶是鏡頭前景 → 只放矮件;四座元素站在北帶(牆後露出,
   景深最佳);水槽/高傢俱進東西帶。
   ========================================================================== */
M.glass = (c = 0x7fe8ff, o = 0.22) => new THREE.MeshPhysicalMaterial({
  color: c, transparent: true, opacity: o, roughness: 0.05, metalness: 0,
  transmission: FX_LOW ? 0 : 0.6, emissive: c, emissiveIntensity: 0.08, side: THREE.DoubleSide });
M.wood = () => new THREE.MeshStandardMaterial({ color: 0x3a2b3f, roughness: 0.85 });

// 裝飾性點光:低效能模式不建(氛圍主力=emissive/貼花;點光是加分項)。回傳可能為 null,動畫端判空。
function decoLight(color, intensity, dist, decay = 2) {
  if (FX_LOW) return null;
  return new THREE.PointLight(color, intensity, dist, decay);
}
function groundDecal(g, color, r = 2.8) { // 站台腳下的發光環貼花(各站自帶,顏色=站的元素色)
  const d = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r + 0.2, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d);
  labAnimated.push({ update: t => { d.material.opacity = 0.25 + Math.sin(t * 2 + g.position.x) * 0.12; } });
}

function containmentTank(color = 0x5ff0e0, specimen = 'orb') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.5, 14), M.darkMetal(), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.8, 14), M.glass(color), 0, 2.0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.0, 0.45, 14), M.metal(), 0, 3.55, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8), M.glow(color, 1.5), 0, 4.1, 0, false));
  const core = mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.5, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 2.0, 0, false);
  g.add(core);
  let sp;
  if (specimen === 'orb') sp = mesh(new THREE.SphereGeometry(0.42, 14, 14), M.glow(color, 1.2), 0, 2, 0, false);
  if (specimen === 'cube') sp = mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), M.glow(color, 1.1), 0, 2, 0, false);
  if (specimen === 'crystal') sp = mesh(new THREE.OctahedronGeometry(0.45), M.glow(color, 1.3), 0, 2, 0, false);
  g.add(sp);
  const bubbles = [];
  for (let i = 0; i < 5; i++) {
    const b = mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 2.4, (Math.random() - 0.5) * 1.2, false);
    bubbles.push(b); g.add(b);
  }
  const light = decoLight(color, 0.9, 6 * LAB_SCALE); if (light) { light.position.y = 2.2; g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    sp.position.y = 2 + Math.sin(t * 1.3 + g.position.x) * 0.25;
    sp.rotation.y += dt * 0.8;
    bubbles.forEach(b => { b.position.y += dt * 0.7; if (b.position.y > 3.3) b.position.y = 0.8; });
    if (light) light.intensity = 0.75 + Math.sin(t * 2.2 + g.position.z) * 0.2;
  } });
  return g;
}
function alchemyTable() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(3.4, 0.25, 1.5), M.wood(), 0, 1.15, 0));
  [[-1.4, -0.55], [1.4, -0.55], [-1.4, 0.55], [1.4, 0.55]].forEach(([x, z]) =>
    g.add(mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), M.darkMetal(), x, 0.55, z)));
  const cols = [0x6dff9e, 0xff77e0, 0x53c8ff, 0xffb84f];
  for (let i = 0; i < 4; i++) {
    const col = cols[i];
    const fx = -1.2 + i * 0.8, fz = (i % 2 ? 0.3 : -0.25);
    g.add(mesh(new THREE.SphereGeometry(0.22, 10, 10), M.glass(col, 0.5), fx, 1.5, fz, false));
    const liquid = mesh(new THREE.SphereGeometry(0.15, 8, 8), M.glow(col, 1.5), fx, 1.44, fz, false);
    g.add(liquid);
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), M.glass(col, 0.4), fx, 1.78, fz, false));
    labAnimated.push({ update: t => { liquid.material.emissiveIntensity = 1.2 + Math.sin(t * 3 + i * 2) * 0.5; } });
  }
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), M.glow(0xc9b8ff, 0.35), 1.1, 1.32, 0.3));
  const l2 = decoLight(0x8affc0, 0.6, 4 * LAB_SCALE); if (l2) { l2.position.set(0, 1.9, 0); g.add(l2); }
  return g;
}
function bookshelf() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6, 3.4, 0.8), M.wood(), 0, 1.7, 0));
  const cols = [0x6b4f8f, 0x3f5f8a, 0x8a3f5f, 0x4f8a6b, 0x8a7a3f];
  for (let row = 0; row < 3; row++) {
    g.add(mesh(new THREE.BoxGeometry(2.3, 0.08, 0.7), M.darkMetal(), 0, 0.9 + row * 0.95, 0.02));
    let x = -1.0;
    while (x < 1.0) {
      const w2 = 0.14 + Math.random() * 0.12, h2b = 0.55 + Math.random() * 0.25;
      const b = mesh(new THREE.BoxGeometry(w2, h2b, 0.5), M.stone(cols[Math.floor(Math.random() * cols.length)]), x, 0.95 + row * 0.95 + h2b / 2, 0.05);
      if (Math.random() < 0.15) b.rotation.z = 0.12;
      g.add(b); x += w2 + 0.05;
    }
  }
  const tome = mesh(new THREE.BoxGeometry(0.2, 0.6, 0.5), M.glow(0xff6db0, 1.4), 0.6, 2.35, 0.06, false);
  g.add(tome);
  labAnimated.push({ update: t => { tome.material.emissiveIntensity = 1.0 + Math.sin(t * 1.8) * 0.6; } });
  return g;
}
function machinery() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6, 2.2, 1.6), M.darkMetal(), 0, 1.1, 0));
  g.add(mesh(new THREE.BoxGeometry(2.8, 0.3, 1.8), M.metal(), 0, 2.35, 0));
  const screen = mesh(new THREE.PlaneGeometry(1.4, 0.8), M.glow(0x53e0ff, 1.1), 0, 1.5, 0.82, false);
  g.add(screen);
  for (let i = 0; i < 3; i++) {
    const d = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), M.glow([0xff5c5c, 0xffc14f, 0x6dff9e][i], 1.6), -0.8 + i * 0.8, 0.7, 0.82, false);
    d.rotation.x = Math.PI / 2; g.add(d);
    labAnimated.push({ update: t => { d.material.emissiveIntensity = (Math.sin(t * 4 + i * 2.1) > 0.3) ? 1.8 : 0.35; } });
  }
  const pipe = mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 16, Math.PI), M.metal(0x453a6e), 0.7, 2.5, 0);
  pipe.rotation.z = Math.PI; g.add(pipe);
  labAnimated.push({ update: t => { screen.material.emissiveIntensity = 0.9 + Math.sin(t * 7) * 0.15; } });
  return g;
}
function displayCabinet(color, trophy) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.9, 1.6), M.darkMetal(), 0, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(1.35, 1.5, 1.35), M.glass(color, 0.16), 0, 1.65, 0, false));
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.2, 1.6), M.metal(), 0, 2.5, 0));
  let item;
  if (trophy === 'skull') {
    item = new THREE.Group();
    item.add(mesh(new THREE.SphereGeometry(0.32, 10, 10), M.stone(0xcfc7e8), 0, 0.1, 0, false));
    item.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.25), M.stone(0xcfc7e8), 0, -0.15, 0.08, false));
  } else if (trophy === 'sword') {
    item = new THREE.Group();
    item.add(mesh(new THREE.BoxGeometry(0.08, 1.0, 0.02), M.glow(color, 0.9), 0, 0.15, 0, false));
    item.add(mesh(new THREE.BoxGeometry(0.4, 0.07, 0.07), M.metal(0x6e5a9e), 0, -0.3, 0, false));
  } else {
    item = mesh(new THREE.IcosahedronGeometry(0.35), M.glow(color, 1.5), 0, 0, 0, false);
  }
  item.position.y = 1.55; g.add(item);
  const l2 = decoLight(color, 0.7, 4 * LAB_SCALE); if (l2) { l2.position.y = 2.1; g.add(l2); }
  labAnimated.push({ update: (t, dt) => { item.rotation.y += dt * 0.9; item.position.y = 1.55 + Math.sin(t * 1.5) * 0.08; } });
  return g;
}
function warningSign() {
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
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6), M.darkMetal(), 0, 1.0, 0)); // 立牌支柱(高牆拆除後改自立)
  m.position.y = 2.05; g.add(m); return g;
}
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
/* --- 四座元素實驗站(火/冰/毒/雷;原型逐字) --- */
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
  const light = decoLight(0xff7a2a, 2.4, 12 * LAB_SCALE); if (light) { light.position.set(0, 3, 0); g.add(light); }
  groundDecal(g, 0xff7a2a);
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
  const light = decoLight(0x7fdcff, 1.8, 11 * LAB_SCALE); if (light) { light.position.set(0, 2.5, 0); g.add(light); }
  groundDecal(g, 0x7fdcff);
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
  const rim2 = mesh(new THREE.TorusGeometry(1.7, 0.16, 8, 16), M.darkMetal(), 0, 2.2, 0);
  rim2.rotation.x = Math.PI / 2; g.add(rim2);
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
  const light = decoLight(0x6dff5c, 1.7, 11 * LAB_SCALE); if (light) { light.position.set(0, 3.2, 0); g.add(light); }
  groundDecal(g, 0x6dff5c);
  labAnimated.push({ update: (t) => {
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
  const light = decoLight(0xb58cff, 1.8, 13 * LAB_SCALE); if (light) { light.position.set(0, 4.5, 0); g.add(light); }
  groundDecal(g, 0xb58cff);
  let boltT = 0;
  labAnimated.push({ update: (t, dt) => {
    orb.material.emissiveIntensity = 2.0 + Math.sin(t * 6) * 0.8;
    orb.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    boltT -= dt;
    if (LOW_FLICKER) { arcs.forEach(l => { l.visible = false; }); if (light) light.intensity = 1.6; return; } // 減閃爍:電弧全滅,燈固定
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
function crate() { // 帶區散落小木箱
  const g = new THREE.Group();
  const c = mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.stone(0x2c2450), 0, 0.35, 0);
  c.rotation.y = Math.random() * Math.PI;
  const band = mesh(new THREE.BoxGeometry(0.74, 0.12, 0.74), M.glow(0x7a4dff, 0.7), 0, 0, 0, false);
  c.add(band); g.add(c); return g;
}

/* ---------- LAB_LAYOUT 編排表:改佈局=改這張表(x/z 單位=tile,原點=場地中心) ----------
   力場矮緣在 x=±14.5 / z=±9.5;帶區:北/南 z=±10..±15,東/西 x=±15..±17。
   南帶=鏡頭前景 → 只放矮件;元素站全在北帶(景深最佳)。 */
const BUILDERS = { tank: containmentTank, alchemy: alchemyTable, shelf: bookshelf, machine: machinery,
  cabinet: displayCabinet, sign: warningSign, glass: crackedGlassPanel, crate,
  fire: fireStation, frost: frostStation, poison: poisonStation, lightning: lightningStation };
export const LAB_LAYOUT = [
  // 北帶:四座元素實驗站(火/冰/毒/雷)
  { type: 'fire',      x: -11.5, z: -11.7, ry: Math.PI * 0.25 },
  { type: 'frost',     x: -4,    z: -11.9, ry: -Math.PI * 0.25 },
  { type: 'poison',    x: 4,     z: -11.9, ry: -Math.PI * 0.2 },
  { type: 'lightning', x: 11.5,  z: -11.7, ry: 0 },
  // 東/西帶:收容水槽+高傢俱
  { type: 'tank', x: -16, z: -6,   ry: Math.PI / 2,  args: [0x5ff0e0, 'orb'] },
  { type: 'tank', x: -16, z: 0,    ry: Math.PI / 2,  args: [0x8aff6d, 'cube'] },
  { type: 'tank', x: -16, z: 6,    ry: Math.PI / 2,  args: [0xb58cff, 'orb'] },
  { type: 'tank', x: 16,  z: -6,   ry: -Math.PI / 2, args: [0x53c8ff, 'crystal'] },
  { type: 'tank', x: 16,  z: 6,    ry: -Math.PI / 2, args: [0xff8ad0, 'crystal'] },
  { type: 'shelf',   x: 16,  z: 0,    ry: -Math.PI / 2 },
  { type: 'machine', x: -16, z: -11,  ry: Math.PI / 2 },
  // 南帶(前景):矮件
  { type: 'alchemy', x: 0,    z: 11.6, ry: Math.PI },
  { type: 'cabinet', x: -5.8, z: 11.6, ry: Math.PI, args: [0xffc14f, 'skull'] },
  { type: 'cabinet', x: 5.4,  z: 11.6, ry: Math.PI, args: [0x53e0ff, 'sword'] },
  { type: 'crate', x: -10.5, z: 11.2 }, { type: 'crate', x: 9.8, z: 11.5 }, { type: 'crate', x: 12.6, z: 11 },
  { type: 'crate', x: -8, z: -11.2 }, { type: 'crate', x: 8.2, z: -11 },
  // 警告立牌(自立支柱;高牆拆除後從掛牆改立在邊界外帶區)+裂玻璃(靠帶區傢俱)
  { type: 'sign', x: -2,     z: -10.2, ry: 0 },
  { type: 'sign', x: 9,      z: -10.2, ry: 0 },
  { type: 'sign', x: 15.1,   z: 5,     ry: -Math.PI / 2 },
  { type: 'sign', x: -15.1,  z: -5,    ry: Math.PI / 2 },
  { type: 'glass', x: -9.8,  z: -10.1, ry: 0 },
  { type: 'glass', x: 14.9,  z: -6.5,  ry: -Math.PI / 2 },
];
function buildLabProps() {
  for (const item of LAB_LAYOUT) {
    const b = BUILDERS[item.type]; if (!b) continue;
    const g = b(...(item.args || []));
    g.position.set(item.x, 0, item.z); g.rotation.y = item.ry || 0;
    labGroup.add(g);
  }
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

/* ---------- 每幀更新(facade render3D 呼叫;dt 由 t 差分) ---------- */
// 減閃爍(玩家反饋:光汙染傷眼):凍結動畫時鐘 → 所有 sin(t) 脈動光固定在單一亮度;
// dt 照常傳 → 純運動(魔塵/氣泡/旋轉)不受影響。雷電弧另在自己的 updater 裡讀這旗標。
export let LOW_FLICKER = false;
export function setLabFlicker(low) { LOW_FLICKER = low; }
window.__lab = { labGroup, labAnimated, flicker: () => LOW_FLICKER }; // debug hook(headless 測試用)
let _lastT = 0;
export function updateLabScene(t) {
  const dt = Math.min(Math.max(t - _lastT, 0), 0.05); _lastT = t;
  const ta = LOW_FLICKER ? 1.7 : t; // 凍結的動畫時鐘(任選相位)
  for (const a of labAnimated) a.update(ta, dt);
}
