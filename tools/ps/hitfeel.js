// punch-studio — hitfeel:打擊感試打台(hitstop/震動/沙包/音效)+ 主渲染迴圈 tick()
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// ===== 打擊感試打台(HIT FEEL):命中段觸發 hitstop + 震動 + 沙包反應 + 閃光 + 音效 =====
// 純預覽演出,不影響匯出資料。參數之後可升格成招式資料(打擊感)的一部分。
const HITFEEL = { dummy:false, sound:true, hitstop:0.08, shake:0.5, knockback:0.5, dist:1.3 };
let hitstopT=0, shakeT=0, dummyHitT=0, wasImpact=false;
const SHAKE_DUR=0.18, DUMMY_DUR=0.35;
let audioCtx=null;
try{ const sv=localStorage.getItem('PUNCH_HITFEEL'); if(sv) Object.assign(HITFEEL, JSON.parse(sv)); }catch(e){}
function saveHitFeel(){ try{ localStorage.setItem('PUNCH_HITFEEL', JSON.stringify(HITFEEL)); }catch(e){} }

let sandbag=null; const sandbagBaseY=1.05;
(function buildSandbag(){
  const g=new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.30,1.05,18), new THREE.MeshStandardMaterial({color:0x9a5b34, roughness:.85})));
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.30,0.12,18), new THREE.MeshStandardMaterial({color:0x444444, roughness:.6})); cap.position.y=0.55; g.add(cap);
  const strap=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.5,8), new THREE.MeshStandardMaterial({color:0x2a2a2a})); strap.position.y=0.82; g.add(strap);
  g.position.set(0, sandbagBaseY, HITFEEL.dist); g.visible=HITFEEL.dummy;
  scene.add(g); sandbag=g;
})();

const hitFlash=document.getElementById('hitFlash');
function doFlash(){ if(!hitFlash)return; hitFlash.style.transition='none';
  hitFlash.style.opacity=String(Math.min(0.65, 0.28+HITFEEL.shake*0.4));
  requestAnimationFrame(()=>{ hitFlash.style.transition='opacity .16s ease-out'; hitFlash.style.opacity='0'; }); }
function ensureAudio(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioCtx=null; } }
  if(audioCtx && audioCtx.state==='suspended') audioCtx.resume(); }
function playThud(){
  ensureAudio(); if(!audioCtx) return; const t=audioCtx.currentTime;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(160,t); o.frequency.exponentialRampToValueAtTime(48,t+0.12);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.6,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+0.18);
  o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+0.2);
  const len=Math.floor(audioCtx.sampleRate*0.05), b=audioCtx.createBuffer(1,len,audioCtx.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
  const ns=audioCtx.createBufferSource(); ns.buffer=b; const ng=audioCtx.createGain(); ng.gain.value=0.3;
  ns.connect(ng); ng.connect(audioCtx.destination); ns.start(t);
}
function triggerHit(){ hitstopT=HITFEEL.hitstop; shakeT=SHAKE_DUR; dummyHitT=DUMMY_DUR; doFlash(); if(HITFEEL.sound) playThud(); }

function bindHF(id, vid, key, fmt){
  const el=document.getElementById(id); if(!el) return;
  const setv=()=>{ HITFEEL[key]=parseFloat(el.value); const vv=document.getElementById(vid); if(vv) vv.textContent=fmt?fmt(HITFEEL[key]):HITFEEL[key].toFixed(2); };
  el.addEventListener('input',setv); el.addEventListener('change',saveHitFeel); el.value=HITFEEL[key]; setv();
}
(function initHitFeelUI(){
  const dummy=document.getElementById('hfDummy'), sound=document.getElementById('hfSound');
  if(dummy){ dummy.checked=HITFEEL.dummy; dummy.addEventListener('change',()=>{ HITFEEL.dummy=dummy.checked; if(sandbag) sandbag.visible=dummy.checked; saveHitFeel(); }); }
  if(sound){ sound.checked=HITFEEL.sound; sound.addEventListener('change',()=>{ HITFEEL.sound=sound.checked; ensureAudio(); saveHitFeel(); }); }
  bindHF('hfHitstop','hfHitstopV','hitstop', v=>v.toFixed(2));
  bindHF('hfShake','hfShakeV','shake'); bindHF('hfKb','hfKbV','knockback'); bindHF('hfDist','hfDistV','dist');
})();

let lastT=performance.now();
function tick(now){
  const dt=Math.min((now-lastT)/1000, 0.05); lastT=now;
  if(playing){
    let advance = dt * (slowOn?slowMo:1);
    if(hitstopT>0){ hitstopT-=dt; advance=0; }   // 命中凍結:暫停推進時間軸
    playT += advance;
    const r = getPlayPose();
    if(!r){
      wasImpact=false;
      if(loop){playT=0;}
      else{playing=false; setPhaseTab(activePhase); updateUI();}
    } else {
      applyPose(r.pose);
      if(r.isImpact && !wasImpact) triggerHit();   // 進入命中段 → 打擊感
      wasImpact = r.isImpact;
      document.getElementById('phasenow').textContent = r.phase;
      document.getElementById('phasenow').classList.add('playing');
      const _tt=totalTime(); const _rs=document.getElementById('rscrub');
      if(_rs) _rs.value = Math.max(0,Math.min(1000,(playT/_tt)*1000));
      const _tlph=document.querySelector('.timeline-playhead'); if(_tlph) _tlph.style.left=Math.max(0,Math.min(100,(playT*REF_FPS/timelineDisplayMaxFrame())*100))+'%';
    }
  } else if(scrubActive && scrubPose){
    applyPose(scrubPose); wasImpact=false;
  } else {
    applyPose(PART_INSPECT_TPOSE ? inspectTposePose() : (PHASES[activePhase] || PHASES.idle || ZERO_POSE));
    document.getElementById('phasenow').textContent = PART_INSPECT_TPOSE ? '組裝檢視 T-POSE' : activePhase.toUpperCase();
    document.getElementById('phasenow').classList.remove('playing');
    wasImpact=false;
  }
  // 沙包反應(被打退 + 壓扁 → 回彈)
  if(sandbag){
    sandbag.visible = HITFEEL.dummy;
    const baseZ = HITFEEL.dist;
    if(dummyHitT>0){ dummyHitT-=dt; const k=Math.max(0,dummyHitT/DUMMY_DUR);
      sandbag.position.set(0, sandbagBaseY, baseZ + HITFEEL.knockback*0.55*k);
      sandbag.scale.set(1+0.12*k, 1-0.18*k, 1+0.12*k);
    } else { sandbag.position.set(0, sandbagBaseY, baseZ); sandbag.scale.set(1,1,1); }
  }
  if(nodesOn) updateNodes();
  if(solveMode) updateSolveLayer();
  // 畫面震動(命中後衰減)
  let sox=0, soy=0;
  if(shakeT>0){ shakeT-=dt; const k=Math.max(0,shakeT/SHAKE_DUR), amp=HITFEEL.shake*0.13*k;
    sox=(Math.random()*2-1)*amp; soy=(Math.random()*2-1)*amp; camera.position.x+=sox; camera.position.y+=soy; }
  renderer.render(scene,camera);
  if(sox||soy){ camera.position.x-=sox; camera.position.y-=soy; }
  requestAnimationFrame(tick);
}
