// punch-studio — rig:Three.js 場景+方向指示、DIM 角色比例、狀態存檔(undo/autosave/JSON IO)、素體建構、applyPose/lerp、播放段
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// ===== GLB loader 工廠(2026-07-21:使用者常從 Meshy 拿模型,Meshy 預設 Draco 壓縮)=====
// 所有 new THREE.GLTFLoader() 一律改走這裡:有 DRACOLoader(HTML 已掛 CDN UMD 版)就配上=Meshy 原檔直載;
// 沒載到(斷網/CDN 擋)退回裸 loader,未壓縮 GLB 照常。decoder(wasm)同 CDN 懶載,只建一次共用。
let psDraco=null;
function psMakeGltfLoader(){
  const loader=new THREE.GLTFLoader();
  if(THREE.DRACOLoader){
    if(!psDraco){ psDraco=new THREE.DRACOLoader(); psDraco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/'); }
    loader.setDRACOLoader(psDraco);
  }
  return loader;
}
// ===== Three.js =====
const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(42,1,0.1,100);
const target=new THREE.Vector3(0,1.15,0);
let theta=0.6, phi=1.1, radius=6.0;
function placeCam(){camera.position.set(target.x+radius*Math.sin(phi)*Math.sin(theta), target.y+radius*Math.cos(phi), target.z+radius*Math.sin(phi)*Math.cos(theta)); camera.lookAt(target);}
let drag=false,lx=0,ly=0;
canvas.addEventListener('pointerdown',e=>{drag=true;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointerup',()=>drag=false);
canvas.addEventListener('pointermove',e=>{if(!drag)return;theta-=(e.clientX-lx)*0.008;phi-=(e.clientY-ly)*0.008;phi=Math.max(0.25,Math.min(1.45,phi));lx=e.clientX;ly=e.clientY;placeCam();});
canvas.addEventListener('wheel',e=>{e.preventDefault();radius=Math.max(3.2,Math.min(14,radius+e.deltaY*0.01));placeCam();},{passive:false});

scene.add(new THREE.HemisphereLight(0x9fb6ff,0x10121a,0.85));
const key=new THREE.DirectionalLight(0xffffff,1.1); key.position.set(4,7,5); scene.add(key);
scene.add(new THREE.DirectionalLight(0x13e0d4,0.3));
const grid=new THREE.GridHelper(20,20,0x2e2e44,0x1c1c2a); scene.add(grid);   // 地面格線(gridToggle)
const axes=new THREE.AxesHelper(1.3); scene.add(axes);   // 原點基準線:X 紅(左右)/ Y 綠(上下=垂直)/ Z 藍(前後)(axesToggle,與 frontGroup 同組)

// === 正面方向指示(世界 +Z,固定不隨角色或鏡頭旋轉) ===
const frontGroup = new THREE.Group();
const cyanMat = new THREE.MeshBasicMaterial({color: 0x13e0d4, transparent: true, opacity: 0.75});
const dimMat = new THREE.MeshBasicMaterial({color: 0xff2e6e, transparent: true, opacity: 0.55});
// 箭桿
const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 1.6), cyanMat);
shaft.position.set(0, 0.015, 1.0); frontGroup.add(shaft);
// 箭頭(圓錐 → 旋轉指向 +Z)
const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.34, 16), cyanMat);
arrowHead.position.set(0, 0.015, 1.95); arrowHead.rotation.x = Math.PI / 2; frontGroup.add(arrowHead);
// 後方小條(BACK 標記)
const backMark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.04), dimMat);
backMark.position.set(0, 0.015, 0.20); frontGroup.add(backMark);
// 左右側 X 軸小標記(amber,輔助辨識 L/R)
const xMat = new THREE.MeshBasicMaterial({color: 0xffd23f, transparent: true, opacity: 0.5});
const xR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.04), xMat);
xR.position.set(1.0, 0.015, 0); frontGroup.add(xR);
const xL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.04), xMat);
xL.position.set(-1.0, 0.015, 0); frontGroup.add(xL);
scene.add(frontGroup);

// 浮動文字 sprite(永遠面對鏡頭)
function makeTextSprite(text, hex){
  const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=hex; ctx.font='bold 32px JetBrains Mono, monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, 128, 32);
  const tex=new THREE.CanvasTexture(cv);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  sp.scale.set(0.8, 0.2, 1);
  return sp;
}
// 文字標籤一律掛進 frontGroup → 「軸向標示」開關一次控制箭頭+標籤(frontGroup 在原點無變換,位置即世界座標)
const lblFront = makeTextSprite('FRONT →', '#13e0d4'); lblFront.position.set(0, 0.35, 2.2); frontGroup.add(lblFront);
const lblBack  = makeTextSprite('BACK',     '#ff2e6e'); lblBack.position.set(0, 0.25, -0.3);
lblBack.material.opacity = 0.55; frontGroup.add(lblBack);
const lblR = makeTextSprite('R (+X)', '#ffd23f'); lblR.position.set(1.45, 0.22, 0); lblR.material.opacity = 0.5; frontGroup.add(lblR);
const lblL = makeTextSprite('L (-X)', '#ffd23f'); lblL.position.set(-1.45, 0.22, 0); lblL.material.opacity = 0.5; frontGroup.add(lblL);

