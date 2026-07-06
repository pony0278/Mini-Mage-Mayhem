// punch-studio — game-bridge:__ps headless 健檢 hook + 遊戲整合面板(招式庫/🎮遊戲視角/impact 秒數讀出)
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// headless 健檢 hook(比照抽取器 __mpe)
window.__ps = {
  get parts() { return Object.keys(PART_MODELS); },
  get dummyHidden() { return PARTS_HIDE_DUMMY; },
  applyPose, get PHASES() { return PHASES; }, get SEQ() { return SEQ; },
  get avatar() { return AVATAR ? { label: AVATAR.label, bones: AVATAR.order.length, scale: +AVATAR.S.toFixed(3), fillers: AVATAR.fillers.length } : null; },
  setJointFill(on){ if(typeof setJointFill==='function') setJointFill(on); },
  avatarBoneWorld(key) {                       // 測試用:取角色骨頭世界座標
    if (!AVATAR || !AVATAR.by[key]) return null;
    const v = new THREE.Vector3(); AVATAR.by[key].bone.getWorldPosition(v);
    return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
  },
};

// ===== 遊戲端整合小工具(Mini Mage Mayhem)=====
// A. 招式庫:具名槽存/載/刪 + 全部匯出(localStorage;編一整套招式不再互相覆蓋)
// B. 🎮 遊戲視角:一鍵切到遊戲取景(fov32/俯角44°/看角色背面)驗動作可讀性,再按一次還原
// C. impact 秒數讀出:frame÷60 = 遊戲 v2-state.js STRIKE_DELAY 要填的值
(function(){
  const gvBtn = document.getElementById('gameViewBtn');
  let gvPrev = null;
  gvBtn?.addEventListener('click', ()=>{
    if(!gvPrev){
      gvPrev = { theta, phi, radius, fov: camera.fov };
      theta = Math.PI; phi = 0.80; radius = 5.4; camera.fov = 32;   // 46°極角=俯角44°;背面=遊戲鏡頭常態
      gvBtn.textContent = '↩ 還原自由視角'; gvBtn.style.borderColor = 'var(--lime)';
    } else {
      theta = gvPrev.theta; phi = gvPrev.phi; radius = gvPrev.radius; camera.fov = gvPrev.fov;
      gvPrev = null; gvBtn.textContent = '🎮 遊戲視角(44° 後上)'; gvBtn.style.borderColor = '';
    }
    camera.updateProjectionMatrix(); placeCam();
  });

  const impEl = document.getElementById('impactInfo');
  setInterval(()=>{                                       // 500ms 輪詢,避免掛勾內部重繪函式
    if(!impEl) return;
    const imps = (typeof SEQ !== 'undefined' ? SEQ : []).filter(k=>k.impact);
    impEl.textContent = imps.length
      ? 'impact: ' + imps.map(k=>`${k.name} @${k.frame||0}f = ${((k.frame||0)/60).toFixed(3)}s → STRIKE_DELAY`).join('　')
      : 'impact: (未設定 impact key)';
  }, 500);

  const LIB_KEY = 'PUNCH_STUDIO_CLIP_LIB_V1';
  const readLib = ()=>{ try{ return JSON.parse(localStorage.getItem(LIB_KEY)||'{}'); }catch(e){ return {}; } };
  const writeLib = (lib)=>{ try{ localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }catch(e){} };
  const listEl = document.getElementById('clipList');
  function renderLib(){
    if(!listEl) return;
    const lib = readLib(); const names = Object.keys(lib).sort();
    listEl.innerHTML = '';
    if(!names.length){ listEl.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px">(空)把目前動作取名存入,即可編下一招不怕蓋掉</div>'; return; }
    names.forEach(n=>{
      const row = document.createElement('div'); row.className = 'tkey';
      const imp = (lib[n].seq||[]).find(k=>k.impact);
      row.innerHTML = `<span>${n}</span><span class="tag">${imp?('imp@'+(imp.frame||0)+'f'):''}</span><span class="ease"></span>`;
      const box = row.querySelector('.ease');
      const mk = (t,fn,col)=>{ const b=document.createElement('button'); b.textContent=t;
        b.style.cssText='font-size:9px;padding:1px 6px;margin-left:4px'+(col?';color:'+col:'');
        b.addEventListener('click',fn); box.appendChild(b); };
      mk('載入', ()=>{ try{ pushHistory(); applyStateData(lib[n]); scheduleAutosave();
        const inp=document.getElementById('clipName'); if(inp) inp.value=n; }catch(e){ alert('載入失敗: '+e.message); } });
      mk('刪', ()=>{ if(!confirm('刪除招式「'+n+'」?')) return; const l=readLib(); delete l[n]; writeLib(l); renderLib(); }, 'var(--hot)');
      listEl.appendChild(row);
    });
  }
  document.getElementById('clipSaveBtn')?.addEventListener('click', ()=>{
    const inp = document.getElementById('clipName');
    const name = (inp && inp.value.trim()) || '';
    if(!name){ alert('先取個招式名(如 throw / hookl)'); return; }
    const lib = readLib(); lib[name] = snapshotObject(); writeLib(lib); renderLib();
  });
  document.getElementById('clipExportAllBtn')?.addEventListener('click', ()=>{
    const lib = readLib();
    if(!Object.keys(lib).length){ alert('招式庫是空的'); return; }
    showExport(JSON.stringify({ format:'punch-studio-clip-lib', clips: lib }, null, 2),
      'Export · 招式庫(全部)', '{clips:{招式名:snapshot}} — 整份交給遊戲端接入 brawler-clips.js。');
  });
  renderLib();

  // ===== D. 連招預覽:把多個 combo 串成一條臨時時間軸循環播放(非破壞式;看整套連招的實戰表現)=====
  // 來源:貼上的 {clips:{...}} / [snap,...],留空則用招式庫(存入順序)。接招兩模式:取消接招(遊戲式)/ 完整播放。
  function normClip(s){ return (typeof normalizeState === 'function') ? normalizeState(s) : s; }
  function buildComboTimeline(snaps, cancelMode){
    const norm = snaps.map(normClip);
    const outSeq = [], outPhases = {}; const BLEND = 4;
    norm.forEach((clip, ci)=>{
      const pre = 'c'+ci+'_';
      if(ci === 0){
        clip.seq.forEach((k,i)=>{ const nm = i===0 ? 'idle' : pre+k.name;
          outSeq.push({ name:nm, frame:k.frame, ease:k.ease, impact:!!k.impact, cancel:!!k.cancel, tag:k.tag||'custom' });
          outPhases[nm] = clip.phases[k.name]; });
        return;
      }
      // 找接點:取消接招=最後一個 cancel→impact;完整播放=最後一個 key
      let cut = -1;
      if(cancelMode){
        for(let i=outSeq.length-1;i>=0;i--){ if(outSeq[i].cancel){cut=i;break;} }
        if(cut<0) for(let i=outSeq.length-1;i>=0;i--){ if(outSeq[i].impact){cut=i;break;} }
      }
      if(cut<0) cut = outSeq.length-1;
      for(let i=outSeq.length-1;i>cut;i--){ const rm=outSeq.pop(); if(rm.name!=='idle') delete outPhases[rm.name]; }
      const baseF = outSeq[outSeq.length-1].frame || 0;
      const inc = clip.seq.filter((k,i)=>i>0);
      const f0 = inc.length ? (inc[0].frame||0) : 0;
      inc.forEach((k,j)=>{ const nm = pre+k.name;
        outSeq.push({ name:nm, frame: baseF + BLEND + Math.max(0,(k.frame||0)-f0),
          ease:(j===0?'out':k.ease), impact:!!k.impact, cancel:!!k.cancel, tag:k.tag||'custom' });
        outPhases[nm] = clip.phases[k.name]; });
    });
    return { seq: outSeq, phases: outPhases, dim: {...DIM}, lags: norm[0] ? norm[0].lags : undefined };
  }
  function parseComboInput(text){
    const data = JSON.parse(text);
    if(Array.isArray(data)) return data;
    if(data && data.clips && typeof data.clips==='object') return Object.values(data.clips);
    if(data && data.seq && data.phases) return [data];
    throw new Error('格式需為 [snap,…] 或 {clips:{…}}');
  }

  let comboPrev = null;   // {state, cam} 預覽中才非 null
  function startComboPreview(snaps, cancelMode){
    if(!snaps || snaps.length < 1){ alert('沒有可預覽的招式:先把 combo 存進招式庫,或在框裡貼上 {clips:{…}}'); return; }
    const combo = buildComboTimeline(snaps, cancelMode);
    if(!comboPrev) comboPrev = { state: snapshotObject(), cam:{theta,phi,radius,fov:camera.fov} };
    applyStateData(combo, {rebuild:true});
    theta=Math.PI; phi=0.80; radius=5.4; camera.fov=32; camera.updateProjectionMatrix(); placeCam();   // 遊戲視角
    loop = true; playing = true; playT = 0; scrubActive = false; if(typeof updateUI==='function') updateUI();
    setPrevUI(true, snaps.length, cancelMode);
  }
  function stopComboPreview(){
    if(!comboPrev) return;
    playing = false; loop = false;
    applyStateData(comboPrev.state, {rebuild:true});
    const c = comboPrev.cam; theta=c.theta; phi=c.phi; radius=c.radius; camera.fov=c.fov; camera.updateProjectionMatrix(); placeCam();
    comboPrev = null; if(typeof updateUI==='function') updateUI();
    setPrevUI(false);
    try{ scheduleAutosave(); }catch(e){}
  }

  // UI:插進「遊戲整合」面板
  const grp = listEl ? listEl.closest('.group') : null;
  let prevBadge = null;
  function setPrevUI(on, n, cancelMode){
    const btn = document.getElementById('comboPrevBtn');
    if(btn){ btn.textContent = on ? '■ 停止連招預覽' : '▶ 連招預覽'; btn.style.borderColor = on ? 'var(--lime)' : ''; }
    if(!prevBadge){ prevBadge = document.createElement('div');
      prevBadge.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:60;font:bold 12px system-ui;color:#9dff43;background:rgba(10,12,20,.75);padding:3px 12px;border-radius:12px;pointer-events:none';
      document.body.appendChild(prevBadge); }
    prevBadge.textContent = on ? `▶ 連招預覽中 · ${n} 招 · ${cancelMode?'取消接招':'完整播放'}(Esc/按鈕停止)` : '';
    prevBadge.style.display = on ? '' : 'none';
  }
  if(grp){
    const box = document.createElement('div'); box.style.cssText='margin-top:8px;border-top:1px solid var(--line);padding-top:6px';
    box.innerHTML =
      '<div style="font-size:10.5px;color:var(--cy);margin-bottom:4px">連招預覽(串起多招看整套)</div>'
      + '<textarea id="comboInput" placeholder="貼上 {clips:{…}} 或 [snap,…];留空=用上面招式庫(存入順序)" '
      + 'style="width:100%;height:44px;box-sizing:border-box;background:#101322;border:1px solid var(--line);border-radius:7px;color:inherit;padding:5px 8px;font-size:10px;resize:vertical"></textarea>'
      + '<div style="display:flex;gap:6px;align-items:center;margin-top:5px">'
      + '<button id="comboPrevBtn" style="flex:1">▶ 連招預覽</button>'
      + '<label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer" title="勾=每招完整播放到收招再接下一招;不勾=下一招從上一招的 CANCEL/impact 點切入(遊戲式連打手感)">'
      + '<input type="checkbox" id="comboFull"> 完整播放</label></div>'
      + '<div class="timeline-help">看整套連招在遊戲鏡頭下的表現。預覽為唯讀:停止後回到你原本編輯的動作,招式庫不受影響。</div>';
    grp.appendChild(box);
    document.getElementById('comboPrevBtn').addEventListener('click', ()=>{
      if(comboPrev){ stopComboPreview(); return; }
      const cancelMode = !document.getElementById('comboFull').checked;
      const txt = (document.getElementById('comboInput').value||'').trim();
      let snaps;
      try{ snaps = txt ? parseComboInput(txt) : Object.values(readLib()); }
      catch(e){ alert('連招輸入解析失敗:'+e.message); return; }
      startComboPreview(snaps, cancelMode);
    });
  }
  window.addEventListener('keydown', e=>{ if(e.key==='Escape' && comboPrev) stopComboPreview(); });
  // headless 測試口
  window.__ps.comboPreview = { start:startComboPreview, stop:stopComboPreview, build:buildComboTimeline,
    get active(){ return !!comboPrev; } };
})();
