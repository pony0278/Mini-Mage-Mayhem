// punch-studio — editor-ui:編輯 UI:滑桿群/時間軸拖曳/phase tabs/按鍵綁定/白模/鏡像/contact sheet/匯出匯入/resize
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// ===== UI builders =====
function buildPoseGroups(){
  const host=document.getElementById('poseGroups'); host.innerHTML='';
  SLIDER_GROUPS.forEach(g=>{
    const div=document.createElement('div'); div.className='group '+g.cls;
    div.innerHTML='<h3>'+g.h+'<button class="reset-btn" data-r="'+g.h+'">reset</button></h3>';
    g.keys.forEach(([k,label,min,max,step,unit])=>{
      const c=document.createElement('div'); c.className='ctrl';
      c.innerHTML='<div class="lab"><span class="name">'+label+'</span>'
        +'<span class="val" id="v_'+k+'">0<span class="unit">'+unit+'</span></span></div>'
        +'<input type="range" id="r_'+k+'" min="'+min+'" max="'+max+'" step="'+step+'">';
      div.appendChild(c);
    });
    host.appendChild(div);
  });
  // hook reset buttons for each pose group
  document.querySelectorAll('.group .reset-btn[data-r]').forEach(btn=>{
    if(btn.dataset.r==='timing'||btn.dataset.r==='lags') return;
    btn.addEventListener('click',()=>{
      // reset this group within current phase to zeros
      const groupH = btn.dataset.r;
      const grp = SLIDER_GROUPS.find(g=>g.h===groupH);
      if(grp){
        pushHistory();
        grp.keys.forEach(([k])=>{ PHASES[activePhase][k]=defaultPoseValue(k); });
        refreshSliders(); scheduleAutosave();
      }
    });
  });
}

function buildTimingControls(){
  normalizeTimelineInPlace();
  const host=document.getElementById('timingControls'); host.innerHTML='';
  const s=SEQ[activeIdx]; const isIdle=(activeIdx===0);
  // ⚠ 處理器裡不可沿用 s(pushHistory→normalize 會整組換新 SEQ 物件,s 變孤兒)——
  //   互動當下一律用名字重查:const k=liveKey(); 查不到就放棄
  const keyName = s.name;
  const liveKey = () => SEQ.find(x=>x.name===keyName);

  const meta=document.createElement('div'); meta.className='ctrl';
  meta.innerHTML='<div class="lab"><span class="name">目前 key</span><span class="val">#'+activeIdx+' · '+s.name+'</span></div>'
    +(isIdle ? '' :
      '<div class="keyrow" style="margin-bottom:4px"><input id="rt_name" type="text" value="'+s.name+'" spellcheck="false" '
      +'title="改名此 key(英數/底線;Enter 或離開輸入框套用)" style="flex:1;min-width:0">'
      +'<button id="rt_nameGo" title="套用改名">✎ 改名</button></div>'
      +'<div id="rt_nameMsg" style="font-size:9px;color:var(--dim);min-height:11px"></div>')
    +'<div class="keyrow"><select id="rt_tag"></select><select id="rt_ease"></select></div>';
  host.appendChild(meta);
  if(!isIdle){
    const nameInp=document.getElementById('rt_name'), nameMsg=document.getElementById('rt_nameMsg');
    const doRename=()=>{ if(nameInp.value===keyName) return;
      const r=renameKeyTo(nameInp.value);
      if(!r.ok){ nameMsg.textContent=r.msg; nameMsg.style.color='var(--red, #ff2e6e)'; nameInp.focus(); }
      // 成功時 setActiveKey 已重建整個面板(訊息由重建後的程式碼顯示)
    };
    nameInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doRename(); } });   // 不 stopPropagation:Ctrl+Z 要能到全域;單鍵快捷鍵由全域的 INPUT 守衛擋
    nameInp.addEventListener('blur',doRename);
    document.getElementById('rt_nameGo').addEventListener('click',doRename);
    if(window.__renameMsg){ nameMsg.textContent=window.__renameMsg; nameMsg.style.color='var(--lime, #9dff43)'; window.__renameMsg=null; }
  }
  const tagSel=document.getElementById('rt_tag');
  KEY_TAGS.forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent='tag: '+t; if(t===s.tag)o.selected=true; tagSel.appendChild(o); });
  tagSel.addEventListener('change',e=>{ pushHistory(); const k=liveKey(); if(!k) return; k.tag=e.target.value; buildPhaseTabs(); scheduleAutosave(); });
  const easeSel=document.getElementById('rt_ease');
  EASES.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent='ease: '+m; if(m===s.ease)o.selected=true; easeSel.appendChild(o); });
  easeSel.addEventListener('change',e=>{ pushHistory(); const k=liveKey(); if(!k) return; k.ease=e.target.value; buildPhaseTabs(); scheduleAutosave(); });
  if(!isIdle){
    const cBtn=document.createElement('button'); cBtn.style.width='100%'; cBtn.style.marginTop='4px';
    const paintC=()=>{ const k=liveKey()||s; cBtn.textContent=k.cancel?'✂ CANCEL 點:此 key 起可取消接招':'設為 CANCEL 點'; cBtn.style.borderColor=k.cancel?'var(--lime)':''; cBtn.style.color=k.cancel?'var(--lime)':''; };
    paintC();
    cBtn.addEventListener('click',()=>{ pushHistory(); const k=liveKey(); if(!k) return; k.cancel=!k.cancel; paintC(); scheduleAutosave(); });
    meta.appendChild(cBtn);
  }

  const fc=document.createElement('div'); fc.className='ctrl';
  if(isIdle){
    const rf=timelineReturnFrames();
    fc.innerHTML='<div class="lab"><span class="name">Loop 收尾 → IDLE</span><span class="val" id="vt_f">'+rf+'<span class="unit">f</span></span></div>'
      +'<input type="range" id="rt_f" min="1" max="60" step="1" value="'+rf+'">';
    host.appendChild(fc);
    document.getElementById('rt_f').addEventListener('input',e=>{ const k=SEQ[0]; k.returnFrames=k.frames=parseInt(e.target.value); document.getElementById('vt_f').innerHTML=k.frames+'<span class="unit">f</span>'; updateHeaderMeta(); buildTimelineUI(); scheduleAutosave(); });
  } else {
    const prev=SEQ[activeIdx-1];
    const segLen=Math.max(1, s.frame-prev.frame);
    const maxF=Math.max(240, totalTimelineFrames()+60);
    fc.innerHTML='<div class="lab"><span class="name">上一段長度('+prev.name+' → '+s.name+')</span>'
      +'<span class="val"><input type="number" id="rt_seg" min="1" max="120" step="1" value="'+segLen+'" '
      +'title="這段過渡的格數。改了會整段推移:此 key 與後面所有 key 一起平移,不會打亂順序" '
      +'style="width:52px;text-align:right"><span class="unit">f</span></span></div>'
      +'<div class="lab" style="margin-top:6px"><span class="name">絕對 frame 位置</span><span class="val" id="vt_f">'+s.frame+'<span class="unit">f</span></span></div>'
      +'<input type="range" id="rt_f" min="1" max="'+maxF+'" step="1" value="'+s.frame+'">'
      +'<div class="timeline-help">段長=改長度並推移後面的 key(編動作鏈用);絕對位置=只搬這一個 key,系統自動排序(可能穿越其他 key)。也可直接拖時間軸上的 marker。</div>';
    host.appendChild(fc);
    // 段長(ripple):此 key 與其後所有 key 一起平移 delta
    document.getElementById('rt_seg').addEventListener('change',e=>{
      const nv=Math.max(1, Math.min(120, parseInt(e.target.value)||1));
      pushHistory();
      const i0=SEQ.findIndex(x=>x.name===keyName); if(i0<1) return;
      const delta=nv-Math.max(1, SEQ[i0].frame-SEQ[i0-1].frame);
      if(!delta){ e.target.value=nv; return; }
      for(let i=i0;i<SEQ.length;i++) SEQ[i].frame+=delta;
      normalizeTimelineInPlace();
      buildPhaseTabs(); buildTimingControls(); scheduleAutosave();
    });
    document.getElementById('rt_seg').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); } });
    document.getElementById('rt_f').addEventListener('input',e=>{
      const name=s.name;
      setKeyFrameByName(name, parseInt(e.target.value));
      document.getElementById('vt_f').innerHTML=(SEQ.find(x=>x.name===name)?.frame||0)+'<span class="unit">f</span>';
      buildPhaseTabs(); buildTimingControls(); scheduleAutosave();
    });
  }

  if(!isIdle){
    const ic=document.createElement('label'); ic.className='ctrl';
    ic.style.cssText='cursor:pointer;display:flex;gap:8px;align-items:center';
    ic.innerHTML='<input type="checkbox" id="rt_imp" '+(s.impact?'checked':'')+'> <span class="name">impact(命中:無 lag · 紅框 · 放大段)</span>';
    host.appendChild(ic);
    document.getElementById('rt_imp').addEventListener('change',e=>{ pushHistory(); const k=liveKey(); if(!k) return; k.impact=e.target.checked; if(e.target.checked) k.tag='impact'; buildPhaseTabs(); buildTimingControls(); scheduleAutosave(); });
    // 命中秒數讀出:勾了 impact 就在此處直接顯示 frame÷60 = 遊戲 STRIKE_DELAY 要填的值(免去翻到「遊戲整合」面板)
    if(s.impact){
      const sec=document.createElement('div'); sec.className='ctrl';
      sec.style.cssText='font-size:11px;color:var(--cy);padding:2px 2px 0';
      sec.innerHTML='⏱ 命中時刻:@'+s.frame+'f = <b>'+(s.frame/REF_FPS).toFixed(3)+'s</b> <span style="color:var(--dim)">→ 這格就是遊戲 STRIKE_DELAY 要填的值</span>';
      host.appendChild(sec);
    }
  }

  const lagHost=document.getElementById('lagControls'); lagHost.innerHTML='';
  LAG_SLIDERS.forEach(([k,label])=>{
    const c=document.createElement('div'); c.className='ctrl';
    c.innerHTML='<div class="lab"><span class="name">'+label+'</span>'
      +'<span class="val" id="vl_'+k+'">'+LAGS[k].toFixed(2)+'</span></div>'
      +'<input type="range" id="rl_'+k+'" min="0" max="0.6" step="0.02" value="'+LAGS[k]+'">';
    lagHost.appendChild(c);
    document.getElementById('rl_'+k).addEventListener('input',e=>{
      LAGS[k]=parseFloat(e.target.value);
      document.getElementById('vl_'+k).textContent=LAGS[k].toFixed(2); scheduleAutosave();
    });
  });
}