function box(w,h,d,color){
  const g=new THREE.Group();
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.05}));
  const e=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w,h,d)), new THREE.LineBasicMaterial({color:0x0b0b12}));
  g.add(m,e); return g;
}
// 通用實體:任意 geometry + 黑描邊。flat=true → 多面切角的硬陰影(GetAmped 頭/拳/鞋風)
function solid(geo, color, flat){
  const g=new THREE.Group();
  const m=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.05, flatShading:!!flat}));
  const e=new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:0x0b0b12}));
  g.add(m,e); return g;
}

const root=new THREE.Group(); scene.add(root);
const pelvis=new THREE.Group(); root.add(pelvis);   // 骨盆扭轉群組:雙腿掛此 → pelvis_y 轉動下半身(含腳,拳擊碾地)
const _footBox=new THREE.Box3();   // 用於自動踩地(算雙腳最低點)
const baseY=0;
// ===== 角色比例(結構;獨立於 per-phase pose schema)=====
const DIM = {
  headSize:0.84,
  bodyH:0.78, bodyW:0.86, bodyD:0.56,
  armUpper:0.25, armLower:0.30, armThick:0.90,
  armLenL:1.00, armLenR:1.00,
  legUpper:0.34, legLower:0.45, legThick:1.23,
  fist:0.71, shoe:1.11,
  shoulderDrop:0.08, legSpread:0.22
};
const DIM_DEFAULTS = Object.assign({}, DIM);

// ===== 珊瑚朝向標記系統(coral = 身體前面;白模下保持珊瑚色以便驗證朝向)=====
const GI_C     = 0x7b786f;   // 道服改為中性暖灰 → 讓珊瑚標記有對比
const MARKER_C = 0xd85a30;   // 珊瑚:前胸板、鼻標、指節、各關節前側點、鞋頭
let MARKERS = [];
let markersOn = true;
function tagMarker(obj){
  obj.traverse(o=>{ if(o.isMesh && o.material) o.material.userData.keepColor = true; });
  obj.visible = markersOn; MARKERS.push(obj); return obj;
}
function jointMark(parent, x, y, z, r){
  const m = tagMarker(solid(new THREE.IcosahedronGeometry(r||0.05, 1), MARKER_C, true));
  m.position.set(x, y, z); parent.add(m); return m;
}


// ===== State safety: JSON save/load, undo/redo, autosave =====
const STATE_VERSION = 4;
const STORAGE_KEY = 'PUNCH_STUDIO_AUTOSAVE_V2';
let UNDO_STACK = [];
let REDO_STACK = [];
let autosaveTimer = null;
let suppressHistory = false;

