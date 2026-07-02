// render-hud.js — 單機 2D HUD (docs/render-module-boundaries.md):draw() 每幀先呼叫
// render3D 再畫 2D 覆蓋(血條/準星/橫幅/法術卡/標題/升級/結算/觸控)。v2 的 HUD 在 v2-hud.js。
// 外部請走 render.js 門面。
import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_WALL, TILE_THIN, TILE_GRASS, TILE_BURNT, TILE_WATER, TILE_ICE, TILE_ICEWALL, TILE_OIL, TILE_VOID } from './constants.js';
import { rnd, clamp, dist, angleTo, norm, circleRectOverlap } from './utils.js';
import { ELEMENT_INFO, arenaTemplates, fusionKind, isFireKind, isIceKind, isLightningKind, isPoisonKind, isEarthKind } from './data.js';
import { game, mouse, CAM, touch } from './state.js';
import { TOUCH_BTN, STICK_R } from './touch.js';
import { T } from './strings.js';
import { currentFlowName, dashElement, isMastery, isSecMastery, makeRunStory, nearestLiftable, nearestLiftableWallTile, previewSpellState, spellDescription, upgradeDesc, upgradeName, SECONDARY } from './sim.js';
import { project, mouseScreen, gl3dOk, camera } from './render-core.js';
import { render3D } from './render.js'; // 門面循環引用:draw() 執行期才呼叫,ESM 安全