function bindPoseSliders(){
  POSE_KEYS.forEach(k=>{
    const r=document.getElementById('r_'+k);
    r.addEventListener('input',e=>{
      const v = parseFloat(e.target.value);
      PHASES[activePhase][k]=v; scheduleAutosave();
      const isFloat = (k==='root_py'||k==='root_pz'||k==='sq'||k.endsWith('_idle')||k.endsWith('_scale')||k.endsWith('_stretch'));
      document.getElementById('v_'+k).innerHTML=(isFloat?v.toFixed(2):Math.round(v))+'<span class="unit">'+(r.parentElement.querySelector('.unit').textContent)+'</span>';
    });
  });
}

function refreshSliders(){
  const p = PHASES[activePhase] || {};
  POSE_KEYS.forEach(k=>{
    const r=document.getElementById('r_'+k);
    if(!r) return;
    const pv = (p[k] !== undefined) ? p[k] : defaultPoseValue(k);
    r.value = pv;
    const isFloat = (k==='root_py'||k==='root_pz'||k==='sq'||k.endsWith('_idle')||k.endsWith('_scale')||k.endsWith('_stretch'));
    const unit = r.parentElement.querySelector('.unit').textContent;
    document.getElementById('v_'+k).innerHTML=(isFloat?pv.toFixed(2):Math.round(pv))+'<span class="unit">'+unit+'</span>';
  });
}