function updateHeaderMeta(){
  const el = document.getElementById('metaSub');
  if(!el) return;
  el.textContent = `free timeline keyframe 編輯器 · ${SEQ.length} key · ${timelineLastFrame()}f × ${POSE_KEYS.length} 軸 + lag · JSON/Undo/Autosave`;
}
function clonePlain(o){ return JSON.parse(JSON.stringify(o)); }
function snapshotObject(){
  normalizeTimelineInPlace();
  return {
    version: STATE_VERSION,
    createdBy: 'PUNCH STUDIO',
    poseKeys: [...POSE_KEYS],
    seq: clonePlain(SEQ),
    phases: clonePlain(PHASES),
    lags: clonePlain(LAGS),
    dim: clonePlain(DIM)
  };
}
function snapshotString(){ return JSON.stringify(snapshotObject()); }
function normalizeState(data){
  const src = data || {};
  const seqIn = src.seq || src.SEQ || DEFAULT_SEQ;
  const phasesIn = src.phases || src.PHASES || PHASES || {};
  const seq = repairTimeline(seqIn);
  const phases = {};
  seq.forEach(k=>{ phases[k.name] = normalizePose(phasesIn[k.name] || (k.name==='idle'?GOOFY_IDLE:{})); });
  const lags = {...DEFAULT_LAGS, ...(src.lags || src.LAGS || {})};
  Object.keys(lags).forEach(k=>{ lags[k]=Number.isFinite(Number(lags[k]))?Number(lags[k]):DEFAULT_LAGS[k]; });
  const dim = {...DIM_DEFAULTS, ...(src.dim || src.DIM || {})};
  Object.keys(dim).forEach(k=>{ dim[k]=Number.isFinite(Number(dim[k]))?Number(dim[k]):DIM_DEFAULTS[k]; });
  return {seq, phases, lags, dim};
}
function applyStateData(data, opts={}){
  const st = normalizeState(data);
  PHASES = st.phases;
  SEQ = st.seq;
  Object.assign(LAGS, st.lags);
  Object.assign(DIM, st.dim);
  if(activeIdx >= SEQ.length) activeIdx = SEQ.length - 1;
  if(activeIdx < 0) activeIdx = 0;
  activePhase = SEQ[activeIdx].name;
  if(opts.rebuild !== false){
    rebuildCharacter();
    buildPropPanel();
    buildPhaseTabs();
    buildTimingControls();
    setActiveKey(activeIdx);
  }
  updateHeaderMeta();
}
function pushHistory(){
  if(suppressHistory) return;
  const snap = snapshotString();
  if(UNDO_STACK[UNDO_STACK.length-1] === snap) return;
  UNDO_STACK.push(snap);
  if(UNDO_STACK.length > 80) UNDO_STACK.shift();
  REDO_STACK.length = 0;
  updateHistoryButtons();
}
function restoreSnapshotString(snap){
  suppressHistory = true;
  try{ applyStateData(JSON.parse(snap)); }
  finally{ suppressHistory = false; updateHistoryButtons(); scheduleAutosave(); }
}
function undo(){
  if(!UNDO_STACK.length) return;
  REDO_STACK.push(snapshotString());
  restoreSnapshotString(UNDO_STACK.pop());
}
function redo(){
  if(!REDO_STACK.length) return;
  UNDO_STACK.push(snapshotString());
  restoreSnapshotString(REDO_STACK.pop());
}
function updateHistoryButtons(){
  const u=document.getElementById('undoBtn'), r=document.getElementById('redoBtn');
  if(u){ u.disabled = !UNDO_STACK.length; u.style.opacity = u.disabled ? .45 : 1; }
  if(r){ r.disabled = !REDO_STACK.length; r.style.opacity = r.disabled ? .45 : 1; }
}
function scheduleAutosave(){
  if(suppressHistory) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(()=>{
    try{ localStorage.setItem(STORAGE_KEY, snapshotString()); }
    catch(e){ console.warn('autosave failed', e); }
  }, 250);
}
function tryLoadAutosave(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) applyStateData(JSON.parse(raw), {rebuild:false});
  }catch(e){ console.warn('autosave load failed', e); }
}
function exportJson(){ return JSON.stringify(snapshotObject(), null, 2); }
function importJson(text){
  const data = JSON.parse(text);
  pushHistory();
  applyStateData(data);
  scheduleAutosave();
  return {applied:Object.keys(PHASES).length * POSE_KEYS.length, skipped:0, type:'json'};
}
// 接續匯入:把另一份 snapshot 的 keys 串到目前 timeline 的 CANCEL 點之後(combo 串接)。
// 不套用對方的 dim/lags(沿用目前角色與延遲設定);對方的 idle 會被略過。
function appendJson(text){
  const st = normalizeState(JSON.parse(text));
  pushHistory();
  normalizeTimelineInPlace();
  // 接點:最後一個 cancel key → 否則最後一個 impact key → 否則最後一個 key
  let cut=-1;
  for(let i=SEQ.length-1;i>=0;i--){ if(SEQ[i].cancel){cut=i;break;} }
  if(cut<0) for(let i=SEQ.length-1;i>=0;i--){ if(SEQ[i].impact){cut=i;break;} }
  if(cut<0) cut=SEQ.length-1;
  // 砍掉接點之後的收招 keys(被取消的部分)
  SEQ.slice(cut+1).forEach(k=>{ if(k.name!=='idle') delete PHASES[k.name]; });
  SEQ.length=cut+1;
  // 串接:略過對方 idle、改名避免衝突、frame 平移 + 4 格混合段
  const BLEND=4;
  const baseF=SEQ[SEQ.length-1].frame||0;
  const inc=st.seq.filter(k=>k.name!=='idle');
  if(!inc.length){ return {applied:0, skipped:0, type:'append'}; }
  const f0=inc[0].frame||0;
  let added=0;
  inc.forEach((k,i)=>{
    let nm=k.name, n=2;
    while(PHASES[nm]||SEQ.some(x=>x.name===nm)) nm=k.name+'_'+(n++);
    SEQ.push({name:nm, frame:baseF+BLEND+Math.max(0,(k.frame||0)-f0),
      ease:(i===0?'out':k.ease), impact:!!k.impact, cancel:!!k.cancel, tag:k.tag||'custom'});
    PHASES[nm]={...st.phases[k.name]};
    added++;
  });
  normalizeTimelineInPlace();
  buildPhaseTabs(); buildTimelineUI(); buildTimingControls(); refreshSliders();
  scheduleAutosave();
  return {applied:added, skipped:0, type:'append'};
}