const hud = document.getElementById('hud');
const screenCtx = hud.getContext('2d');
let ctx = screenCtx;

  // Enemy health bars, billboarded onto the HUD overlay.
  function drawEnemyBars() {
    for (const e of game.enemies) {
      if (e.type === 'boss') continue;
      if (!(e.maxHp && (e.type === 'charger' || e.hurt > 0 || e.hp < e.maxHp))) continue;
      const s = project(e.x, e.y, e.r * 2.4 + 22);
      if (s.behind) continue;
      const bw = e.type === 'charger' ? 42 : 28;
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(s.x - bw / 2, s.y, bw, 4);
      ctx.fillStyle = e.type === 'charger' ? '#ffd36d' : '#ff7b72'; ctx.fillRect(s.x - bw / 2, s.y, bw * pct, 4);
    }
  }

  // 凸眼 (panic faces): when an entity is launched hard / about to fall, billboard a pair of
  // cartoon bulging white eyes with trembling pupils over its head — the "oh no" beat that
  // sells a dumb death (v2 spec A). Cosmetic only; driven by sim's e.faceT countdown.
  export function drawPanicFaces() {
    for (const e of game.enemies) {
      if (!(e.faceT > 0)) continue;
      const s = project(e.x, e.y, (e.r || 14) * 2.2 + 6);
      if (s.behind) continue;
      const er = 6, off = 5;
      // tremble: tiny jitter on the pupils so the eyes read as panicked, not dead.
      const jx = Math.cos(game.time * 40) * 1.4, jy = Math.sin(game.time * 47) * 1.4;
      for (const dx of [-off, off]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x + dx, s.y, er, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0a0a12';
        ctx.beginPath(); ctx.arc(s.x + dx + jx, s.y + jy, er * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    }
  }


  // 風掌 crate prompts, billboarded onto the world: highlight a liftable crate, or
  // remind you that you can throw the one you're carrying.
  function drawCrateHints() {
    if (game.state !== 'playing' || game.stats.mainMode !== 'windpalm') return;
    const p = game.player;
    const cap = game.stats.windpalmStar || 1;
    if (p.held.length) {
      const it = p.held[0], s = project(it.x, it.y, it.r * 2.6 + 24);
      if (!s.behind) {
        const pulse = 0.6 + 0.4 * Math.sin(game.time * 8);
        const label = p.held.length > 1 ? `E 齊射 ×${p.held.length} →` : 'E 投擲 →';
        ctx.fillStyle = 'rgba(10,8,14,.6)'; roundRectPath(ctx, s.x - 60, s.y - 16, 120, 22, 8); ctx.fill();
        ctx.textAlign = 'center'; ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillStyle = `rgba(223,243,255,${pulse})`; ctx.fillText(label, s.x, s.y);
      }
    }
    if (p.held.length >= cap) return;
    const pr = nearestLiftable(p);
    // With no crate/foe in reach, look for a liftable wall. Lifting unlocks at ★3 — below that we still
    // surface a dimmed "★3 可拔牆" lock prompt so the player knows the feature exists and how to unlock it.
    const wall = !pr ? nearestLiftableWallTile(p) : null;
    const target = pr || wall;
    if (!target) return;
    const locked = !!wall && cap < 3;
    const label = pr ? 'E 舉起 ↑'
      : locked ? '★3 可拔牆'
      : (wall.kind === 'ice' ? 'E 拔冰牆 ↑' : 'E 拔薄牆 ↑');
    const tint = locked ? '150,152,172'
      : wall && wall.kind === 'ice' ? '191,244,255'
      : '223,243,255';
    const s = project(target.x ?? target.cx, target.y ?? target.cy, (target.r ? target.r * 2.4 : 28) + 14);
    if (s.behind) return;
    const pulse = locked ? 0.7 : 0.55 + 0.45 * Math.sin(game.time * 6); // locked = steady & dim, no pulsing ring
    ctx.save();
    ctx.strokeStyle = `rgba(${tint},${locked ? 0.5 : pulse})`; ctx.lineWidth = locked ? 1.5 : 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y + 10, (locked ? 16 : 20) + (locked ? 0 : 3 * Math.sin(game.time * 6)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(10,8,14,.6)'; roundRectPath(ctx, s.x - 50, s.y - 14, 100, 20, 8); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '900 12px system-ui, sans-serif';
    ctx.fillStyle = `rgba(${tint},${pulse})`; ctx.fillText(label, s.x, s.y);
  }

  // On-screen touch controls (mobile): dynamic move/aim sticks + fixed action buttons.
  function drawTouchControls() {
    if (!touch.enabled || game.state !== 'playing') return;
    ctx.save();
    const stick = (s, col) => {
      if (!s.active) return;
      ctx.strokeStyle = `rgba(${col},.4)`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, STICK_R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${col},.5)`;
      ctx.beginPath(); ctx.arc(s.ox + s.dx * STICK_R, s.oy + s.dy * STICK_R, 26, 0, Math.PI * 2); ctx.fill();
    };
    stick(touch.move, '160,200,255');
    stick(touch.aim, '255,190,120');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 19px system-ui, sans-serif';
    for (const k of ['dash', 'secondary', 'grab']) {
      if (k === 'grab' && (!game.stats || game.stats.mainMode !== 'windpalm')) continue; // E only matters for 風掌
      if (k === 'secondary' && (!game.stats || !game.stats.secondary)) continue;          // hide until a secondary is equipped
      const bd = TOUCH_BTN[k], pressed = touch.btn[k];
      ctx.fillStyle = pressed ? 'rgba(255,211,109,.45)' : 'rgba(20,16,26,.5)';
      ctx.strokeStyle = 'rgba(223,243,255,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bd.x, bd.y, bd.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eafaff'; ctx.fillText(bd.label, bd.x, bd.y);
    }
    ctx.restore();
  }

  export function draw() {
    // 3D world (WebGL) ...
    render3D();
    // ... then the crisp 2D HUD overlay on top.
    ctx = screenCtx;
    ctx.clearRect(0, 0, W, H);
    if (!gl3dOk) {
      ctx.fillStyle = '#1a1722'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff1bb'; ctx.textAlign = 'center';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText('WebGL is not enabled — the 3D view can\'t be shown', W / 2, H / 2 - 10);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('Use a newer browser, or enable hardware acceleration / WebGL', W / 2, H / 2 + 22);
      return;
    }
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 221, 148, ${game.flash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawEnemyBars();
    drawPanicFaces();
    drawCrateHints();
    drawFloatingTexts();
    drawReticle();
    drawUi();
    drawTouchControls();
    drawFusionBanner();
    drawBossPhaseBanner();

    if (game.state === 'title') drawTitle();
    if (game.state === 'upgrade') drawUpgrade();
    if (game.state === 'over') drawEnd(false);
    if (game.state === 'win') drawEnd(true);
  }


  function drawFloatingTexts() {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of game.floatingTexts) {
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      const s = project(t.x, t.y, 30);
      ctx.globalAlpha = alpha;
      const txt = T(t.text);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText(txt, s.x + 1, s.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(txt, s.x, s.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawReticle() {
    if (game.state !== 'playing') return;
    const s = project(mouse.x, mouse.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = 'rgba(255, 241, 187, .75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 9 + Math.sin(game.time * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-7, 0); ctx.moveTo(7, 0); ctx.lineTo(16, 0); ctx.moveTo(0, -16); ctx.lineTo(0, -7); ctx.moveTo(0, 7); ctx.lineTo(0, 16); ctx.stroke();
    ctx.restore();
  }


  function drawBossPhaseBanner() {
    const b = game.bossPhaseBanner;
    if (!b) return;
    const alpha = clamp(b.life / b.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.4);
    ctx.fillStyle = 'rgba(0, 0, 0, .46)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = b.color || '#ffdf7a';
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.fillText(T(b.text), W / 2, H / 2 - 20);
    ctx.fillStyle = '#fff1bb';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(T(b.sub), W / 2, H / 2 + 20);
    ctx.restore();
  }

  function drawFusionBanner() {
    const fb = game.fusionBanner;
    if (!fb) return;
    const alpha = clamp(fb.life / fb.maxLife, 0, 1);
    const pop = 1 + Math.sin((1 - alpha) * Math.PI) * 0.075;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.35);
    ctx.translate(W / 2, 104);
    ctx.scale(pop, pop);
    const grad = ctx.createLinearGradient(-270, -54, 270, 54);
    grad.addColorStop(0, 'rgba(29,18,42,.92)');
    grad.addColorStop(0.5, 'rgba(49,27,70,.92)');
    grad.addColorStop(1, 'rgba(23,17,34,.92)');
    ctx.fillStyle = grad;
    roundRectPath(ctx, -276, -58, 552, 112, 18); ctx.fill();
    ctx.strokeStyle = fb.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,211,109,.55)'; ctx.lineWidth = 1.5;
    roundRectPath(ctx, -260, -44, 520, 84, 12); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.shadowColor = fb.color; ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd36d';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText(fb.title === 'FUSION!' ? 'FUSION!' : 'SPELL SHIFT', 0, -22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fb.color;
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(T(fb.equation), 0, 8);
    ctx.fillStyle = '#fff2cf';
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText(T(fb.desc), 0, 33);
    ctx.restore();
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function elementIconInfo(el) {
    const map = {
      fire: ['🔥', '#ff8b47'], ice: ['❄', '#9feeff'], lightning: ['⚡', '#8fe8ff'], poison: ['☠', '#c07aff'],
      steam: ['☁', '#d8f6ff'], toxic_boom: ['☣', '#d998ff'], plasma: ['✦', '#ffcf6f'], frost_shock: ['✹', '#bff4ff'],
      toxic_shock: ['☠', '#b794ff'], venom_frost: ['◆', '#b7ffd2'], neutral: ['✦', '#f4e7ff'],
      earth: ['⬢', '#c79a5b'], magma: ['◉', '#ff7a3a'], frost_rock: ['❖', '#a9d8e6'], magnet: ['⊕', '#b8a0ff'], toxic_mire: ['⬟', '#9fae5a']
    };
    return map[el] || map.neutral;
  }

  function drawSpellFormulaCard(x, y, w, h) {
    const spellColor = ELEMENT_INFO[game.stats.spellKind]?.color || '#ffe6a7';
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(241,216,170,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(82,52,35,.75)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#3b2530'; ctx.font = '900 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SPELL FORMULA', x + w / 2, y + 23);
    const elems = (game.stats.spellElements && game.stats.spellElements.length) ? game.stats.spellElements : ['neutral'];
    for (let i = 0; i < 2; i++) {
      const ex = x + 22 + i * 54, ey = y + 38;
      const el = elems[i] || null;
      roundRectPath(ctx, ex, ey, 42, 42, 8);
      ctx.fillStyle = el ? elementIconInfo(el)[1] : 'rgba(60,40,35,.18)'; ctx.fill();
      ctx.strokeStyle = el ? '#5a3326' : 'rgba(60,40,35,.25)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = el ? '#fff' : 'rgba(60,40,35,.35)'; ctx.font = '900 23px system-ui, sans-serif';
      ctx.fillText(el ? elementIconInfo(el)[0] : '+', ex + 21, ey + 28);
    }
    ctx.fillStyle = '#5a3326'; ctx.font = '900 18px system-ui, sans-serif'; ctx.fillText('=', x + 128, y + 66);
    roundRectPath(ctx, x + 146, y + 38, 62, 42, 9); ctx.fillStyle = spellColor; ctx.fill(); ctx.strokeStyle = '#5a3326'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '900 22px system-ui, sans-serif'; ctx.fillText(elementIconInfo(game.stats.spellKind)[0], x + 177, y + 66);
    ctx.textAlign = 'right'; ctx.fillStyle = '#3b2530'; ctx.font = '900 13px system-ui, sans-serif';
    ctx.fillText(T(game.stats.spellName), x + w - 16, y + h - 16);
    ctx.restore();
  }

  function drawUi() {
    const p = game.player;
    ctx.save();
    // left toy-card HUD
    roundRectPath(ctx, 12, 12, 306, 92, 14);
    ctx.fillStyle = 'rgba(16, 12, 23, .74)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,211,109,.30)'; ctx.lineWidth = 2; ctx.stroke();
    // portrait frame
    roundRectPath(ctx, 24, 23, 52, 64, 10); ctx.fillStyle = '#2b1843'; ctx.fill(); ctx.strokeStyle = '#ffd36d'; ctx.stroke();
    ctx.fillStyle = '#6b35df'; ctx.beginPath(); ctx.moveTo(34, 50); ctx.lineTo(66, 50); ctx.lineTo(58, 30); ctx.lineTo(42, 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd36d'; ctx.fillRect(35, 51, 30, 4);
    ctx.fillStyle = '#76e7ff'; ctx.fillRect(42, 63, 5, 5); ctx.fillRect(53, 63, 5, 5);
    // hp bar
    ctx.fillStyle = '#311922'; ctx.fillRect(88, 30, 182, 18);
    const hpGrad = ctx.createLinearGradient(88, 30, 270, 30); hpGrad.addColorStop(0, '#ff554e'); hpGrad.addColorStop(1, '#ff9f45');
    ctx.fillStyle = hpGrad; ctx.fillRect(88, 30, 182 * clamp(p.hp / p.maxHp, 0, 1), 18);
    ctx.strokeStyle = '#ffd7bd'; ctx.strokeRect(88, 30, 182, 18);
    ctx.fillStyle = '#fff4db'; ctx.font = '900 14px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${Math.ceil(p.hp)} / ${p.maxHp}`, 278, 44);
    ctx.fillStyle = '#9fe7ff'; ctx.fillRect(88, 54, 148 * (1 - clamp(p.cooldown / Math.max(0.05, 0.18 * game.stats.cooldownMul), 0, 1)), 7);
    // dash charges (C): one pip per charge; the recharging pip fills up as it comes back.
    { const n = game.stats.dashCharges, pw = 15, gap = 4, py = 63, rt = Math.max(0.05, 1.1 * game.stats.dashCdMul);
      for (let i = 0; i < n; i++) {
        const x = 240 + i * (pw + gap);
        ctx.fillStyle = 'rgba(183,216,255,.16)'; ctx.fillRect(x, py, pw, 5);
        const f = i < p.dashStock ? 1 : (i === p.dashStock ? 1 - clamp(p.dashRecharge / rt, 0, 1) : 0);
        if (f > 0) { ctx.fillStyle = '#b7d8ff'; ctx.fillRect(x, py, pw * f, 5); }
      }
    }
    ctx.fillStyle = '#fff2cf'; ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`${game.bossStarted ? 'BOSS FIGHT' : 'WAVE ' + (game.wave || 0) + '/5'}   ☠ ${game.kills}   ✦ ${game.score}`, 88, 82);

    const boss = game.enemies.find(e => e.type === 'boss' && !e.dead);
    if (boss) {
      const pct = clamp(boss.hp / boss.maxHp, 0, 1);
      roundRectPath(ctx, 292, 16, 376, 34, 12); ctx.fillStyle = 'rgba(16, 12, 23, .76)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.stroke();
      ctx.fillStyle = '#173025'; ctx.fillRect(310, 30, 244, 10);
      ctx.fillStyle = boss.phase === 2 ? '#ffdf7a' : '#66e0a6'; ctx.fillRect(310, 30, 244 * pct, 10);
      ctx.strokeStyle = '#e8ffe8'; ctx.strokeRect(310, 30, 244, 10);
      ctx.fillStyle = '#e8ffe8'; ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${T('元素哥布林法師')}  P${boss.phase}`, 562, 39);
      if (game.bossAttackTimer > 0 && game.bossAttackLabel) {
        roundRectPath(ctx, 328, 56, 304, 26, 10); ctx.fillStyle = 'rgba(10, 8, 14, .78)'; ctx.fill();
        ctx.strokeStyle = boss.phase === 2 ? '#ffdf7a' : '#9fe7ff'; ctx.stroke();
        ctx.fillStyle = boss.phase === 2 ? '#ffdf7a' : '#d8f6ff'; ctx.textAlign = 'center'; ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillText(T(game.bossAttackLabel), 480, 74);
      }
    }

    drawSpellFormulaCard(704, 14, 244, 104);
    const runLine = `${game.run && game.run.arena ? T(game.run.arena.name) : T('未選場')}｜${T(currentFlowName())}`;
    ctx.textAlign = 'right'; ctx.fillStyle = '#d7c7ff'; ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText(runLine, 936, 132);

    if (game.messageTimer > 0 && game.message) {
      ctx.textAlign = 'center';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.52)'; ctx.fillText(T(game.message), W / 2 + 2, 154 + 2);
      ctx.fillStyle = '#fff1bb'; ctx.fillText(T(game.message), W / 2, 154);
    }

    if (game.state === 'playing' && game.run && game.time - game.run.startTime < 7.5) {
      roundRectPath(ctx, 204, H - 58, 552, 38, 12); ctx.fillStyle = 'rgba(10, 8, 14, .76)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,211,109,.25)'; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff1bb'; ctx.font = '900 14px system-ui, sans-serif';
      ctx.fillText('Tip: your single spell can be overwritten by Fire/Ice/Lightning/Poison — two elements fuse into a new spell.', W / 2, H - 34);
    }

    // 風掌 crate-control reminder (lift / throw), sits above the brawler tag.
    if (game.state === 'playing' && game.stats.mainMode === 'windpalm') {
      const heldN = p.held.length, cap = game.stats.windpalmStar || 1;
      roundRectPath(ctx, 16, H - 128, 214, 30, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = '#dff3ff'; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 12px system-ui, sans-serif'; ctx.fillStyle = '#eafaff';
      ctx.fillText(heldN ? `[E] Throw ×${heldN} →` : `[E] Near crate/foe${cap >= 3 ? '/wall' : ''} → grab (★${cap})`, 26, H - 108);
    }

    // Brawler tag: main attack is melee (土拳 / 雷掌 / 風掌).
    if (game.state === 'playing' && game.stats.mainMode !== 'spell') {
      const BRAWL = { fist: ['Melee · Earth Fist', '#e0b07a', '#ffdfa6'], lightpalm: ['Melee · Lightning Palm', '#9fe7ff', '#cdf3ff'], windpalm: ['Melee · Wind Palm', '#dff3ff', '#eafaff'] };
      const b = BRAWL[game.stats.mainMode] || BRAWL.fist;
      const starN = { fist: game.stats.fistStar, lightpalm: game.stats.lightStar, windpalm: game.stats.windpalmStar }[game.stats.mainMode] || 0;
      const stars = starN > 1 ? ' ' + '★'.repeat(starN) : '';
      roundRectPath(ctx, 16, H - 92, 168, 32, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = b[1]; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 13px system-ui, sans-serif'; ctx.fillStyle = b[2];
      ctx.fillText('Main [LMB]: ' + b[0] + stars, 26, H - 71);
    }

    // Secondary-attack indicator (bottom-left) — only once a secondary is equipped.
    if (game.state === 'playing' && game.stats.secondary) {
      const sec = SECONDARY[game.stats.secondary];
      const ready = p.secondaryCooldown <= 0;
      const icy = game.stats.secondary === 'icewall';
      roundRectPath(ctx, 16, H - 52, 150, 36, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = ready ? (icy ? '#bff4ff' : '#d1a06a') : 'rgba(255,255,255,.18)'; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 13px system-ui, sans-serif';
      ctx.fillStyle = ready ? '#fff1e2' : 'rgba(255,255,255,.5)';
      ctx.fillText('Secondary [RMB]', 26, H - 34);
      ctx.fillStyle = ready ? (icy ? '#bff4ff' : '#e0b07a') : 'rgba(255,255,255,.45)';
      ctx.fillText(sec ? T(sec.name) : '—', 26, H - 20);
      if (!ready && sec) {
        const f = 1 - p.secondaryCooldown / sec.cd;
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(108, H - 30, 48, 6);
        ctx.fillStyle = icy ? '#bff4ff' : '#e0b07a'; ctx.fillRect(108, H - 30, 48 * f, 6);
      }
    }
    ctx.restore();
  }

  function drawPanel(x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(33,24,45,.93)');
    g.addColorStop(1, 'rgba(14,11,20,.93)');
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,211,109,.32)';
    ctx.lineWidth = 3;
    ctx.stroke();
    roundRectPath(ctx, x + 8, y + 8, w - 16, h - 16, 12);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawTitle() {
    const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 520);
    bg.addColorStop(0, 'rgba(118,72,180,.35)'); bg.addColorStop(1, 'rgba(0,0,0,.76)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    drawPanel(150, 74, 660, 500);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd36d'; ctx.font = '900 46px system-ui, sans-serif';
    ctx.fillText('Mini Mage Mayhem', W / 2, 142);
    ctx.fillStyle = '#9fe7ff'; ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText('A top-down magic roguelike — 4 elements, fusions, chaos', W / 2, 178);
    ctx.fillStyle = '#f7ecd6'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('You have one spell. Upgrades overwrite it with elements.', W / 2, 218);
    ctx.fillText('Two elements fuse into a new spell that reshapes the battlefield.', W / 2, 244);
    const rows = [
      ['🔥 Fire', 'Fireball: ignites grass, detonates poison', '#ffbd66'],
      ['❄ Ice', 'Ice Shard: freezes water, slows foes', '#bff4ff'],
      ['☁ Fire + Ice', 'Steam Bomb: steam clouds, melt, slow', '#d8f6ff'],
      ['☣ Fire + Poison', 'Toxic Bomb: poison clouds that detonate', '#d998ff'],
      ['✦ Fire + Lightning', 'Plasma Bolt: explodes and conducts', '#ffd36d'],
      ['✹ Lightning + Ice', 'Frostvolt Bolt: conduct, slow, control', '#9fe7ff']
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 306 + i * 28;
      ctx.fillStyle = rows[i][2]; ctx.font = '900 16px system-ui, sans-serif'; ctx.fillText(rows[i][0], 300, y);
      ctx.fillStyle = '#f3e9dc'; ctx.font = '14px system-ui, sans-serif'; ctx.fillText(rows[i][1], 470, y);
    }
    ctx.fillStyle = '#ffd36d'; ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText('Tap or press Enter to start', W / 2, 522);
    ctx.fillStyle = '#c9c0d8'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('WASD move · Mouse aim · LMB cast · Space/Shift dash · R restart · (mobile: on-screen sticks)', W / 2, 550);
  }

  function upgradeMeta(up) {
    if (['inject_fire'].includes(up.id)) return { label: '元素', color: '#ffbd66' };
    if (['inject_ice'].includes(up.id)) return { label: '元素', color: '#bff4ff' };
    if (['inject_lightning'].includes(up.id)) return { label: '元素', color: '#9fe7ff' };
    if (['inject_poison'].includes(up.id)) return { label: '元素', color: '#d998ff' };
    if (['inject_earth'].includes(up.id)) return { label: '元素', color: '#c79a5b' };
    if (['split','explode','trail','big','spread','toxic_boom','ice_lake','ice_shatter','shock'].includes(up.id)) return { label: '改造', color: '#fff1bb' };
    if (up.id && up.id.indexOf('equip_') === 0) return { label: isSecMastery(up) ? '強化' : '副攻', color: '#8cecff' };
    if (['fist_mode','lightpalm_mode','windpalm_mode'].includes(up.id)) return { label: '肉搏', color: '#e0b07a' };
    if (['dash_cd','dash_power','dash_charge'].includes(up.id)) return { label: '衝刺', color: '#b7d8ff' };
    if (['danger','vamp','haste','vitality','swift','second_wind'].includes(up.id)) return { label: '通用', color: '#d7a0ff' };
    return { label: '升級', color: '#fff1bb' };
  }

  // Multiple build tags per upgrade card (max 3). See docs/design-vision §10.
  const TAGCOLOR = {
    '火': '#ffbd66', '冰': '#bff4ff', '雷': '#9fe7ff', '毒': '#d998ff', '風': '#dff3ff', '土': '#c79a5b', '精通': '#ffd36d',
    '元素': '#ffe6a7', '近戰': '#e0b07a', '環境': '#8ee07a', '控場': '#9fe7ff',
    '破壞': '#caa472', '高風險': '#ff7b72', '投擲': '#dff3ff', '衝刺': '#b7d8ff',
    '副攻': '#8cecff', '通用': '#d7a0ff', '改造': '#fff1bb', '畢業': '#ffcf6f'
  };
  function upgradeTags(up) {
    if (up.element) return isMastery(up) ? [ELEMENT_INFO[up.element].name, '精通'] : [ELEMENT_INFO[up.element].name, '元素'];
    const T = {
      split: ['改造'], explode: ['改造', '破壞'], trail: ['改造', '環境'], haste: ['改造'],
      big: ['改造'], vamp: ['通用'], spread: ['環境'], toxic_boom: ['毒', '環境'],
      shock: ['雷', '控場'], ice_lake: ['冰', '環境'], ice_shatter: ['冰', '控場'], danger: ['高風險'],
      dash_cd: ['衝刺'], dash_power: ['衝刺', '近戰'], dash_charge: ['衝刺'],
      equip_icewall: ['冰', '環境', '副攻'], equip_earthwall: ['環境', '破壞', '副攻'],
      equip_oil: ['火', '高風險', '副攻'], equip_blackhole: ['環境', '副攻'],
      fist_mode: ['近戰', '破壞'], lightpalm_mode: ['雷', '近戰', '控場'], windpalm_mode: ['風', '近戰', '控場'],
      vitality: ['通用'], swift: ['通用'], second_wind: ['通用'],
      cap_meteor: ['火', '土', '畢業'], cap_plague: ['火', '毒', '畢業'], cap_storm: ['土', '雷', '畢業'], cap_frostpoison: ['冰', '毒', '畢業'], cap_plasma: ['火', '雷', '畢業'], cap_glacier: ['土', '冰', '畢業'], cap_boil: ['火', '冰', '畢業'], cap_zero: ['雷', '冰', '畢業'], cap_venomnet: ['雷', '毒', '畢業'], cap_quagmire: ['土', '毒', '畢業']
    };
    return T[up.id] || ['升級'];
  }

  function drawUpgrade() {
    ctx.fillStyle = 'rgba(0,0,0,.64)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff0b5';
    ctx.font = '900 32px system-ui, sans-serif';
    ctx.fillText(game.wave >= 5 && !game.bossStarted ? 'Final upgrade before the boss!' : `Wave ${game.wave} cleared — pick an upgrade`, W / 2, 126);
    ctx.fillStyle = '#e9dcff';
    ctx.font = '700 15px system-ui, sans-serif';
    if (game.stats.mainMode === 'spell') {
      ctx.fillText(`Spell: ${T(game.stats.spellName)} | ${T(spellDescription(game.stats.spellKind))}`, W / 2, 154);
    } else {
      const BNAME = { fist: 'Earth Fist', lightpalm: 'Lightning Palm', windpalm: 'Wind Palm' }[game.stats.mainMode] || 'Melee';
      const els = game.stats.spellElements || [];
      const elTxt = els.length ? els.map(e => T((ELEMENT_INFO[e] && ELEMENT_INFO[e].name) || e)).join('+') : 'none';
      const reach = game.stats.mainMode === 'fist' ? 'punch/dash/secondary' : 'dash/secondary';
      ctx.fillText(`Main: ${BNAME} (melee) | element: ${elTxt} (affects ${reach})`, W / 2, 154);
    }
    for (let i = 0; i < game.upgrades.length; i++) {
      const up = game.upgrades[i];
      const x = 165 + i * 215;
      const y = 198;
      drawPanel(x, y, 195, 238);
      // build tags (chips)
      const tags = upgradeTags(up).slice(0, 3);
      ctx.textAlign = 'left';
      ctx.font = '900 11px system-ui, sans-serif';
      let chipX = x + 14;
      for (const t of tags) {
        const w = ctx.measureText(T(t)).width + 12;
        roundRectPath(ctx, chipX, y + 12, w, 18, 5);
        ctx.fillStyle = TAGCOLOR[t] || '#fff1bb'; ctx.fill();
        ctx.fillStyle = '#1b1420';
        ctx.fillText(T(t), chipX + 6, y + 25);
        chipX += w + 4;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd36d';
      ctx.font = '900 19px system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${T(upgradeName(up))}`, x + 98, y + 58);

      if (up.element && !isMastery(up) && game.stats.mainMode === 'spell') { // projectile preview only when you actually have a projectile
        const preview = previewSpellState(up.element);
        const color = ELEMENT_INFO[preview.kind]?.color || '#fff1bb';
        const before = game.stats.spellName;
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x + 16, y + 78, 163, 62);
        ctx.strokeStyle = preview.fused ? color : 'rgba(255,255,255,.14)';
        ctx.lineWidth = preview.fused ? 2 : 1;
        ctx.strokeRect(x + 16, y + 78, 163, 62);
        ctx.fillStyle = preview.fused ? color : '#fff08a';
        ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillText(preview.fused ? 'Fusion preview' : 'Spell change', x + 98, y + 96);
        ctx.fillStyle = '#f3e9dc';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillText(`${T(before)} →`, x + 98, y + 116);
        ctx.fillStyle = color;
        ctx.font = '900 16px system-ui, sans-serif';
        ctx.fillText(T(preview.name), x + 98, y + 134);
        ctx.fillStyle = '#e9dcff';
        ctx.font = '13px system-ui, sans-serif';
        wrapText(T(preview.desc), x + 98, y + 166, 158, 17);
      } else {
        ctx.fillStyle = '#e9dcff';
        ctx.font = '14px system-ui, sans-serif';
        wrapText(T(upgradeDesc(up)), x + 98, y + 92, 158, 18);
      }

      ctx.fillStyle = '#8cecff';
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillText('Tap or press ' + (i + 1), x + 98, y + 214);
    }
    ctx.fillStyle = '#c9c0d8';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(game.stats.mainMode === 'spell'
      ? 'Tip: element upgrades reshape your single attack; two fuse, a third replaces the oldest.'
      : 'Tip: melee main attack ignores elements; they infuse your dash & secondary (and the Earth Fist punch).', W / 2, 478);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const chars = [...text];
    let line = '';
    let yy = y;
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = ch;
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function drawEnd(win) {
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(0, 0, W, H);
    drawPanel(216, 76, 528, 520);
    ctx.textAlign = 'center';
    ctx.fillStyle = win ? '#afff9d' : '#ffb29d';
    ctx.font = '900 38px system-ui, sans-serif';
    ctx.fillText(win ? 'Victory! Disaster Survivor' : 'You Died — Magic Unleashed', W / 2, 138);
    ctx.fillStyle = '#f3e9dc';
    ctx.font = '17px system-ui, sans-serif';
    wrapText(T(makeRunStory(win)), W / 2, 174, 456, 20);
    ctx.fillText(`Spell: ${T(game.stats.spellName)} | Arena: ${game.run && game.run.arena ? T(game.run.arena.name) : T('未知')} | Flow: ${T(currentFlowName())}`, W / 2, 224);
    ctx.fillText(`Kills: ${game.kills}   Score: ${game.score}`, W / 2, 258);
    ctx.fillText(`Biggest boom kills: ${game.biggestBoom}   Poison detonations: ${game.chainBooms}`, W / 2, 292);
    ctx.fillText(`Water shocks: ${game.stats.waterElectrocutes}   Frozen pools: ${game.stats.frozenWater}   Steam clouds: ${game.stats.steamClouds}`, W / 2, 326);
    ctx.fillText(`Grass burnt / Walls broken: ${game.stats.burnedGrass}/${game.stats.shatteredWalls}   Fusions: ${game.stats.fusions}`, W / 2, 360);
    ctx.fillText(`Elite kills / Back hits / Blocks: ${game.stats.elitesKilled} / ${game.stats.backHits} / ${game.stats.frontBlocks}`, W / 2, 384);
    ctx.fillText(`Boss damage: ${Math.round(game.stats.bossDamage)}   Last hit: ${T(game.stats.bossLastHit)}`, W / 2, 406);
    ctx.fillStyle = '#fff08a';
    ctx.font = '800 16px system-ui, sans-serif';
    wrapText(`Biggest disaster: ${T(game.stats.biggestDisaster)}`, W / 2, 434, 450, 20);
    ctx.fillStyle = '#f3e9dc';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = '#fff1bb';
    ctx.font = '700 15px system-ui, sans-serif';
    const evText = game.run && game.run.events.length ? game.run.events.map(T).join(' → ') : 'none';
    wrapText('Events: ' + evText, W / 2, 466, 440, 20);
    ctx.fillStyle = '#d7c7ff';
    const buildText = game.stats.upgradeNames.length ? game.stats.upgradeNames.map(T).join(' / ') : 'none';
    const spellText = game.stats.spellHistory ? game.stats.spellHistory.map(T).join(' → ') : T(game.stats.spellName);
    const fusionText = game.stats.fusionLog && game.stats.fusionLog.length ? ' | Fusions: ' + game.stats.fusionLog.map(T).join(' / ') : '';
    wrapText('Spell evo: ' + spellText + fusionText, W / 2, 506, 440, 20);
    wrapText('Build: ' + buildText, W / 2, 544, 440, 20);
    ctx.fillStyle = '#9fe7ff';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText('Press R / tap to restart', W / 2, 574);
  }