// ===== Timeline marker drag =====
let timelineDrag = null;
function updateDraggedKeyFrame(clientX){
  if(!timelineDrag) return;
  const key = SEQ.find(k=>k.name===timelineDrag.name);
  if(!key || key.name === 'idle') return;
  const desired = frameFromTimelineBar(clientX);
  const dir = desired >= timelineDrag.lastDesired ? 1 : -1;
  timelineDrag.lastDesired = desired;
  const nextFrame = nearestFreeTimelineFrame(desired, key.name, dir);
  if(nextFrame === key.frame && timelineDrag.didMove) return;
  if(!timelineDrag.historyPushed){ pushHistory(); timelineDrag.historyPushed = true; }
  timelineDrag.didMove = true;
  key.frame = nextFrame;
  activePhase = key.name;
  // 拖曳中「不要」重建 timeline DOM(會把正在拖的 marker 砍掉 → 拖不動);只即時移動它 + 更新預覽
  const displayMax = timelineDisplayMaxFrame();
  const leftPct = Math.max(0, Math.min(100, (key.frame/displayMax)*100));
  if(timelineDrag.el) timelineDrag.el.style.left = leftPct+'%';
  activeIdx = SEQ.findIndex(k=>k.name===timelineDrag.name);
  playT = (key.frame||0) / REF_FPS;
  scrubActive = false;
  const p = PHASES[activePhase];
  if(p) applyPose(p);
  const pn=document.getElementById('phasenow');
  if(pn){ pn.textContent=activePhase.toUpperCase()+' @ '+key.frame+'F'; pn.classList.remove('playing'); }
  const rs=document.getElementById('rscrub');
  if(rs){ rs.value = Math.max(0, Math.min(1000, (playT / Math.max(totalTime(), 0.0001)) * 1000)); }
  const tlph=document.querySelector('.timeline-playhead');
  if(tlph) tlph.style.left = leftPct+'%';
}
function startTimelineMarkerDrag(e, name, el){
  const key = SEQ.find(k=>k.name===name);
  if(!key) return;
  if(key.name === 'idle'){ setActiveKey(0); return; }
  e.preventDefault(); e.stopPropagation();
  if(playing){ playing=false; updateUI(); }
  activePhase = name;
  activeIdx = SEQ.findIndex(k=>k.name===name);
  timelineDrag = {name, el:el||null, startX:e.clientX, lastDesired:key.frame, didMove:false, historyPushed:false};
  const bar=document.getElementById('timelineBar'); if(bar) bar.classList.add('dragging');
  // 注意:不在這裡呼叫 setActiveKey/buildTimelineUI — 那會重建 DOM、把剛抓住的 marker 砍掉。
  if(el){ el.classList.add('dragging','on'); try{ el.setPointerCapture(e.pointerId); }catch(_){} }
  window.addEventListener('pointermove', onTimelineDragMove, {passive:false});
  window.addEventListener('pointerup', endTimelineMarkerDrag, {once:true});
  window.addEventListener('pointercancel', endTimelineMarkerDrag, {once:true});
}
function onTimelineDragMove(e){
  if(!timelineDrag) return;
  e.preventDefault();
  updateDraggedKeyFrame(e.clientX);
}
function endTimelineMarkerDrag(){
  if(!timelineDrag) return;
  const changed = timelineDrag.didMove;
  const name = timelineDrag.name;
  timelineDrag = null;
  const bar=document.getElementById('timelineBar'); if(bar) bar.classList.remove('dragging');
  window.removeEventListener('pointermove', onTimelineDragMove);
  normalizeTimelineInPlace();
  setActiveKey(SEQ.findIndex(k=>k.name===name));   // 收尾:完整選取 + 重建 timeline(此時重建才安全)
  if(changed) scheduleAutosave();
}

// ===== 動態 phase tab(可新增/刪除/改名/排序)=====
function buildTimelineUI(){
  normalizeTimelineInPlace();
  const bar=document.getElementById('timelineBar');
  const list=document.getElementById('timelineList');
  const info=document.getElementById('timelineInfo');
  if(!bar || !list) return;
  const last=Math.max(1,timelineLastFrame());
  const total=totalTimelineFrames();
  const displayMax=timelineDisplayMaxFrame();
  if(info) info.textContent = `${SEQ.length} keys · ${last}f + return ${timelineReturnFrames()}f · drag markers`;
  bar.innerHTML=''; list.innerHTML='';
  const ph=document.createElement('div'); ph.className='timeline-playhead';
  const pp = Math.max(0, Math.min(100, ((playT*REF_FPS)/displayMax)*100));
  ph.style.left=pp+'%'; bar.appendChild(ph);
  SEQ.forEach((s,i)=>{
    const m=document.createElement('button');
    m.className='timeline-marker '+(i===activeIdx?'on ':'')+(s.impact?'imp ':'')+(i===0?'idle ':'')+(timelineDrag&&timelineDrag.name===s.name?'dragging ':'');
    m.style.left=(s.frame/displayMax*100)+'%';
    m.textContent=i;
    m.title=(i===0?`${s.name} 固定 @ 0f`:`拖曳改 frame · ${s.name} @ ${s.frame}f`);
    m.addEventListener('click',()=>setActiveKey(i));
    m.addEventListener('pointerdown',e=>startTimelineMarkerDrag(e,s.name,m));
    bar.appendChild(m);

    const row=document.createElement('div');
    row.className='tkey '+(i===activeIdx?'on ':'')+(s.impact?'imp ':'');
    row.innerHTML='<span class="fr">'+s.frame+'f</span><span class="nm">'+s.name+(s.impact?' ●':'')+'</span><span class="tag">'+(s.tag||'custom')+'</span><span class="ease">'+s.ease+'</span>';
    row.addEventListener('click',()=>setActiveKey(i));
    list.appendChild(row);
  });
}
function buildPhaseTabs(){
  normalizeTimelineInPlace();
  updateHeaderMeta();
  const host=document.getElementById('phaseTabs'); host.innerHTML='';
  SEQ.forEach((s,i)=>{
    const b=document.createElement('button');
    b.textContent=(i===0?'0':s.frame)+' '+s.name.toUpperCase()+(s.impact?' ●':'');
    b.className=(i===activeIdx?'on':'')+(s.impact?' imp':'');
    b.title=s.name+' @ '+s.frame+'f'+(s.impact?' (impact)':'');
    b.addEventListener('click',()=>setActiveKey(i));
    host.appendChild(b);
  });
  let tools=document.getElementById('seqTools');
  if(!tools){ tools=document.createElement('div'); tools.id='seqTools'; tools.className='seqtools'; host.parentElement.insertBefore(tools, host.nextSibling); }
  tools.innerHTML='';
  const mk=(label,title,fn)=>{ const b=document.createElement('button'); b.textContent=label; b.title=title; b.addEventListener('click',fn); tools.appendChild(b); };
  mk('➕ after','在目前 key 之後插入新 key',addKey);
  mk('⧉ duplicate','複製目前 key 到下一格',duplicateKey);
  mk('＋ scrub','在 scrub/playhead 位置插入 key',insertKeyAtScrub);
  mk('✕ delete','刪除目前 key(idle 不可刪)',delKey);
  mk('✎ rename','重新命名目前 key',renameKey);
  mk('◀ frame','與前一個 key 交換 frame',()=>moveKey(-1));
  mk('▶ frame','與後一個 key 交換 frame',()=>moveKey(1));
  buildTimelineUI();
}
function setActiveKey(i){
  normalizeTimelineInPlace();
  activeIdx=Math.max(0,Math.min(SEQ.length-1,i));
  activePhase=SEQ[activeIdx].name;
  scrubActive=false;
  buildPhaseTabs();
  buildTimingControls();
  refreshSliders();
}
function setPhaseTab(name){ const i=SEQ.findIndex(s=>s.name===name); setActiveKey(i>=0?i:activeIdx); }
function createKeyAfter(srcName, frame, options={}){
  normalizeTimelineInPlace();
  const src = SEQ.find(s=>s.name===srcName) || SEQ[activeIdx] || SEQ[0];
  const base = options.name || src.name.replace(/_\d+$/,'') + '_key';
  const name = uniqueKeyName(base);
  const srcPose = PHASES[src.name] || ZERO_POSE;
  PHASES[name] = {...srcPose};
  const newKey = {name, frame:Math.max(1,Math.round(frame)), frames:5, ease:options.ease||src.ease||'in', impact:!!options.impact, tag:options.tag||tagFromName(name, !!options.impact)};
  SEQ.push(newKey);
  activePhase=name; normalizeTimelineInPlace();
  return SEQ.findIndex(s=>s.name===name);
}
function addKey(){
  pushHistory();
  normalizeTimelineInPlace();
  const cur=SEQ[activeIdx];
  const next=SEQ[activeIdx+1];
  let frame;
  if(next && next.frame-cur.frame>1) frame=Math.floor((cur.frame+next.frame)/2);
  else { frame=cur.frame+5; SEQ.forEach(k=>{ if(k.frame>=frame) k.frame+=5; }); }
  const idx=createKeyAfter(cur.name, frame, {tag:cur.tag});
  setActiveKey(idx); scheduleAutosave();
}
function duplicateKey(){
  pushHistory();
  normalizeTimelineInPlace();
  const cur=SEQ[activeIdx];
  const newFrame=cur.frame+3;
  SEQ.forEach(k=>{ if(k.name!==cur.name && k.frame>=newFrame) k.frame+=3; });
  const idx=createKeyAfter(cur.name, newFrame, {name:cur.name+'_copy', ease:cur.ease, impact:cur.impact, tag:cur.tag});
  setActiveKey(idx); scheduleAutosave();
}
function insertKeyAtScrub(){
  pushHistory();
  const frame = Math.max(1, Math.round(playT * REF_FPS));
  const r=getPlayPose();
  const pose = r ? r.pose : PHASES[activePhase];
  const name = uniqueKeyName('key_'+frame);
  PHASES[name] = {...pose};
  SEQ.push({name, frame, frames:5, ease:'in', impact:false, tag:'custom'});
  activePhase=name; normalizeTimelineInPlace();
  setActiveKey(SEQ.findIndex(s=>s.name===name)); scheduleAutosave();
}
function delKey(){
  if(activeIdx===0 || SEQ.length<=2) return;
  pushHistory();
  const nm=SEQ[activeIdx].name; SEQ.splice(activeIdx,1);
  if(nm!=='idle') delete PHASES[nm];
  normalizeTimelineInPlace();
  setActiveKey(Math.min(activeIdx, SEQ.length-1)); scheduleAutosave();
}
// 改名核心(給面板內嵌輸入框用;不再用 prompt() 對話框——瀏覽器封鎖對話框時會靜默失敗)
function renameKeyTo(raw){
  if(activeIdx===0) return {ok:false, msg:'idle 不可改名'};
  const cur=SEQ[activeIdx];
  const nn=cleanKeyName(raw||'', '');
  if(!nn) return {ok:false, msg:'名稱需含英數(a-z / 0-9 / _;中文會被轉掉)'};
  if(nn===cur.name) return {ok:true, msg:''};
  if(SEQ.some(s=>s.name===nn)) return {ok:false, msg:`「${nn}」已存在`};
  const oldName = cur.name;
  // ⚠ pushHistory→snapshotObject→normalizeTimelineInPlace 會整組換新 SEQ 物件,
  //   push 之後必須「重新查」key,絕不能沿用 push 前抓的參照(舊版 rename 從沒生效就是這顆雷)
  pushHistory();
  const live = SEQ.find(x=>x.name===oldName);
  if(!live) return {ok:false, msg:'key 已不存在?'};
  PHASES[nn]=PHASES[oldName]; delete PHASES[oldName];
  live.name=nn; activePhase=nn;
  window.__renameMsg = (nn!==String(raw||'').trim() ? `已轉為英數名:${nn}` : `已改名:${nn}`);   // setActiveKey 會重建面板,訊息由重建後顯示
  setActiveKey(SEQ.indexOf(live)); scheduleAutosave();
  return {ok:true, msg:''};
}
function renameKey(){   // ✎ rename 鈕/舊入口 → 聚焦面板輸入框
  const inp=document.getElementById('rt_name');
  if(inp){ inp.focus(); inp.select(); }
}
function moveKey(d){
  if(activeIdx===0) return;
  normalizeTimelineInPlace();
  const j=activeIdx+d; if(j<1 || j>=SEQ.length) return;
  pushHistory();
  const cur=SEQ[activeIdx], other=SEQ[j];
  const f=cur.frame; cur.frame=other.frame; other.frame=f;
  activePhase=cur.name; normalizeTimelineInPlace(); setActiveKey(SEQ.findIndex(s=>s.name===cur.name)); scheduleAutosave();
}