tryLoadAutosave();
// 衍生值與部件節點(由 buildCharacter 建立/更新 → rebuild 可整批重建)
let hipY, bodyCY, bodyTop, headCY;
let spine, body, headPivot, head, nub, armL, armR, legL, legR;

function buildTorso(){
  // 上窄下寬的錐形八面軀幹(肩窄、腰腹寬),深度壓扁烤進 geometry → 不佔用 group.scale
  const g=new THREE.Group(); g.position.y=bodyCY-hipY;
  const bw=DIM.bodyW, depthScale=DIM.bodyD/DIM.bodyW;
  const topR=bw*0.40, midR=bw*0.56, botR=bw*0.50;        // 肩 / 腰(最寬) / 下襬
  const beltY=hipY+DIM.bodyH*0.34;                        // 腰帶接縫
  const CB=GI_C, CW=0xeeeeee, CK=0x141414, CS=0xb8b8c0;
  const prism=(rT,rB,h,color)=>{
    const geo=new THREE.CylinderGeometry(rT,rB,h,8); geo.rotateY(Math.PI/8); geo.scale(1,1,depthScale);
    return solid(geo,color,true);
  };
  const up=prism(topR,midR, bodyTop-beltY, CB);  up.position.y=(beltY+bodyTop)/2 - bodyCY; g.add(up);
  const lo=prism(midR,botR, beltY-hipY,   CW);   lo.position.y=(hipY+beltY)/2   - bodyCY; g.add(lo);
  const belt=box(midR*2*1.05,0.085,midR*2*depthScale*1.05,CK); belt.position.y=beltY-bodyCY; g.add(belt);
  const buckle=box(0.13,0.075,0.04,CS); buckle.position.set(0,beltY-bodyCY, midR*0.92*depthScale+0.01); g.add(buckle);
  // 白色 V/Y 字毛領(位置相對軀幹頂端,隨比例縮放)
  const fz=topR*0.92*depthScale+0.02, clY=(bodyTop-0.13)-bodyCY, tailY=(bodyTop-0.29)-bodyCY;
  const tail=box(0.07,0.26,0.05,CW); tail.position.set(0, tailY, fz); g.add(tail);
  const cl=box(0.07,0.22,0.05,CW);   cl.position.set(-0.10, clY, fz); cl.rotation.z= 0.6; g.add(cl);
  const cr=box(0.07,0.22,0.05,CW);   cr.position.set( 0.10, clY, fz); cr.rotation.z=-0.6; g.add(cr);
  // 珊瑚前胸板:毛領下、腰帶上;面寬隨軀幹比例縮放
  const plate=tagMarker(box(midR*0.62, 0.16, 0.05, MARKER_C));
  plate.position.set(0, (bodyTop-0.42)-bodyCY, midR*0.85*depthScale*0.92+0.04);
  g.add(plate);
  spine.add(g); return g;
}
function buildHead(){
  // 八角體:CylinderGeometry(…,8) 轉成軸朝前(Z),正面看到八邊形;flat shading 出硬切角
  const hs=DIM.headSize;
  const g=new THREE.CylinderGeometry(hs*0.55, hs*0.55, hs*0.92, 8);
  g.rotateZ(Math.PI/8); g.rotateX(Math.PI/2);
  const h=solid(g, 0xe8c98f, true); // 暫用膚色,之後貼臉
  h.position.y=hs/2; h.scale.set(1.02,0.96,1.0);
  return h;
}

