// punch-studio — game-bridge:__ps headless 健檢 hook + 遊戲整合面板(招式庫/🎮遊戲視角/impact 秒數讀出)
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// headless 健檢 hook(比照抽取器 __mpe)
window.__ps = {
  get parts() { return Object.keys(PART_MODELS); },
  get dummyHidden() { return PARTS_HIDE_DUMMY; },
  applyPose, get PHASES() { return PHASES; }, get SEQ() { return SEQ; },
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
})();