function updateUI(){
  document.getElementById('playBtn').textContent = playing ? '■ STOP' : '▶ PLAY';
  document.getElementById('playBtn').classList.toggle('stop', playing);
  document.getElementById('modeBadge').textContent = 'MODE：' + (playing?'PLAY':'EDIT');
}

// ===== Bindings =====
buildPoseGroups();
buildPropPanel();
bindPoseSliders();
buildPhaseTabs();
setActiveKey(Math.min(activeIdx || 1, SEQ.length-1));  // 預設編輯 anti；若有 autosave 則沿用索引
// slider 拖曳前先記 undo，拖曳中只 autosave，避免 undo stack 爆量
let _rangeHistoryArmed = false;
document.addEventListener('pointerdown',e=>{
  if(e.target && e.target.matches && e.target.matches('input[type=range]')){ pushHistory(); _rangeHistoryArmed = true; }
}, true);
document.addEventListener('pointerup',()=>{ if(_rangeHistoryArmed){ _rangeHistoryArmed=false; scheduleAutosave(); } }, true);
// timing / lag reset(一次性綁定,避免重複堆疊)
const _rtT=document.querySelector('.reset-btn[data-r="timing"]');
if(_rtT) _rtT.addEventListener('click',()=>{ pushHistory(); const s=SEQ[activeIdx]; if(activeIdx===0){ s.frames=s.returnFrames=DEFAULT_RETURN_FRAMES; } else { const prev=SEQ[activeIdx-1]; setKeyFrameByName(s.name, (prev?prev.frame:0)+6); } buildPhaseTabs(); buildTimingControls(); scheduleAutosave(); });
const _rtL=document.querySelector('.reset-btn[data-r="lags"]');
if(_rtL) _rtL.addEventListener('click',()=>{ pushHistory(); Object.assign(LAGS,DEFAULT_LAGS); buildTimingControls(); scheduleAutosave(); });