function arm2(side){
  const SLEEVE=GI_C, CUFF=0xeeeeee, SKIN=0xd9c3a0;   // 道服:灰袖 / 白袖口 / 膚色拳
  const lenMul = (side<0 ? (DIM.armLenL||1) : (DIM.armLenR||1));  // 左右臂各自長度倍率
  const t=DIM.armThick, au=DIM.armUpper*lenMul, al=DIM.armLower*lenMul, fs=DIM.fist;
  const sh=new THREE.Group(); sh.position.set(side*(DIM.bodyW/2+0.04), bodyTop-DIM.shoulderDrop-hipY, 0); spine.add(sh);
  const shoulder=solid(new THREE.IcosahedronGeometry(0.20*t,0), SLEEVE, true);
  shoulder.scale.set(1.08,0.82,1.0); shoulder.position.y=0.03; sh.add(shoulder);
  const um=box(0.24*t, au, 0.26*t, SLEEVE); um.position.y=-au/2; sh.add(um);
  const el=new THREE.Group(); el.position.set(0,-au,0); sh.add(el);
  const elbow=solid(new THREE.IcosahedronGeometry(0.155*t,0), SLEEVE, true);
  elbow.scale.set(1.0,0.9,1.0); el.add(elbow);
  const lm=box(0.22*t, al, 0.24*t, SLEEVE); lm.position.y=-al/2; el.add(lm);
  const wr=new THREE.Group(); wr.position.set(0,-al,0); el.add(wr);   // 腕關節(前臂末端)
  const cuff=box(0.27*t,0.10,0.29*t,CUFF); cuff.position.y=0; wr.add(cuff);
  const fist=solid(new THREE.BoxGeometry(0.42*fs,0.40*fs,0.46*fs), SKIN, true);
  fist.position.set(0,-0.18*fs,0.02); wr.add(fist);
  // 指節脊(前上方)→ 改珊瑚:手背朝向標記,腕屈伸(wx)/旋前旋後(wy)一眼可辨
  const knuck=tagMarker(box(0.40*fs,0.13*fs,0.12*fs,MARKER_C)); knuck.position.set(0,0.10*fs,0.20*fs); fist.add(knuck);
  // 關節前側珊瑚點:肩 / 肘 / 腕(local +Z = 該肢段的「前」)
  jointMark(sh, 0, 0.03, 0.13*t+0.07, 0.05);
  jointMark(el, 0, 0,    0.12*t+0.06, 0.042);
  jointMark(wr, 0, 0,    0.145*t+0.05, 0.038);
  return {sh, el, wr, lm, fist, side};
}
function leg2(side){
  const PANT=GI_C, CUFF=0xeeeeee, SHOE=0x161620;     // 灰褲 / 白腳踝袖口 / 黑鞋
  const t=DIM.legThick, lu=DIM.legUpper, ll=DIM.legLower, ss=DIM.shoe;
  const legPrism=(rT,rB,h)=>{ const g=new THREE.CylinderGeometry(rT,rB,h,8); g.rotateY(Math.PI/8); return solid(g,PANT,true); };
  const hp=new THREE.Group(); hp.position.set(side*DIM.legSpread, hipY, 0); pelvis.add(hp);
  const um=legPrism(0.18*t,0.14*t, lu); um.position.y=-lu/2; hp.add(um);
  const kn=new THREE.Group(); kn.position.set(0,-lu,0); hp.add(kn);
  const knee=solid(new THREE.IcosahedronGeometry(0.15*t,0), PANT, true); knee.scale.set(1.0,0.9,1.0); kn.add(knee);
  const lm=legPrism(0.145*t,0.13*t, ll); lm.position.y=-ll/2; kn.add(lm);
  const cuff=box(0.30*t,0.10,0.32*t,CUFF); cuff.position.y=-ll; kn.add(cuff);
  const ankle=new THREE.Group(); ankle.position.set(0,-ll,0); kn.add(ankle);
  const foot=solid(new THREE.BoxGeometry(0.36*ss,0.20*ss,0.52*ss), SHOE, true);
  foot.position.set(0,-0.07*ss,0.11); ankle.add(foot);
  // 珊瑚鞋頭(腳尖朝向 = 鼻子同面)+ 髖 / 膝 / 踝關節前側標記
  const toe=tagMarker(box(0.31*ss,0.17*ss,0.10,MARKER_C));
  toe.position.set(0,-0.07*ss, 0.11+0.26*ss-0.04); ankle.add(toe);
  jointMark(hp,    0, -0.04, 0.18*t+0.06, 0.048);
  jointMark(kn,    0,  0,    0.15*t+0.055, 0.048);
  jointMark(ankle, 0,  0.02, 0.10*t+0.06, 0.038);
  return {hp, kn, lm, foot, ankle, side};
}
function buildCharacter(){
  MARKERS = [];                              // 重建時清空標記註冊(舊物件隨 spine/legs dispose)
  hipY = DIM.legUpper + DIM.legLower;        // 腳長決定髖高 → 改腿長整個上半身跟著升降
  bodyCY = hipY + DIM.bodyH/2;
  bodyTop = hipY + DIM.bodyH;
  headCY = bodyTop + DIM.headSize/2;
  spine = new THREE.Group(); spine.position.set(0, hipY, 0); root.add(spine);
  body = buildTorso();
  headPivot = new THREE.Group(); headPivot.position.set(0, bodyTop-hipY, 0); spine.add(headPivot);
  head = buildHead(); headPivot.add(head);
  nub = tagMarker(box(0.12,0.12,0.12,MARKER_C)); nub.position.set(0, DIM.headSize/2, DIM.headSize*0.46); headPivot.add(nub);   // 鼻標:臉的朝向
  armR = arm2(+1); armL = arm2(-1);
  legR = leg2(+1); legL = leg2(-1);
}
function disposeObj(o){ o.traverse(n=>{ if(n.geometry) n.geometry.dispose(); if(n.material){ (Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose()); } }); }
function rebuildCharacter(){
  if(typeof detachPunchPartsForRebuild === 'function') detachPunchPartsForRebuild();
  if(spine){ disposeObj(spine); root.remove(spine); }
  if(legL){ disposeObj(legL.hp); pelvis.remove(legL.hp); }
  if(legR){ disposeObj(legR.hp); pelvis.remove(legR.hp); }
  buildCharacter();
  if(whiteModel) applyWhiteModel(true);   // 重建後若在白模,重新套白
  applyPose(PHASES[activePhase] || PHASES.idle || ZERO_POSE);
  if(typeof reattachPunchPartsAfterRebuild === 'function') reattachPunchPartsAfterRebuild();
  // 角色模式:重建會生出全新的可見素體網格 → 強制再隱藏,否則調 PROPORTIONS 時假人會冒出來蓋住角色
  // (關節填充球掛在角色骨頭上,不受素體重建影響,不用動)
  if(typeof AVATAR !== 'undefined' && AVATAR && typeof setSyntheticDummyVisible==='function') setSyntheticDummyVisible(false);
}
buildCharacter();
placeCam();

