// punch-studio — ref-solve:參考疊圖(onion-skin)、關節對位 SOLVER(單視角+multi-view+AI 偵測)、時間軸 scrub、FK 直接拖動
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// ===== 參考疊圖(onion-skin)===== 純視覺輔助,完全不碰 pose schema
const refImg=document.getElementById('refImg');
const refVid=document.getElementById('refVid');
const refState={x:0,y:0,scale:1,flip:false,opacity:0.5};
let refSrc=null;     // 目前「靜態」參考圖(data URL,可序列化 → 綁進 view)
let refKind=null;    // null | 'image' | 'video'(影片只供即時 scrub 找幀;存 view 時烘成靜圖)
let refAlignOn=false, refDrag=false, _rpx=0,_rpy=0;
function applyRef(){
  const sx=refState.scale*(refState.flip?-1:1);
  const t='translate('+refState.x+'px,'+refState.y+'px) scale('+sx+','+refState.scale+')';
  [refImg, refVid].forEach(el=>{ if(!el)return; el.style.opacity=refState.opacity; el.style.transform=t; });
}
function setRefUI(){
  document.getElementById('r_refop').value=refState.opacity;
  document.getElementById('v_refop').textContent=refState.opacity.toFixed(2);
  document.getElementById('refFlip').classList.toggle('on',refState.flip);
}
function hideVideo(){
  if(!refVid) return;
  try{ refVid.pause(); }catch(e){}
  refVid.removeAttribute('src'); try{ refVid.load(); }catch(e){}
  refVid.style.display='none';
  document.getElementById('refVidScrubWrap').style.display='none';
  document.getElementById('refVidTime').textContent='—';
}
// 目前參考 → 可存物件(影片烘「目前那一幀」成靜圖;靜圖直接給);無則 null
function curRef(){
  if(refKind==='video' && refVid.videoWidth){
    try{
      const c=document.createElement('canvas'); c.width=refVid.videoWidth; c.height=refVid.videoHeight;
      c.getContext('2d').drawImage(refVid,0,0);
      return {src:c.toDataURL('image/jpeg',0.85), x:refState.x, y:refState.y, scale:refState.scale, flip:refState.flip, opacity:refState.opacity};
    }catch(e){}
  }
  return refSrc ? {src:refSrc, x:refState.x, y:refState.y, scale:refState.scale, flip:refState.flip, opacity:refState.opacity} : null;
}
// 把某 view 的(靜態)參考圖套上畫面;切視角一律回靜圖模式
function showRef(ref){
  hideVideo();
  if(ref && ref.src){
    refKind='image'; refSrc=ref.src; refImg.src=ref.src; refImg.style.display='block';
    refState.x=ref.x||0; refState.y=ref.y||0; refState.scale=ref.scale||1; refState.flip=!!ref.flip;
    if(ref.opacity!=null) refState.opacity=ref.opacity;
  } else {
    refKind=null; refSrc=null; refImg.removeAttribute('src'); refImg.style.display='none';
    refState.x=0; refState.y=0; refState.scale=1; refState.flip=false;
  }
  setRefUI(); applyRef();
}
// ── 靜態參考圖 ──
document.getElementById('refFile').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    hideVideo();
    refKind='image'; refSrc=rd.result; refImg.src=refSrc; refImg.style.display='block';
    if(refState.opacity<0.05) refState.opacity=0.5;
    setRefUI(); applyRef();
  };
  rd.readAsDataURL(f);
  e.target.value='';   // 允許重新載入同一個檔案
});
// ── 參考影片(scrub 找幀;存 view 時由 curRef 烘成靜圖)──
document.getElementById('refVidFile').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0]; if(!f)return;
  refImg.style.display='none'; refSrc=null;        // 關靜圖
  refKind='video';
  refVid.src=URL.createObjectURL(f); refVid.style.display='block';
  if(refState.opacity<0.05) refState.opacity=0.5;
  document.getElementById('refVidScrubWrap').style.display='';
  refVid.addEventListener('loadedmetadata',()=>{ updateVidTime(); applyRef(); },{once:true});
  setRefUI(); applyRef();
  e.target.value='';
});
const refVidScrub=document.getElementById('refVidScrub');
function updateVidTime(){
  const d=refVid.duration||0, t=refVid.currentTime||0;
  document.getElementById('refVidLbl').textContent=t.toFixed(2)+'s';
  document.getElementById('refVidTime').textContent=t.toFixed(2)+' / '+(isFinite(d)?d.toFixed(2):'?')+'s';
  if(isFinite(d)&&d>0 && document.activeElement!==refVidScrub) refVidScrub.value=Math.round(t/d*1000);
}
refVidScrub.addEventListener('input',()=>{ if(refKind==='video'&&isFinite(refVid.duration)) refVid.currentTime=(refVidScrub.value/1000)*refVid.duration; });
refVid.addEventListener('seeked',updateVidTime);
refVid.addEventListener('timeupdate',updateVidTime);
function stepFrame(dir){ if(refKind!=='video'||!isFinite(refVid.duration))return; const fps=30; refVid.currentTime=Math.max(0,Math.min(refVid.duration,(refVid.currentTime||0)+dir/fps)); }
document.getElementById('refVidPrev').addEventListener('click',()=>stepFrame(-1));
document.getElementById('refVidNext').addEventListener('click',()=>stepFrame(1));
// ── 共用:opacity / 翻轉 / 清除 / 對齊 ──
document.getElementById('r_refop').addEventListener('input',e=>{ refState.opacity=parseFloat(e.target.value); document.getElementById('v_refop').textContent=refState.opacity.toFixed(2); applyRef(); });
document.getElementById('refFlip').addEventListener('click',e=>{ refState.flip=!refState.flip; e.target.classList.toggle('on',refState.flip); applyRef(); });
document.getElementById('refClear').addEventListener('click',()=>{ hideVideo(); refKind=null; refSrc=null; refImg.removeAttribute('src'); refImg.style.display='none'; refState.x=0; refState.y=0; refState.scale=1; refState.flip=false; document.getElementById('refFlip').classList.remove('on'); applyRef(); });
document.getElementById('refAlign').addEventListener('click',e=>{ refAlignOn=!refAlignOn; e.target.classList.toggle('on',refAlignOn); refImg.classList.toggle('align',refAlignOn); refVid.classList.toggle('align',refAlignOn); });
[refImg, refVid].forEach(el=>{
  el.addEventListener('pointerdown',e=>{ if(!refAlignOn)return; refDrag=true; _rpx=e.clientX; _rpy=e.clientY; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove',e=>{ if(!refDrag)return; refState.x+=e.clientX-_rpx; refState.y+=e.clientY-_rpy; _rpx=e.clientX; _rpy=e.clientY; applyRef(); });
  el.addEventListener('pointerup',()=>{ refDrag=false; });
  el.addEventListener('wheel',e=>{ if(!refAlignOn)return; e.preventDefault(); refState.scale=Math.max(0.2,Math.min(4,refState.scale - e.deltaY*0.0012)); applyRef(); },{passive:false});
});

// ===== 關節對位 SOLVER(單視角 MVP)===== 純表現層;phase-agnostic:一律讀寫「目前 active key」
let solveMode=false;
const _sp=new THREE.Vector3();
const solveLayer=document.getElementById('solveLayer');
// 模型端點:每個關節對應一個 3D 物件(端點 world position)
const SOLVE_JOINTS=[
  {id:'head', lbl:'頭',  cls:'core', obj:()=>headPivot},
  {id:'shL',  lbl:'左肩',cls:'arm',  obj:()=>armL && armL.sh},
  {id:'elL',  lbl:'左肘',cls:'arm',  obj:()=>armL && armL.el},
  {id:'fiL',  lbl:'左拳',cls:'arm',  obj:()=>armL && armL.fist},
  {id:'shR',  lbl:'右肩',cls:'arm',  obj:()=>armR && armR.sh},
  {id:'elR',  lbl:'右肘',cls:'arm',  obj:()=>armR && armR.el},
  {id:'fiR',  lbl:'右拳',cls:'arm',  obj:()=>armR && armR.fist},
  {id:'hipL', lbl:'左髖',cls:'leg',  obj:()=>legL && legL.hp},
  {id:'knL',  lbl:'左膝',cls:'leg',  obj:()=>legL && legL.kn},
  {id:'anL',  lbl:'左踝',cls:'leg',  obj:()=>legL && legL.ankle},
  {id:'hipR', lbl:'右髖',cls:'leg',  obj:()=>legR && legR.hp},
  {id:'knR',  lbl:'右膝',cls:'leg',  obj:()=>legR && legR.kn},
  {id:'anR',  lbl:'右踝',cls:'leg',  obj:()=>legR && legR.ankle},
];
// 只解「旋轉」軸(排除位移/縮放/idle-blend/腳踝微調);單視角下深度由起始姿勢+正則化收斂
const SOLVE_PARAMS=['root_y','root_x','spine_x','spine_y','pelvis_y','head_y','head_x',
  'aL_sx','aL_sy','aL_sz','aL_ex','aR_sx','aR_sy','aR_sz','aR_ex',
  'lL_hx','lL_hy','lL_hz','lL_kx','lR_hx','lR_hy','lR_hz','lR_kx'];
const solveTargets={};               // id -> {x,y,enabled}
const stgtEls={}, srigEls={};
function projPx(obj){ if(!obj) return null; obj.getWorldPosition(_sp); _sp.project(camera);
  if(_sp.z>1) return null; const r=canvas.getBoundingClientRect();
  return [(_sp.x*0.5+0.5)*r.width, (-_sp.y*0.5+0.5)*r.height]; }
// 建立目標圈 + 骨架綠點
SOLVE_JOINTS.forEach(j=>{
  solveTargets[j.id]={x:0,y:0,enabled:true};
  const t=document.createElement('div'); t.className='starget '+j.cls;
  const lb=document.createElement('span'); lb.className='slbl2'; lb.textContent=j.lbl; t.appendChild(lb);
  let dragging=false,px=0,py=0;
  t.addEventListener('pointerdown',e=>{ e.stopPropagation(); e.preventDefault();
    if(e.button!==0) return; dragging=true; px=e.clientX; py=e.clientY; t.setPointerCapture(e.pointerId); t.classList.add('on'); });
  t.addEventListener('pointermove',e=>{ if(!dragging)return; const st=solveTargets[j.id];
    st.x+=e.clientX-px; st.y+=e.clientY-py; px=e.clientX; py=e.clientY; placeTgt(j.id); });
  const end=()=>{ if(dragging){dragging=false; t.classList.remove('on');} };
  t.addEventListener('pointerup',end); t.addEventListener('pointercancel',end);
  const toggle=e=>{ e.preventDefault(); const st=solveTargets[j.id]; st.enabled=!st.enabled; t.classList.toggle('off',!st.enabled); };
  t.addEventListener('dblclick',toggle); t.addEventListener('contextmenu',toggle);
  solveLayer.appendChild(t); stgtEls[j.id]=t;
  const rg=document.createElement('div'); rg.className='srig'; solveLayer.appendChild(rg); srigEls[j.id]=rg;
});
function placeTgt(id){ const st=solveTargets[id], el=stgtEls[id]; el.style.left=st.x+'px'; el.style.top=st.y+'px'; }
function syncCam(){ camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); }
function snapTargetsToRig(){ syncCam(); SOLVE_JOINTS.forEach(j=>{ const p=projPx(j.obj()); const st=solveTargets[j.id];
  if(p){ st.x=p[0]; st.y=p[1]; } st.enabled=true; placeTgt(j.id); stgtEls[j.id].classList.remove('off'); }); }
function updateSolveLayer(){ SOLVE_JOINTS.forEach(j=>{ const p=projPx(j.obj()); const el=srigEls[j.id];
  if(!p){ el.style.display='none'; return; } el.style.display='block'; el.style.left=p[0]+'px'; el.style.top=p[1]+'px'; }); }
// ===== Multi-view solve(三角測量地基)=====
// 存多個鏡頭(cam 參數)+ 各自的 2D 目標點。solver 同時最小化「所有視角」的重投影誤差,
// 只要有第二個(側)視角,就能鎖死單視角解不出的前後深度(twist / lunge)。
// 無任何已存視角時,自動退化為「目前鏡頭」單一視角 = 舊行為。
let SOLVE_VIEWS = [];      // [{name, cam:{theta,phi,radius}, targets:{id:{x,y,enabled}}}]
let activeViewIdx = -1;    // 目前載入到 solveTargets 的視角索引(-1 = 尚未存/即興)
const SOLVEVIEW_KEY = 'PUNCH_STUDIO_SOLVEVIEWS_V1';

function curCam(){ return {theta, phi, radius}; }
function setCam(c){ theta=c.theta; phi=c.phi; radius=c.radius; placeCam(); }
function sideView(){ theta=Math.PI/2; phi=Math.PI/2; radius=6.0; placeCam(); syncCam(); snapTargetsToRig();
  setReadout('側視角(θ=90°):把目標點拖到「側面參考圖」的關節,再按「📸 存成視角」。≥2 視角到齊 → Solve 解出深度。'); }
function cloneTargets(src){ const o={}; SOLVE_JOINTS.forEach(j=>{ const s=src[j.id]||{x:0,y:0,enabled:true};
  o[j.id]={x:s.x, y:s.y, enabled:s.enabled!==false}; }); return o; }

function saveSolveViews(){
  try{ localStorage.setItem(SOLVEVIEW_KEY, JSON.stringify(SOLVE_VIEWS)); }
  catch(e){
    // 多半是 localStorage 配額超過(參考圖 data URL 太大)→ 退而求其次:只存幾何,不存圖
    try{ localStorage.setItem(SOLVEVIEW_KEY, JSON.stringify(
      SOLVE_VIEWS.map(v=>({...v, ref: v.ref ? {...v.ref, src:null} : null})))); }catch(_){}
  }
}
function loadSolveViews(){ try{ const r=localStorage.getItem(SOLVEVIEW_KEY); SOLVE_VIEWS = r ? (JSON.parse(r)||[]) : []; }catch(e){ SOLVE_VIEWS=[]; } }

function captureView(){
  if(!solveMode){ setReadout('先按「🎯 點關節對位」進入對位模式'); return; }
  const name='V'+(SOLVE_VIEWS.length+1);
  SOLVE_VIEWS.push({name, cam:curCam(), targets:cloneTargets(solveTargets), ref:curRef()});
  activeViewIdx=SOLVE_VIEWS.length-1;
  saveSolveViews(); renderViewBar();
  setReadout('已存「'+name+'」('+SOLVE_VIEWS.length+' 個視角)。'+(SOLVE_VIEWS.length<2
    ? '換鏡頭角度(🎥 側面)、重貼目標點後再存第二個,Solve 才解得出深度。'
    : '已 ≥2 視角 → 按「▶ Solve 反求」即可三角測量解深度。'));
}
function saveActiveView(){
  const v=SOLVE_VIEWS[activeViewIdx]; if(!v) return;
  v.cam=curCam(); v.targets=cloneTargets(solveTargets); v.ref=curRef(); saveSolveViews();
}
function updateActiveView(){
  if(activeViewIdx<0 || !SOLVE_VIEWS[activeViewIdx]){ setReadout('沒有作用中的視角可更新 — 先點一個視角 chip,或按「📸 存成視角」新增'); return; }
  saveActiveView();
  setReadout('已更新「'+SOLVE_VIEWS[activeViewIdx].name+'」(鏡頭 + 目標點 + 參考圖)');
}
function loadView(idx){
  const v=SOLVE_VIEWS[idx]; if(!v) return;
  activeViewIdx=idx; setCam(v.cam); syncCam();
  SOLVE_JOINTS.forEach(j=>{ const s=v.targets[j.id]||{x:0,y:0,enabled:true}; const st=solveTargets[j.id];
    st.x=s.x; st.y=s.y; st.enabled=s.enabled!==false; placeTgt(j.id); stgtEls[j.id].classList.toggle('off',!st.enabled); });
  showRef(v.ref);
  renderViewBar();
  setReadout('載入「'+v.name+'」(含專屬參考圖)。調整後按「💾 更新」存回此視角;或「📸 存成視角」另存新的。');
}
function deleteView(idx){
  SOLVE_VIEWS.splice(idx,1);
  if(activeViewIdx>=SOLVE_VIEWS.length) activeViewIdx=SOLVE_VIEWS.length-1;
  saveSolveViews(); renderViewBar();
  setReadout(SOLVE_VIEWS.length?('剩 '+SOLVE_VIEWS.length+' 個視角'):'已無視角,Solve 將以目前鏡頭單視角求解');
}
function clearViews(){ SOLVE_VIEWS=[]; activeViewIdx=-1; saveSolveViews(); renderViewBar(); setReadout('已清空所有視角。'); }
function renderViewBar(){
  const bar=document.getElementById('solveViewBar'); if(!bar) return;
  bar.innerHTML='';
  if(!SOLVE_VIEWS.length){ const s=document.createElement('span');
    s.style.cssText='color:var(--dim);font-size:9px'; s.textContent='尚無視角 — 擺好鏡頭+目標點後按「📸 存成視角」'; bar.appendChild(s); return; }
  SOLVE_VIEWS.forEach((v,i)=>{
    const chip=document.createElement('button');
    chip.textContent=v.name+(i===activeViewIdx?' ●':''); chip.className=(i===activeViewIdx?'on':'');
    chip.title='點:載入此視角 · 右鍵/雙擊:刪除';
    chip.addEventListener('click',()=>loadView(i));
    const del=e=>{ e.preventDefault(); deleteView(i); };
    chip.addEventListener('contextmenu',del); chip.addEventListener('dblclick',del);
    bar.appendChild(chip);
  });
}

// solver:跨所有視角累加重投影誤差(無視角→退化為單一「目前鏡頭」視角)
function gatherViews(){
  return SOLVE_VIEWS.length ? SOLVE_VIEWS : [{name:'(current)', cam:curCam(), targets:solveTargets}];
}
function viewsEnabledCount(views){ let n=0;
  views.forEach(v=>SOLVE_JOINTS.forEach(j=>{ const st=v.targets[j.id]; if(st&&st.enabled) n++; })); return n; }
function solveResidualMV(views){ let s=0,n=0;
  views.forEach(v=>{ setCam(v.cam); syncCam();
    SOLVE_JOINTS.forEach(j=>{ const st=v.targets[j.id]; if(!st||!st.enabled)return;
      const p=projPx(j.obj()); if(!p)return; s+=Math.hypot(p[0]-st.x,p[1]-st.y); n++; }); });
  return n?s/n:0; }
function solveErrMV(wp,p0,lam,views){ applyPose(wp); let e=0;
  views.forEach(v=>{ setCam(v.cam); syncCam();
    SOLVE_JOINTS.forEach(j=>{ const st=v.targets[j.id]; if(!st||!st.enabled)return;
      const p=projPx(j.obj()); if(!p)return; e+=(p[0]-st.x)**2+(p[1]-st.y)**2; }); });
  if(lam) SOLVE_PARAMS.forEach(k=>{ const d=(wp[k]||0)-(p0[k]||0); e+=lam*d*d; });
  return e; }
function runSolve(){
  const views=gatherViews();
  const enabled=viewsEnabledCount(views);
  if(enabled<2){ setReadout('至少要 2 個啟用的目標(跨視角合計)才能解'); return; }
  if(playing){ playing=false; if(typeof updateUI==='function') updateUI(); }
  scrubActive=false; pushHistory();
  const restoreCam=(activeViewIdx>=0 && SOLVE_VIEWS[activeViewIdx]) ? {...SOLVE_VIEWS[activeViewIdx].cam} : curCam();
  const base=PHASES[activePhase]; const wp={...base}, p0={...base}; const lam=0.04;
  const before=solveResidualMV(views);
  const step={}; SOLVE_PARAMS.forEach(k=>step[k]=10);
  let cur=solveErrMV(wp,p0,lam,views);
  for(let sweep=0; sweep<48; sweep++){
    let improved=false;
    for(const k of SOLVE_PARAMS){
      const rg=KEYRANGE[k]||[-180,180];
      for(const dir of [1,-1]){
        const old=wp[k]||0; let nv=Math.max(rg[0],Math.min(rg[1],old+dir*step[k]));
        if(nv===old) continue; wp[k]=nv; const e=solveErrMV(wp,p0,lam,views);
        if(e<cur-1e-6){ cur=e; improved=true; } else { wp[k]=old; }
      }
    }
    if(!improved){ let tot=0; SOLVE_PARAMS.forEach(k=>{ step[k]*=0.5; tot+=step[k]; }); if(tot<SOLVE_PARAMS.length*0.2) break; }
  }
  SOLVE_PARAMS.forEach(k=>{ const rg=KEYRANGE[k]; let v=wp[k]; if(rg) v=Math.max(rg[0],Math.min(rg[1],v)); base[k]=Math.round(v*10)/10; });
  applyPose(base); if(typeof refreshSliders==='function') refreshSliders();
  if(typeof scheduleAutosave==='function') scheduleAutosave();
  setCam(restoreCam); syncCam(); updateSolveLayer();
  const after=solveResidualMV(views);
  const depth = views.length>=2 ? ('多視角('+views.length+')→ 深度可解') : '單視角 → 深度沿用現值';
  setReadout('殘差 '+before.toFixed(1)+'px → '+after.toFixed(1)+'px　·　'+depth+'　·　寫入 key「'+activePhase+'」('+enabled+' 點)');
}
function setReadout(t){ const el=document.getElementById('solveReadout'); if(el) el.textContent=t; }
function frontView(){ theta=0; phi=Math.PI/2; radius=6.0; placeCam(); syncCam(); }
function setSolveMode(on){
  solveMode=on;
  document.getElementById('solveToggle').classList.toggle('on',on);
  solveLayer.style.display=on?'block':'none';
  if(on){ if(playing){ playing=false; if(typeof updateUI==='function') updateUI(); } scrubActive=false;
    if(SOLVE_VIEWS.length){ loadView(activeViewIdx>=0?activeViewIdx:0); }
    else { frontView(); snapTargetsToRig(); }
    renderViewBar();
    setReadout('正面=第一視角。拖目標點對齊參考圖 →「📸 存成視角」;再切「🎥 側面」貼第二視角。≥2 視角 Solve 即可解出深度。'); }
}
document.getElementById('frontBtn').addEventListener('click',frontView);
document.getElementById('solveToggle').addEventListener('click',()=>setSolveMode(!solveMode));
document.getElementById('solveReset').addEventListener('click',()=>{ if(!solveMode) setSolveMode(true); else snapTargetsToRig(); });
document.getElementById('solveRun').addEventListener('click',()=>{ if(!solveMode){ setSolveMode(true); return; } runSolve(); });
document.getElementById('sideBtn').addEventListener('click',()=>{ if(!solveMode) setSolveMode(true); sideView(); });
document.getElementById('captureViewBtn').addEventListener('click',captureView);
document.getElementById('updateViewBtn').addEventListener('click',updateActiveView);
document.getElementById('clearViewsBtn').addEventListener('click',clearViews);

// ===== AI 偵測姿勢(MediaPipe)→ 自動放 Solve 目標點(spike) =====
// MediaPipe Pose 33 landmark index → 我們 13 個關節目標。
// 注意:MediaPipe 用「真人」訓練,風格化/非人比例可能抓不準 → 偵測完仍可手拖微調。
const MP_MAP = { head:0, shL:11, elL:13, fiL:15, shR:12, elR:14, fiR:16, hipL:23, knL:25, anL:27, hipR:24, knR:26, anR:28 };
async function aiDetectToTargets(){
  if(!solveMode) setSolveMode(true);
  if(!refSrc){ setReadout('先載入「此視角」的參考圖,再 AI 偵測'); return; }
  if(typeof window.aiDetectPose!=='function'){ setReadout('AI 模組尚未就緒(需連網,且建議用本機 http 開,而非 file://)'); return; }
  setReadout('AI 偵測中…(首次會下載模型,稍候)');
  let lms;
  try{ lms = await window.aiDetectPose(refImg); }
  catch(err){ setReadout('AI 偵測失敗:'+((err&&err.message)||err)+'(多半是離線或 file:// 限制)'); return; }
  if(!lms){ setReadout('AI 沒抓到人形 — 風格化太強?可改手拖目標點,或換一張比例更接近真人的參考圖'); return; }
  const rect = refImg.getBoundingClientRect();   // 參考圖在螢幕上的實際矩形(已含 align 位移/縮放)
  const cr = canvas.getBoundingClientRect();
  let placed=0, low=0;
  SOLVE_JOINTS.forEach(j=>{
    const idx = MP_MAP[j.id]; if(idx==null) return;
    const lm = lms[idx]; if(!lm) return;
    const st = solveTargets[j.id];
    const nx = refState.flip ? (1-lm.x) : lm.x;   // 顯示翻轉 → x 鏡射
    st.x = (rect.left + nx*rect.width) - cr.left;
    st.y = (rect.top + lm.y*rect.height) - cr.top;
    const vis = (lm.visibility!=null) ? lm.visibility : 1;
    st.enabled = vis >= 0.5;                        // 低信心 → 自動排除(雙擊可手動再開)
    if(!st.enabled) low++;
    placeTgt(j.id); stgtEls[j.id].classList.toggle('off',!st.enabled);
    placed++;
  });
  updateSolveLayer();
  setReadout('AI 放好 '+placed+' 點'+(low?('('+low+' 個低信心已排除)'):'')+'。對歪了用手拖修;L/R 反了按「L↔R 鏡像」。OK 後「▶ Solve」,或丟側面圖再偵測一次。');
}
document.getElementById('aiDetectBtn').addEventListener('click',aiDetectToTargets);

loadSolveViews(); renderViewBar();


// ===== 時間軸 scrub ===== 凍結在任一 in-between 幀觀察弧線(只讀,不改 pose)
const rscrub=document.getElementById('rscrub');
const scrubLbl=document.getElementById('scrubLbl');
function totalTime(){ return totalTimelineFrames()/REF_FPS; }
rscrub.addEventListener('input',()=>{
  if(playing){ playing=false; updateUI(); }
  scrubActive=true;
  const tt=totalTime();
  playT=Math.min((parseFloat(rscrub.value)/1000)*tt, tt-1e-4);
  const r=getPlayPose();
  if(r){
    scrubPose=r.pose; applyPose(r.pose);
    const pn=document.getElementById('phasenow');
    pn.textContent=r.phase; pn.classList.add('playing');
    scrubLbl.textContent=Math.round(playT*REF_FPS)+'f · '+r.phase+' '+Math.round((playT/tt)*100)+'%';
    buildTimelineUI();
  }
});

// ===== Cascadeur 風 FK 直接拖動 ===== 拖角色身上節點 = 改對應 schema 軸(sliders/export 仍單一來源)
// 靈敏度/方向(每像素度數)為可調常數;覺得某顆拖反了把該 sens 變號即可。
const KEYRANGE={}; SLIDER_GROUPS.forEach(g=>g.keys.forEach(a=>{KEYRANGE[a[0]]=[a[2],a[3]];}));
const KEYLBL={ head_y:'偏轉', head_x:'俯仰', root_y:'旋身', spine_x:'前傾',
  aL_sx:'前後抬', aR_sx:'前後抬', aL_sy:'旋臂', aR_sy:'旋臂', aL_sz:'側平舉', aR_sz:'側平舉',
  aL_ex:'肘彎', aR_ex:'肘彎', lL_hx:'髖前後', lR_hx:'髖前後', lL_hz:'髖外開', lR_hz:'髖外開',
  lL_kx:'膝彎', lR_kx:'膝彎' };
const NODES=[
  {id:'頭',   cls:'core', obj:()=>head,    keys:[['head_y','x',0.45],['head_x','y',0.45]], hint:'↔ 偏轉 · ↕ 俯仰'},
  {id:'軀幹', cls:'core', obj:()=>body,    keys:[['root_y','x',0.5],['spine_x','y',0.45]], hint:'↔ 旋身 · ↕ 前傾'},
  // 肩=3軸:預設 ↕前後抬 + ↔側平舉(看得見的瞄準軸);Shift+↔ 旋臂
  {id:'左肩', cls:'arm',  obj:()=>armL.sh, keys:[['aL_sz','x',-0.5],['aL_sx','y',0.5]], keysShift:[['aL_sy','x',0.5]], hint:'↕ 前後抬 · ↔ 側平舉 · Shift+↔ 旋臂'},
  {id:'左肘', cls:'arm',  obj:()=>armL.el, keys:[['aL_ex','y',0.6]], hint:'↕ 肘彎'},
  {id:'右肩', cls:'arm',  obj:()=>armR.sh, keys:[['aR_sz','x',0.5],['aR_sx','y',0.5]],  keysShift:[['aR_sy','x',0.5]], hint:'↕ 前後抬 · ↔ 側平舉 · Shift+↔ 旋臂'},
  {id:'右肘', cls:'arm',  obj:()=>armR.el, keys:[['aR_ex','y',0.6]], hint:'↕ 肘彎'},
  {id:'左髖', cls:'leg',  obj:()=>legL.hp, keys:[['lL_hz','x',0.35],['lL_hx','y',0.45]], hint:'↔ 外開 · ↕ 前後'},
  {id:'左膝', cls:'leg',  obj:()=>legL.kn, keys:[['lL_kx','y',0.5]], hint:'↕ 膝彎'},
  {id:'右髖', cls:'leg',  obj:()=>legR.hp, keys:[['lR_hz','x',0.35],['lR_hx','y',0.45]], hint:'↔ 外開 · ↕ 前後'},
  {id:'右膝', cls:'leg',  obj:()=>legR.kn, keys:[['lR_kx','y',0.5]], hint:'↕ 膝彎'},
];
const nodeLayer=document.getElementById('nodeLayer');
const dragReadout=document.getElementById('dragReadout');
const nodeEls={}; const _np=new THREE.Vector3();
let nodesOn=false, dragNode=null, _ndx=0,_ndy=0;

// 抓住節點時,把下游骨頭暫時上色(clone 材質,放開還原)→ 一眼看出哪根在動
const _hl=[];
function setHL(n,on){
  if(on){
    n.obj().traverse(o=>{
      if(o.isMesh && o.material && !Array.isArray(o.material) && o.material.clone){
        const orig=o.material, c=orig.clone();
        if(c.emissive){ c.emissive.setHex(0xff8a3d); c.emissiveIntensity=0.85; }
        o.material=c; _hl.push({mesh:o, mat:orig, clone:c});
      }
    });
  } else {
    _hl.forEach(h=>{ h.mesh.material=h.mat; if(h.clone&&h.clone.dispose) h.clone.dispose(); });
    _hl.length=0;
  }
}
function showReadout(n){
  const p=PHASES[activePhase];
  const all=(n.keys||[]).concat(n.keysShift||[]);
  const parts=all.map(a=>(KEYLBL[a[0]]||a[0])+' <span class="v">'+Math.round(p[a[0]]||0)+'°</span>');
  dragReadout.innerHTML='<b>'+n.id+'</b>　'+parts.join(' · ')+(n.hint?'　<span style="opacity:.55">'+n.hint+'</span>':'');
  dragReadout.style.display='block';
}
NODES.forEach(n=>{
  const d=document.createElement('div'); d.className='jnode '+n.cls;
  const lb=document.createElement('span'); lb.className='jlabel'; lb.textContent=n.id; d.appendChild(lb);
  d.addEventListener('pointerdown',e=>{
    e.stopPropagation(); e.preventDefault();
    if(playing){playing=false; updateUI();} scrubActive=false;
    pushHistory();
    dragNode=n; _ndx=e.clientX; _ndy=e.clientY; d.setPointerCapture(e.pointerId);
    d.classList.add('active'); setHL(n,true); showReadout(n);
  });
  d.addEventListener('pointermove',e=>{
    if(dragNode!==n)return;
    const dx=e.clientX-_ndx, dy=e.clientY-_ndy; _ndx=e.clientX; _ndy=e.clientY;
    const p=PHASES[activePhase];
    const ks=(e.shiftKey && n.keysShift)? n.keysShift : n.keys;
    ks.forEach(([k,axis,sens])=>{
      let v=(p[k]||0)+(axis==='x'?dx:dy)*sens;
      const rg=KEYRANGE[k]; if(rg) v=Math.max(rg[0],Math.min(rg[1],v));
      p[k]=v;
    });
    applyPose(p); refreshSliders(); showReadout(n); scheduleAutosave();
  });
  function endDrag(){ if(dragNode===n){ dragNode=null; d.classList.remove('active'); setHL(n,false); dragReadout.style.display='none'; scheduleAutosave(); } }
  d.addEventListener('pointerup',endDrag);
  d.addEventListener('pointercancel',endDrag);
  nodeLayer.appendChild(d); nodeEls[n.id]=d;
});
function updateNodes(){
  const rect=canvas.getBoundingClientRect();
  NODES.forEach(n=>{
    const o=n.obj(); const el=nodeEls[n.id];
    if(!o){el.classList.add('hide');return;}
    o.getWorldPosition(_np); _np.project(camera);
    if(_np.z>1){el.classList.add('hide');return;}
    el.classList.remove('hide');
    el.style.left=((_np.x*0.5+0.5)*rect.width)+'px';
    el.style.top =((-_np.y*0.5+0.5)*rect.height)+'px';
  });
}
const dragToggle=document.getElementById('dragToggle');
dragToggle.addEventListener('change',e=>{ nodesOn=e.target.checked; nodeLayer.style.display=nodesOn?'block':'none'; if(nodesOn) updateNodes(); });