let rebuildQueued = false;
function scheduleRebuild(){
  if(rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(()=>{
    rebuildQueued = false;
    rebuildCharacter();
    scheduleAutosave();
  });
}

// 比例 PROPORTIONS 面板:改尺寸即時重建模型(獨立於 pose schema)
function buildPropPanel(){
  const PROP=[
    ['headSize','頭大小',0.5,1.2,0.01],
    ['bodyH','軀幹高',0.4,1.2,0.01],
    ['bodyW','軀幹寬',0.5,1.2,0.01],
    ['bodyD','軀幹深',0.3,0.9,0.01],
    ['armUpper','上臂長(共用)',0.2,0.6,0.01],
    ['armLower','前臂長(共用)',0.2,0.6,0.01],
    ['armThick','手臂粗細',0.6,1.6,0.01],
    ['armLenL','左臂長度倍率',0.4,2.0,0.01],
    ['armLenR','右臂長度倍率',0.4,2.0,0.01],
    ['legUpper','大腿長',0.25,0.7,0.01],
    ['legLower','小腿長',0.25,0.7,0.01],
    ['legThick','腿粗細',0.6,1.6,0.01],
    ['fist','拳大小',0.6,1.8,0.01],
    ['shoe','鞋大小',0.6,1.8,0.01],
    ['shoulderDrop','肩下移(肩pivot=bodyTop-此值)',0.0,0.4,0.005],
    ['legSpread','髖橫距(髖pivot x=±此值)',0.10,0.40,0.005]
  ];
  const host=document.getElementById('propGroups'); if(!host) return; host.innerHTML='';
  const div=document.createElement('div'); div.className='group';
  div.innerHTML='<h3>比例 PROPORTIONS(角色結構)<button class="reset-btn" id="propReset">reset</button></h3>';
  PROP.forEach(([k,label,min,max,step])=>{
    const c=document.createElement('div'); c.className='ctrl';
    c.innerHTML='<div class="lab"><span class="name">'+label+'</span>'
      +'<span class="val" id="vp_'+k+'">'+DIM[k].toFixed(2)+'</span></div>'
      +'<input type="range" id="rp_'+k+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+DIM[k]+'">';
    div.appendChild(c);
  });
  host.appendChild(div);
  PROP.forEach(([k])=>{
    const r=document.getElementById('rp_'+k);
    r.addEventListener('input',()=>{ DIM[k]=parseFloat(r.value); document.getElementById('vp_'+k).textContent=DIM[k].toFixed(2); scheduleRebuild(); });
  });
  document.getElementById('propReset').addEventListener('click',()=>{ pushHistory(); Object.assign(DIM,DIM_DEFAULTS); buildPropPanel(); rebuildCharacter(); scheduleAutosave(); });
  // 角色模式:PROPORTIONS 控制的是隱藏的「素體驅動骨架」,對已載入的角色無效(角色比例由模型 GLB 決定)。
  // 停用整面板並導向正確工具,避免使用者誤調到假人。
  if(typeof AVATAR !== 'undefined' && AVATAR){
    div.querySelectorAll('input,button').forEach(el=>{ el.disabled=true; });
    div.style.opacity='0.45'; div.style.pointerEvents='none';
    const note=document.createElement('div');
    note.style.cssText='font-size:10px;color:var(--cy,#13e0d4);line-height:1.6;padding:8px 4px;pointer-events:auto';
    note.innerHTML='🔒 <b>角色模式</b>:此面板調的是隱藏的<b>素體驅動骨架</b>,不影響你的模型。<br>'
      +'角色比例由模型 GLB 決定。<b>放大拳頭</b>請用姿勢軸「<b>aL_scale / aR_scale(命中放大)</b>」(可做每個 key 的動態放大);<br>要永久改體型請在建模端改模型再重載。';
    host.insertBefore(note, div);
  }
}

// phase tab 由 buildPhaseTabs() 動態產生並綁定

// 白模觀察:全部 mesh 改白底,邊改純黑(關閉時還原各部件原色)
let whiteModel=false;
function applyWhiteModel(on){
  whiteModel=on;
  root.traverse(o=>{
    if(o.isMesh && o.material){
      const m=o.material;
      if(m.userData.keepColor) return;   // 珊瑚朝向標記:白模下保持原色,方便驗證
      if(m.userData.orig===undefined) m.userData.orig=m.color.getHex();
      m.color.setHex(on ? 0xffffff : m.userData.orig);
    } else if(o.isLineSegments && o.material){
      o.material.color.setHex(on ? 0x000000 : 0x0b0b12);
    }
  });
}
document.getElementById('whiteToggle').addEventListener('change',e=>applyWhiteModel(e.target.checked));
// 軸向標示(XYZ 基準線+腳下 FRONT/BACK/L/R)與地面格線:可關閉,偏好記進 localStorage
function setAxesVisible(on){ axes.visible = frontGroup.visible = !!on; }
function setGridVisible(on){ grid.visible = !!on; }
(function initSceneryToggles(){
  const ax=document.getElementById('axesToggle'), gr=document.getElementById('gridToggle');
  try{
    if(localStorage.getItem('PS_SHOW_AXES')==='0') ax.checked=false;
    if(localStorage.getItem('PS_SHOW_GRID')==='0') gr.checked=false;
  }catch(e){}
  setAxesVisible(ax.checked); setGridVisible(gr.checked);
  ax.addEventListener('change',e=>{ setAxesVisible(e.target.checked); try{ localStorage.setItem('PS_SHOW_AXES', e.target.checked?'1':'0'); }catch(err){} });
  gr.addEventListener('change',e=>{ setGridVisible(e.target.checked); try{ localStorage.setItem('PS_SHOW_GRID', e.target.checked?'1':'0'); }catch(err){} });
})();
document.getElementById('markerToggle').addEventListener('change',e=>{ markersOn=e.target.checked; MARKERS.forEach(m=>m.visible=markersOn); });

document.getElementById('playBtn').addEventListener('click',()=>{
  ensureAudio();   // 在使用者手勢內解鎖音效(瀏覽器要求)
  if(playing){playing=false;}
  else{playing=true; playT=0; scrubActive=false; wasImpact=false;}
  updateUI();
});
const slowBtn=document.getElementById('slowBtn');
slowBtn.classList.add('on');
slowBtn.addEventListener('click',()=>{slowOn=!slowOn; slowBtn.classList.toggle('on',slowOn);});
const loopBtn=document.getElementById('loopBtn');
loopBtn.addEventListener('click',()=>{loop=!loop; loopBtn.classList.toggle('on',loop);});

// preset 載入
function loadCombo8(){
  const b = makePhasesFromPreset('cross');
  PHASES = {
    idle:{...b.idle}, anti_1:{...b.anti}, impact_1:{...b.impact},
    transfer:{...b.strike}, impact_2:{...b.impact}, recoil:{...b.anti},
    impact_3:{...b.impact}, recovery:{...b.recovery}
  };
  SEQ = [
    {name:'idle',     frames:10, ease:'out', impact:false},
    {name:'anti_1',   frames:7,  ease:'out', impact:false},
    {name:'impact_1', frames:4,  ease:'in',  impact:true },
    {name:'transfer', frames:6,  ease:'out', impact:false},
    {name:'impact_2', frames:4,  ease:'in',  impact:true },
    {name:'recoil',   frames:7,  ease:'out', impact:false},
    {name:'impact_3', frames:5,  ease:'in',  impact:true },
    {name:'recovery', frames:12, ease:'out', impact:false}
  ];
  normalizeTimelineInPlace();
}
document.getElementById('presetSel').addEventListener('change',e=>{
  const v=e.target.value;
  if(!v) return;
  pushHistory();
  if(v==='combo8'){ loadCombo8(); }
  else { PHASES = makePhasesFromPreset(v); SEQ = DEFAULT_SEQ.map(s=>({...s})); }
  normalizeTimelineInPlace(); buildPhaseTabs(); setActiveKey(Math.min(1, SEQ.length-1)); scheduleAutosave();
  e.target.value = '';
});

// mirror L<->R (swap aL/aR, lL/lR, negate Y rotations)
function mirrorPose(p){
  const swap=(a,b)=>{const t=p[a]; p[a]=p[b]; p[b]=t;};
  swap('aL_sx','aR_sx'); swap('aL_sz','aR_sz'); swap('aL_ex','aR_ex'); swap('aL_idle','aR_idle'); swap('aL_scale','aR_scale'); swap('aL_wx','aR_wx');
  swap('lL_hx','lR_hx'); swap('lL_hy','lR_hy'); swap('lL_hz','lR_hz'); swap('lL_kx','lR_kx'); swap('lL_ax','lR_ax'); swap('lL_idle','lR_idle'); swap('lL_scale','lR_scale'); swap('lL_contact','lR_contact'); swap('lL_ty','lR_ty');
  // Y 軸鏡像時要反號
  const tmpY = p.aL_sy; p.aL_sy = -(p.aR_sy||0); p.aR_sy = -(tmpY||0);
  const tmpWy = p.aL_wy||0; p.aL_wy = -(p.aR_wy||0); p.aR_wy = -tmpWy;
  // root twist 與 head_y 也反號
  p.root_y = -(p.root_y||0);
  p.spine_y = -(p.spine_y || 0);
  p.pelvis_y = -(p.pelvis_y || 0);
  p.head_y = -(p.head_y || 0);
}
document.getElementById('mirrorBtn').addEventListener('click',()=>{
  pushHistory();
  mirrorPose(PHASES[activePhase]);
  refreshSliders(); scheduleAutosave();
});
// 整段鏡像:時間軸上所有 key 一起鏡像 + LAGS 左右交換(右拳出擊 → 左拳出擊)
document.getElementById('mirrorAllBtn').addEventListener('click',()=>{
  pushHistory();
  Object.keys(PHASES).forEach(k=>mirrorPose(PHASES[k]));
  let t=LAGS.aL; LAGS.aL=LAGS.aR; LAGS.aR=t;
  t=LAGS.lL; LAGS.lL=LAGS.lR; LAGS.lR=t;
  Object.keys(LAGS).forEach(k=>{
    const r=document.getElementById('rl_'+k), v=document.getElementById('vl_'+k);
    if(r)r.value=LAGS[k]; if(v)v.textContent=LAGS[k].toFixed(2);
  });
  refreshSliders(); scheduleAutosave();
  const btn=document.getElementById('mirrorAllBtn'); const orig=btn.textContent;
  btn.textContent='✓ 已鏡像 '+Object.keys(PHASES).length+' 個 key + lag';
  setTimeout(()=>{btn.textContent=orig;}, 1600);
});

// copy from another phase
document.getElementById('copyBtn').addEventListener('click',()=>{
  const host=document.getElementById('copyChoices'); host.innerHTML='';
  SEQ.map(s=>s.name).forEach(ph=>{
    if(ph===activePhase) return;
    const b=document.createElement('button'); b.textContent=ph.toUpperCase();
    b.addEventListener('click',()=>{
      pushHistory();
      PHASES[activePhase] = {...PHASES[ph]};
      refreshSliders(); scheduleAutosave();
      document.getElementById('copyModal').classList.remove('show');
    });
    host.appendChild(b);
  });
  document.getElementById('copyModal').classList.add('show');
});
document.getElementById('closeCopyModal').addEventListener('click',()=>document.getElementById('copyModal').classList.remove('show'));

// 填入站架(GOOFY_IDLE):把目前 phase 一鍵填回乾淨戰鬥站姿。
// 先鋪 ZERO_POSE(把 scale 歸 1、idle 比例歸 0),再覆蓋站架姿勢 → 真正乾淨的起點。
// 主要給 recovery 當誇張旋身/收招的編輯基準,但任何 phase 都能用。
document.getElementById('goofyBtn').addEventListener('click',()=>{
  pushHistory();
  Object.assign(PHASES[activePhase], {...ZERO_POSE, ...GOOFY_IDLE});
  refreshSliders(); scheduleAutosave();
});

// T-pose 填入:把目前 key 的參數整組設為 T-pose(雙臂水平 sz=90、其餘歸零),可 undo。
// 與部位面板「檢視 T-pose」不同——那是唯讀檢視;這是真的寫入 key(校對位/當編輯起點用)。
// 快捷鍵:T(inspectTposePose 定義在 parts.js,僅使用者操作時呼叫,符合跨檔規則)
function applyTposeToKey(){
  pushHistory();
  Object.assign(PHASES[activePhase], inspectTposePose());
  refreshSliders(); scheduleAutosave();
}
document.getElementById('tposeBtn').addEventListener('click', applyTposeToKey);

// ===== Contact sheet 擷取 =====
// 給 AI 診斷用:沿 anti→recovery 等距取樣「插值後」的姿勢(看得到動作路徑,不只 key pose),
// 每格同時 front + 左側兩個角度(讀得出繞垂直軸的扭轉/景深),並標上 phase / 進度。
// 直接把 WebGL canvas drawImage 到 2D 合成畫布 → 輸出單張 PNG 下載。
function captureContactSheet(){
  const N = 10;                       // 時間軸取樣格數
  const capW = 300, capH = 360;       // 每個 view 的渲染解析度
  const cellW = 165, cellH = 198;     // contact sheet 上每格繪製尺寸
  const padL = 80, padT = 60, rowGap = 28;
  const sheetW = padL + N*cellW + 12;
  const sheetH = padT + cellH + rowGap + cellH + 26;

  // 沿用 getPlayPose 的相位時間算總時長
  const total = totalTime();

  // 備份狀態(try/finally 保證還原)
  const oldPlayT = playT, oldPlaying = playing;
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize);
  const oldAspect = camera.aspect;

  const sheet = document.createElement('canvas');
  sheet.width = sheetW; sheet.height = sheetH;
  const x = sheet.getContext('2d');
  x.fillStyle = '#0b0b12'; x.fillRect(0,0,sheetW,sheetH);
  x.textBaseline = 'middle';

  try{
    playing = false;
    renderer.setSize(capW, capH, false);
    camera.aspect = capW/capH; camera.updateProjectionMatrix();

    // 擷取相機:固定角度 — FRONT=正對 +Z 正面;SIDE=從左側 -X 看(出拳手朝鏡頭),略俯視
    const capTarget = new THREE.Vector3(0, 1.0, 0);
    const capRadius = 5.2, capPhi = 1.22;
    const setCapCam = (theta)=>{
      camera.position.set(
        capTarget.x + capRadius*Math.sin(capPhi)*Math.sin(theta),
        capTarget.y + capRadius*Math.cos(capPhi),
        capTarget.z + capRadius*Math.sin(capPhi)*Math.cos(theta)
      );
      camera.lookAt(capTarget);
    };
    const ANGLES = [['FRONT', 0], ['SIDE(左)', -Math.PI/2]];

    // 標題:keyorder / frames / lag 一起記在圖上,我才知道你截圖當下的設定
    x.fillStyle = '#13e0d4'; x.font = 'bold 15px monospace';
    x.fillText('punch_studio  ·  '
      + SEQ.map(k=>k.name+(k.impact?'*':'')+':'+k.frames+'f').join('  ')
      + '  ·  lag '+LAGS.aL+'/'+LAGS.aR+'/'+LAGS.lL+'/'+LAGS.lR, 12, 24);

    for(let r=0; r<ANGLES.length; r++){
      const [angName, angTheta] = ANGLES[r];
      setCapCam(angTheta);
      const rowY = padT + r*(cellH + rowGap);
      // 直排列標籤
      x.save(); x.translate(16, rowY + cellH/2); x.rotate(-Math.PI/2);
      x.fillStyle = '#ffd23f'; x.font = 'bold 14px monospace'; x.textAlign = 'center';
      x.fillText(angName, 0, 0); x.restore(); x.textAlign = 'left';

      for(let i=0; i<N; i++){
        const t = Math.min((i/(N-1))*total, total - 1e-4);
        playT = t;
        const res = getPlayPose();
        if(res){ applyPose(res.pose); }
        renderer.render(scene, camera);
        const cx = padL + i*cellW;
        x.fillStyle = '#15151f'; x.fillRect(cx+2, rowY, cellW-4, cellH);
        x.drawImage(renderer.domElement, cx+2, rowY, cellW-4, cellH);
        const isImpact = res && res.isImpact;
        x.strokeStyle = isImpact ? '#ff2e6e' : '#2e2e44';
        x.lineWidth = isImpact ? 2 : 1;
        x.strokeRect(cx+2.5, rowY+0.5, cellW-5, cellH-1);
        if(r===0){ // 只在上排標 phase + 進度
          x.fillStyle = '#c9c9e0'; x.font = '11px monospace';
          x.fillText((res?res.phase:'-')+' '+Math.round((t/total)*100)+'%', cx+6, rowY-10);
        }
      }
    }
  } finally {
    renderer.setSize(oldSize.x, oldSize.y, false);
    camera.aspect = oldAspect; camera.updateProjectionMatrix();
    placeCam();
    playT = oldPlayT; playing = oldPlaying;
  }

  const a = document.createElement('a');
  a.download = 'punch_contact_sheet.png';
  a.href = sheet.toDataURL('image/png');
  a.click();
}
document.getElementById('captureBtn').addEventListener('click', captureContactSheet);