// ===== Pose apply =====
let CARRY_TILT_NOW = 0, CARRY_YAW_NOW = 0;       // 目前幀被扛者 pitch/yaw(度);parts.js 幽靈讀它做拎頭旋轉
const CARRY_OFF_NOW = { x: 0, y: 0, z: 0 };      // 目前幀被扛者掛點偏移(手局部,PS 單位);原地變異、parts.js 讀
// --- 跳躍預覽(brawl-2 air/land tag;使用者拍板 2026-07-15「角色會離地才方便編動作」)---
// air..land 段自動抬升整個角色(applyPose 的踩地公式加項→素體+avatar+部位全跟)。preview-only:
// 不寫進姿勢/匯出——遊戲內高度永遠由 sim 彈道(JUMP_LOB/DIVE_T)決定,studio 只負責讓剪影看得對。
// 兩種曲線:air 在第 0 幀=俯衝式(開場即空中,線性壓地到 land=遊戲 dive 同款);否則=拋物線 0→頂→0(遊戲 lobZ 同形)。
const JUMP_PREVIEW_APEX = 46 / 25;   // 對齊遊戲 JUMP_LOB.apex 46px(PS 1 單位=25px)
function jumpTagFrames(){
  let af = null, lf = null;
  try{ for(const k of (SEQ || [])){ if(k.tag === 'air' && af === null) af = k.frame; if(k.tag === 'land' && lf === null && af !== null && k.frame > af) lf = k.frame; } }catch(e){ /* SEQ 未就緒 */ }
  if(af !== null && lf === null) lf = timelineLastFrame();   // 沒標 land:落在 clip 結尾
  return { af, lf };
}
function jumpLiftNow(){
  const { af, lf } = jumpTagFrames();
  if(af === null || lf === null || lf <= af) return 0;
  const cur = (typeof playT !== 'undefined' ? playT : 0) * REF_FPS;   // 播放/scrub/選 key 都設 playT(WYSIWYG 契約)
  if(cur < af || cur > lf) return 0;
  const p = (cur - af) / (lf - af);
  if(af <= 0) return JUMP_PREVIEW_APEX * (1 - p);            // 俯衝式:線性壓地
  return JUMP_PREVIEW_APEX * 4 * p * (1 - p);                // 跳躍式:拋物線
}
function applyPose(p){
  CARRY_TILT_NOW = p.carry_tilt || 0; CARRY_YAW_NOW = p.carry_yaw || 0;
  CARRY_OFF_NOW.x = p.carry_ox || 0; CARRY_OFF_NOW.y = p.carry_oy || 0; CARRY_OFF_NOW.z = p.carry_oz || 0;
  root.rotation.x = p.root_x * D2R;
  root.rotation.y = p.root_y * D2R;
  root.rotation.z = 0;
  root.position.set(0, baseY, p.root_pz);   // y 先暫定,最後自動踩地;x=0 永遠置中
  if(p.sq>=0){const sy=1-p.sq, sxz=1/Math.sqrt(Math.max(sy,0.1)); root.scale.set(sxz,sy,sxz);}
  else{const sz=1-p.sq, sxy=1/Math.sqrt(Math.max(sz,0.1)); root.scale.set(sxy,sxy,sz);}
  // 身體獨立縮放(GetAmped 風:攻擊時身體縮小)
  body.scale.setScalar(p.body_scale||1);
  // 脊椎:只彎上半身(腳留在地面)。X=前後傾、Y=甩腰扭轉
  spine.rotation.set((p.spine_x||0)*D2R, (p.spine_y||0)*D2R, 0);
  // 骨盆:下半身繞垂直軸扭轉(獨立於 spine);雙腿+腳掛在 pelvis → 後腳跟著碾地轉
  pelvis.rotation.y = (p.pelvis_y||0)*D2R;
  // 頭部(headPivot 現在掛在 spine 下,Y 用 spine 子空間)
  headPivot.rotation.set((p.head_x||0)*D2R, (p.head_y||0)*D2R, 0);
  headPivot.position.set(0, bodyTop-hipY, (p.head_pz||0));
  // 每肢體的 idle weight:0=照值跑、1=強制垂下/直立
  const aLw = 1 - (p.aL_idle||0);
  const aRw = 1 - (p.aR_idle||0);
  const lLw = 1 - (p.lL_idle||0);
  const lRw = 1 - (p.lR_idle||0);
  armL.sh.rotation.set(p.aL_sx*aLw*D2R, p.aL_sy*aLw*D2R, (p.aL_sz||0)*aLw*armL.side*D2R);
  armL.el.rotation.set(-p.aL_ex*aLw*D2R, 0, 0);   // 負號:正值 = 手肘往前彎(解剖正確)
  armR.sh.rotation.set(p.aR_sx*aRw*D2R, p.aR_sy*aRw*D2R, (p.aR_sz||0)*aRw*armR.side*D2R);
  armR.el.rotation.set(-p.aR_ex*aRw*D2R, 0, 0);
  // 整肢伸展:肩節點等比放大 → 整條手臂從肩膀變長變大(遠鏡頭下伸手更明顯)
  armL.sh.scale.setScalar(p.aL_stretch||1);
  armR.sh.scale.setScalar(p.aR_stretch||1);
  // 腕關節:wx 屈伸 · wy 沿前臂軸扭轉(旋前旋後)· wz 左右擺腕(尺橈偏;×side 正=往外,同肩 Z 慣例)
  armL.wr.rotation.set((p.aL_wx||0)*aLw*D2R, (p.aL_wy||0)*aLw*D2R, (p.aL_wz||0)*aLw*armL.side*D2R);
  armR.wr.rotation.set((p.aR_wx||0)*aRw*D2R, (p.aR_wy||0)*aRw*D2R, (p.aR_wz||0)*aRw*armR.side*D2R);
  // 髖:X=前後擺、Z=橫向張開(×side → 正值兩腿都往外張成 O 型腿);膝 X=蹲
  // 蹲下 macro:整體屈膝(膝 +squat、髖 -0.7×squat),身體靠自動踩地自然下沉
  const sqd = p.squat||0;
  const hxL=p.lL_hx - sqd*0.7, kxL=p.lL_kx + sqd;
  const hxR=p.lR_hx - sqd*0.7, kxR=p.lR_kx + sqd;
  legL.hp.rotation.set(hxL*lLw*D2R, (p.lL_hy||0)*lLw*legL.side*D2R, (p.lL_hz||0)*lLw*legL.side*D2R); legL.kn.rotation.set(kxL*lLw*D2R, 0, 0);
  legR.hp.rotation.set(hxR*lRw*D2R, (p.lR_hy||0)*lRw*legR.side*D2R, (p.lR_hz||0)*lRw*legR.side*D2R); legR.kn.rotation.set(kxR*lRw*D2R, 0, 0);
  // 整肢伸展:髖節點等比放大(整條腿變長;自動踩地用 foot bbox → 會自然把身體撐高)
  legL.hp.scale.setScalar(p.lL_stretch||1);
  legR.hp.scale.setScalar(p.lR_stretch||1);
  // 腳踝:自動把腳掌壓平(用蹲下後的有效角度),ax 為額外手動微調
  // 腳踝:X=自動壓平+ax 微調;Y=腳尖朝向(ty,×side)可獨立於髖瞄準腳尖
  legL.ankle.rotation.set((-(hxL + kxL) + (p.lL_ax||0)) * lLw * D2R, (p.lL_ty||0)*lLw*legL.side*D2R, 0);
  legR.ankle.rotation.set((-(hxR + kxR) + (p.lR_ax||0)) * lRw * D2R, (p.lR_ty||0)*lRw*legR.side*D2R, 0);
  // 腳掌接觸鎖:0=平踩 1=墊腳(抬跟,以腳尖為支點) 2=抬起(離地)
  const cL = Math.round(p.lL_contact||0), cR = Math.round(p.lR_contact||0);
  const HEEL_LIFT = 55*D2R;   // 墊腳抬跟量(正 ankle.x = 趾下、跟上)
  if(cL===1) legL.ankle.rotation.x += HEEL_LIFT*lLw;
  if(cR===1) legR.ankle.rotation.x += HEEL_LIFT*lRw;
  // 前臂/小腿縮放(命中放大,chibi 浮誇)
  armL.lm.scale.setScalar(p.aL_scale||1);
  armR.lm.scale.setScalar(p.aR_scale||1);
  legL.lm.scale.setScalar(p.lL_scale||1);
  legR.lm.scale.setScalar(p.lR_scale||1);
  // 拳套/鞋同步放大 → 出拳/踢擊末端更誇張
  armL.fist.scale.setScalar(p.aL_scale||1);
  armR.fist.scale.setScalar(p.aR_scale||1);
  legL.foot.scale.setScalar(p.lL_scale||1);
  legR.foot.scale.setScalar(p.lR_scale||1);
  // 自動踩地(接觸鎖):只用「踩地中」的腳(平踩/墊腳)當地面錨點 → 重心落在支撐腳;
  // 抬起(2)的腳不算錨點,可自由離地不會把身體拉下來。root_py 作為額外升降(跳躍/浮空)。
  root.updateMatrixWorld(true);
  _footBox.makeEmpty();
  let grounded=false;
  if(cL!==2){ _footBox.expandByObject(legL.foot); grounded=true; }
  if(cR!==2){ _footBox.expandByObject(legR.foot); grounded=true; }
  if(!grounded){ _footBox.expandByObject(legL.foot); _footBox.expandByObject(legR.foot); }   // 雙腳皆抬:仍用雙腳防止飄走
  root.position.y = isFinite(_footBox.min.y) ? (baseY - _footBox.min.y + (p.root_py||0) + jumpLiftNow()) : (baseY + (p.root_py||0) + jumpLiftNow());
  // 基底角色(rigged avatar):素體 pose 完成後,把世界差量轉寫到角色骨頭(avatar.js;載入前守衛)
  if (typeof updateAvatarPose === 'function') updateAvatarPose(p);
  // rigged 手手指彎曲:逐關鍵格姿勢軸(aL_/aR_ f*)→ 驅動 HAND_RIG 指骨(parts.js;未掛手時 no-op)
  if (typeof applyFingerPose === 'function') applyFingerPose(p);
}

