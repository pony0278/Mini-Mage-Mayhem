// training.html only: the sandbox test panel (spawn dummies/crates, switch
// elements/mode/secondary, apply any upgrade, open the upgrade screen, reset
// build). Reads/mutates game state + drives sim helpers directly.
import { W, H } from './constants.js';
import { clamp } from './utils.js';
import { ELEMENT_INFO } from './data.js';
import { game } from './state.js';
import { SECONDARY, upgradePool, startRun, resetGame, spawnCrate, injectElement, syncSpell, openUpgrade } from './sim.js';

(function trainingPanel() {
  const panel = document.getElementById('train-panel');
  const showBtn = document.getElementById('tp-show');
  const readout = document.getElementById('tp-readout');
  const listEl = document.getElementById('tp-list');
  if (!panel) return;
  const applied = {};
  const btnFor = {};
  function spawnDummy() {
    const p = game.player; const a = Math.random() * Math.PI * 2; const d = 110 + Math.random() * 70;
    game.enemies.push({ type: 'slime', x: clamp(p.x + Math.cos(a) * d, 60, W - 60), y: clamp(p.y + Math.sin(a) * d, 60, H - 60),
      vx: 0, vy: 0, hp: 999999, maxHp: 999999, r: 16, speed: 0, color: '#75d56b', touch: 0, value: 0, hurt: 0,
      dummy: true, slowTimer: 0, chilled: false, stunTimer: 0, state: 'pursue', facing: 0, shootCd: 999, chargeCooldown: 999, blockTextCd: 0 });
  }
  function refresh() {
    const s = game.stats;
    const els = (s.spellElements || []).map(e => ELEMENT_INFO[e].name + (s.mastery[e] ? ('+' + s.mastery[e]) : '')).join(' + ') || '無';
    const sec = s.secondary ? SECONDARY[s.secondary].name : '無';
    const mods = ['split', 'explosive', 'trail', 'size'].filter(k => s[k]).map(k => k + s[k]).join(' ');
    const MAIN = { spell: '飛彈', fist: '土拳', lightpalm: '雷掌', windpalm: '風掌' };
    readout.textContent = '主法術：' + s.spellName + '\n元素：' + els + '\n主攻：' + (MAIN[s.mainMode] || s.mainMode) + '　副攻：' + sec + (mods ? '\n改造：' + mods : '');
  }
  function cat(up) {
    if (up.element) return '元素';
    if (up.id && up.id.indexOf('equip_') === 0) return '副攻';
    if (up.id && up.id.endsWith('_mode')) return '肉搏';
    if (up.id === 'dash_cd' || up.id === 'dash_power') return '衝刺';
    if (['vitality', 'swift', 'second_wind', 'vamp', 'haste', 'danger'].includes(up.id)) return '通用';
    return '改造';
  }
  function updateCounts() {
    for (const up of upgradePool) { const b = btnFor[up.id]; if (!b) continue; const n = applied[up.id] || 0; b.textContent = up.name + (n ? ' ×' + n : ''); b.classList.toggle('on', n > 0); }
  }
  function buildList() {
    const groups = {}; for (const up of upgradePool) (groups[cat(up)] = groups[cat(up)] || []).push(up);
    listEl.innerHTML = '';
    for (const g of ['元素', '改造', '衝刺', '副攻', '肉搏', '通用']) {
      if (!groups[g]) continue;
      const h = document.createElement('div'); h.className = 'tp-lh'; h.textContent = g; listEl.appendChild(h);
      const row = document.createElement('div'); row.className = 'tp-lrow';
      for (const up of groups[g]) {
        const btn = document.createElement('button'); btn.className = 'tp-li';
        btn.onclick = () => { up.apply(); applied[up.id] = (applied[up.id] || 0) + 1; updateCounts(); refresh(); };
        btnFor[up.id] = btn; row.appendChild(btn);
      }
      listEl.appendChild(row);
    }
    updateCounts();
  }
  function enterTraining() {
    if (game.state === 'title') startRun();
    game.training = true;
    game.enemies.length = 0; game.wave = 0;
    game.player.maxHp = 99999; game.player.hp = 99999;
    for (let i = 0; i < 5; i++) spawnDummy();
    addCrates();
    refresh();
  }
  function addCrates() {
    const p = game.player, a = p.facing || 0;
    for (let i = 0; i < 2; i++) spawnCrate(p.x + Math.cos(a) * (90 + i * 38), p.y + Math.sin(a) * (90 + i * 38));
  }
  function resetBuild() { for (const k in applied) delete applied[k]; resetGame(); enterTraining(); updateCounts(); }
  function toggle(hide) { panel.classList.toggle('hidden', hide); showBtn.style.display = hide ? 'block' : 'none'; }
  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const parts = b.dataset.act.split(':'); const k = parts[0], v = parts[1];
    if (k === 'el') { if (v === 'clear') { game.stats.spellElements = []; syncSpell(); } else injectElement(v); }
    else if (k === 'mas') { game.stats.mastery[v] = (game.stats.mastery[v] || 0) + 1; }
    else if (k === 'main') { game.stats.mainMode = v; }
    else if (k === 'sec') { game.stats.secondary = v === 'none' ? null : v; }
    else if (k === 'dummy') { if (v === 'add') { for (let i = 0; i < 3; i++) spawnDummy(); } else { game.enemies = game.enemies.filter(e => !e.dummy); } }
    else if (k === 'prop') { if (v === 'add') addCrates(); else game.props.length = 0; }
    else if (k === 'heal') { game.player.hp = game.player.maxHp; }
    else if (k === 'open') { openUpgrade(); }
    else if (k === 'list') { listEl.classList.toggle('hidden'); }
    else if (k === 'reset') { resetBuild(); }
    else if (k === 'ui') { toggle(true); }
    refresh();
  });
  showBtn.onclick = () => toggle(false);
  window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 't') toggle(!panel.classList.contains('hidden')); });
  buildList();
  enterTraining();
})();