// Export
function exportGd(){
  let s='# PUNCH STUDIO export — variable-length keyframe sequence\n';
  s+='# keyorder = 播放順序;每 key 一塊 pose(POSE_KEYS 軸)+ frame/ease/impact 參數\n';
  s+='# frame.KEY = 絕對時間軸幀位;frames.KEY = 舊相容段長;idle.frames = 收尾回 idle 時長\n';
  s+='# *_idle(0..1)該肢體回 idle 比例;*_scale(預設1)mesh 縮放(GetAmped 命中放大/縮身)\n';
  s+='\nkeyorder = '+SEQ.map(k=>k.name).join(',')+'\n';
  const _cn=SEQ.find(k=>k.cancel);
  s+='# cancel point: '+(_cn?(_cn.name+' @ frame '+(_cn.frame||0)):'(未設定)')+' — 引擎可從此 key 取消接下一招\n';
  SEQ.forEach(k=>{
    s+='\n# === '+k.name.toUpperCase()+(k.impact?'  (impact)':'')+(k.cancel?'  (cancel)':'')+' ===\n';
    s+='frame.'+k.name+' = '+(k.frame||0)+'\n';
    s+='frames.'+k.name+' = '+k.frames+'\n';
    s+='ease.'+k.name+' = '+k.ease+'\n';
    s+='impact.'+k.name+' = '+(k.impact?'1':'0')+'\n';
    s+='cancel.'+k.name+' = '+(k.cancel?'1':'0')+'\n';
    const p=PHASES[k.name]||{};
    POSE_KEYS.forEach(key=>{
      const isFloat=(key==='root_py'||key==='root_pz'||key==='sq'||key.endsWith('_idle')||key.endsWith('_scale'));
      const val=(p[key]!==undefined)?p[key]:defaultPoseValue(key);
      s+=k.name+'.'+key+' = '+(isFloat?val.toFixed(3):val.toFixed(1))+'\n';
    });
  });
  s+='\n# === LAG ===\n';
  Object.keys(LAGS).forEach(k=>{s+='lag.'+k+' = '+LAGS[k].toFixed(3)+'\n';});
  s+='\n# === PROPORTIONS(整角色一份)===\n';
  Object.keys(DIM).forEach(k=>{s+='dim.'+k+' = '+DIM[k].toFixed(3)+'\n';});
  return s;
}
function showExport(text, title, help){
  const titleEl=document.querySelector('#modal h4');
  const helpEl=document.getElementById('modalHelp');
  if(titleEl) titleEl.textContent=title;
  if(helpEl) helpEl.textContent=help;
  document.getElementById('modalText').value=text;
  document.getElementById('modal').classList.add('show');
  document.getElementById('modalText').select();
  try{navigator.clipboard.writeText(text);}catch(e){}
}
document.getElementById('exportBtn').addEventListener('click',()=>{
  showExport(exportGd(), 'Export · Godot text', 'Godot 文字格式：適合貼到引擎端；長期保存建議另存 JSON。');
});
document.getElementById('jsonExportBtn').addEventListener('click',()=>{
  showExport(exportJson(), 'Export · JSON project', 'JSON 是推薦保存格式：包含 sequence、pose、lag、角色比例，可直接再匯入。');
});
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);
updateHistoryButtons();
document.getElementById('copyText').addEventListener('click',()=>{document.getElementById('modalText').select();try{navigator.clipboard.writeText(document.getElementById('modalText').value);}catch(e){}});
document.getElementById('closeModal').addEventListener('click',()=>document.getElementById('modal').classList.remove('show'));
document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')document.getElementById('modal').classList.remove('show')});