function ease(p,m){p=Math.max(0,Math.min(1,p)); if(m==='in')return p*p; if(m==='out')return 1-(1-p)*(1-p); return p;}

function lerpPose(a,b,t,lags){
  const out={};
  for(const k of POSE_KEYS){
    let lag=0;
    if(k.startsWith('aL_')) lag=lags.aL;
    else if(k.startsWith('aR_')) lag=lags.aR;
    else if(k.startsWith('lL_')) lag=lags.lL;
    else if(k.startsWith('lR_')) lag=lags.lR;
    const lt = lag>0 ? Math.max(0,Math.min(1,(t-lag)/Math.max(1-lag,0.001))) : t;
    const defV = defaultPoseValue(k);   // 缺席軸的預設(pose-data 單一真相;舊寫法漏 _stretch → 內插到 0 而非 1)
    const av = (a[k] !== undefined) ? a[k] : defV;
    const bv = (b[k] !== undefined) ? b[k] : defV;
    out[k] = av + (bv-av) * lt;
  }
  return out;
}

// ===== Play / Edit loop =====
// SEQ 展開成過渡段:每段 from→to + frames + ease + impact;結尾自動加「最後一個 key → idle」收尾段。
function buildSegments(){
  normalizeTimelineInPlace();
  const segs=[];
  for(let i=1;i<SEQ.length;i++){
    const s=SEQ[i], prev=SEQ[i-1];
    const frames=Math.max(1, s.frame - prev.frame);
    s.frames = frames;
    segs.push({from:prev.name, to:s.name, startFrame:prev.frame, endFrame:s.frame, frames, ease:s.ease, impact:!!s.impact, label:s.name.toUpperCase()});
  }
  const last=SEQ[SEQ.length-1], idle=SEQ[0];
  const rf=timelineReturnFrames();
  idle.frames=rf; idle.returnFrames=rf;
  segs.push({from:last.name, to:idle.name, startFrame:last.frame, endFrame:last.frame+rf, frames:rf, ease:idle.ease||'out', impact:false, label:'→IDLE'});
  return segs;
}
function getPlayPose(){
  const segs=buildSegments();
  const frameT = playT * REF_FPS;
  for(const s of segs){
    if(frameT < s.endFrame){
      const lp=(frameT-s.startFrame)/Math.max(s.frames,0.0001);
      const lags = s.impact ? {aL:0,aR:0,lL:0,lR:0} : LAGS;
      return {phase:s.label, isImpact:s.impact, frame:frameT, pose:lerpPose(PHASES[s.from]||{}, PHASES[s.to]||{}, ease(lp, s.ease), lags)};
    }
  }
  return null; // 結束
}