// ===== 匯入 EXPORT 文字 → 還原 PHASES / FRAMES / LAGS / DIM =====
function importGd(text, phases, allowMeta){
  pushHistory();
  const poseSet = new Set(POSE_KEYS);
  let applied=0, skipped=0;
  const lines = text.split('\n').map(l=>l.trim());

  // 1) 先掃 keyorder / frames / ease / impact
  let newOrder=null;
  const frMap={}, frameMap={}, easeMap={}, impMap={}, cnMap={};
  lines.forEach(l=>{
    let m;
    if((m=l.match(/^keyorder\s*=\s*(.+)$/))) newOrder=m[1].split(',').map(x=>x.trim()).filter(Boolean);
    else if((m=l.match(/^frame\.(\w+)\s*=\s*(-?[0-9.]+)/))) frameMap[m[1]]=Math.round(parseFloat(m[2]));
    else if((m=l.match(/^frames\.(\w+)\s*=\s*(-?[0-9.]+)/))) frMap[m[1]]=Math.round(parseFloat(m[2]));
    else if((m=l.match(/^ease\.(\w+)\s*=\s*(\w+)/))) easeMap[m[1]]=m[2];
    else if((m=l.match(/^impact\.(\w+)\s*=\s*(-?[0-9.]+)/))) impMap[m[1]]=(parseFloat(m[2])>0.5);
    else if((m=l.match(/^cancel\.(\w+)\s*=\s*(-?[0-9.]+)/))) cnMap[m[1]]=(parseFloat(m[2])>0.5);
  });

  // 2) 重建 / 更新 SEQ
  if(newOrder && allowMeta){
    SEQ = newOrder.map((nm,i)=>({
      name:nm,
      frame: frameMap[nm],
      frames: frMap[nm]!==undefined?frMap[nm]:(i===0?10:6),
      ease: easeMap[nm]||(i===0?'out':'in'),
      impact: impMap[nm]!==undefined?impMap[nm]:false,
      cancel: cnMap[nm]!==undefined?cnMap[nm]:false
    }));
    newOrder.forEach(nm=>{ if(!PHASES[nm]){ PHASES[nm]={}; POSE_KEYS.forEach(k=>PHASES[nm][k]=defaultPoseValue(k)); } });
  } else if(allowMeta){
    SEQ.forEach(s=>{ if(frameMap[s.name]!==undefined)s.frame=frameMap[s.name]; if(frMap[s.name]!==undefined)s.frames=frMap[s.name]; if(easeMap[s.name])s.ease=easeMap[s.name]; if(impMap[s.name]!==undefined)s.impact=impMap[s.name]; if(cnMap[s.name]!==undefined)s.cancel=cnMap[s.name]; });
    normalizeTimelineInPlace();
  }

  const order = newOrder || SEQ.map(s=>s.name);
  const nameSet = new Set(order);
  const gateByCheckbox = !newOrder;   // 新格式(有 keyorder)→ 全套用;舊格式 → 尊重勾選

  // 3) pose / lag / dim 行
  lines.forEach(line=>{
    if(!line || line.startsWith('#')) return;
    const m = line.match(/^(\w+)\.(\w+)\s*=\s*(-?[0-9.]+)/);
    if(!m){ if(line.indexOf('=')>=0 && !/^(keyorder|ease|frame)\b/.test(line)) skipped++; return; }
    const prefix=m[1], field=m[2], v=parseFloat(m[3]);
    if(prefix==='keyorder'||prefix==='ease'||prefix==='frames'||prefix==='frame'||prefix==='impact'||prefix==='cancel') return; // 已處理
    if(prefix==='lag'){ if(allowMeta && Object.prototype.hasOwnProperty.call(LAGS,field)){ LAGS[field]=v; applied++; } else skipped++; return; }
    if(prefix==='dim'){ if(allowMeta && Object.prototype.hasOwnProperty.call(DIM,field)){ DIM[field]=v; applied++; } else skipped++; return; }
    if(nameSet.has(prefix)){
      const ok = (!gateByCheckbox || phases.has(prefix)) && poseSet.has(field) && isFinite(v);
      if(ok){
        if(!PHASES[prefix]){ PHASES[prefix]={}; POSE_KEYS.forEach(k=>PHASES[prefix][k]=defaultPoseValue(k)); }
        PHASES[prefix][field]=v; applied++;
      } else skipped++;
    } else skipped++;
  });

  rebuildCharacter();
  buildPropPanel();
  buildPhaseTabs();
  if(activeIdx>=SEQ.length) activeIdx=SEQ.length-1;
  setActiveKey(activeIdx);
  scheduleAutosave();
  return {applied, skipped, type:'godot'};
}
document.getElementById('importBtn').addEventListener('click',()=>{
  document.getElementById('importText').value='';
  document.getElementById('importModal').classList.add('show');
  document.getElementById('importText').focus();
});
document.getElementById('importApply').addEventListener('click',()=>{
  const txt=document.getElementById('importText').value;
  if(!txt.trim()){ return; }
  const phases=new Set([...document.querySelectorAll('.impPh:checked')].map(c=>c.value));
  const allowMeta=document.getElementById('impMeta').checked;
  let res;
  try{
    const _app=document.getElementById('impAppend').checked;
    res = txt.trim().startsWith('{') ? (_app?appendJson(txt):importJson(txt)) : importGd(txt, phases, allowMeta);
  }catch(err){
    alert('匯入失敗：' + err.message);
    return;
  }
  document.getElementById('importModal').classList.remove('show');
  const btn=document.getElementById('importBtn'); const orig=btn.textContent;
  btn.textContent='✓ 匯入 '+(res.type==='json'?'JSON ':'')+res.applied+' 筆'+(res.skipped?'(略過 '+res.skipped+')':''); 
  setTimeout(()=>{btn.textContent=orig;}, 1800);
});
document.getElementById('closeImportModal').addEventListener('click',()=>document.getElementById('importModal').classList.remove('show'));
document.getElementById('importModal').addEventListener('click',e=>{if(e.target.id==='importModal')document.getElementById('importModal').classList.remove('show')});
document.getElementById('copyModal').addEventListener('click',e=>{if(e.target.id==='copyModal')document.getElementById('copyModal').classList.remove('show')});

// 鍵盤
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey) && e.code==='KeyZ'){ e.preventDefault(); if(e.shiftKey) redo(); else undo(); return; }
  if((e.ctrlKey||e.metaKey) && e.code==='KeyY'){ e.preventDefault(); redo(); return; }
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.code==='Space'){e.preventDefault(); document.getElementById('playBtn').click();}
  else if(e.code==='KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey){ applyTposeToKey(); }
  else if(e.code.startsWith('Digit')){ const n=parseInt(e.code.slice(5)); if(n>=1 && n<=SEQ.length){ setActiveKey(n-1); } }
});

function resize(){const r=canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width,r.height,false); camera.aspect=r.width/r.height; camera.updateProjectionMatrix();}
window.addEventListener('resize',resize); resize();

// ===== 時間軸 SCRUB 拖桿 =====(原住 ref-solve;拆除時這段被誤刪,移植歸位)
// 凍結在任一 in-between 幀觀察弧線(只讀,不改 pose)。scrubActive/scrubPose 住 pose-data。
document.getElementById('rscrub')?.addEventListener('input', ()=>{
  if(playing){ playing=false; updateUI(); }
  scrubActive=true;
  const tt=totalTime();
  playT=Math.min((parseFloat(document.getElementById('rscrub').value)/1000)*tt, tt-1e-4);
  const r=getPlayPose();
  if(r){
    scrubPose=r.pose; applyPose(r.pose);
    const pn=document.getElementById('phasenow');
    pn.textContent=r.phase; pn.classList.add('playing');
    const sl=document.getElementById('scrubLbl');
    if(sl) sl.textContent=Math.round(playT*REF_FPS)+'f · '+r.phase+' '+Math.round((playT/tt)*100)+'%';
    buildTimelineUI();
  }
});
