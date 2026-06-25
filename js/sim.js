import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_WALL, TILE_THIN, TILE_GRASS, TILE_BURNT, TILE_WATER, TILE_ICE, TILE_ICEWALL, TILE_OIL } from './constants.js';
import { rnd, clamp, dist, angleTo, norm, circleRectOverlap } from './utils.js';
import { ELEMENT_INFO, arenaTemplates, fusionKind, isFireKind, isIceKind, isLightningKind, isPoisonKind, isEarthKind } from './data.js';
import { game, keys, mouse, CAM } from './state.js';

// Headless-ish simulation core: state mutation + all game logic. Imports only
// data/state/constants/utils; never imports render/input/main (DAG invariant).
// NOTE: still reads CAM/mouse/keys directly — the intent adapter (step 3.5)
// will replace those with an explicit update(dt, intent).

  export const waveEvents = [
    {
      id: 'overgrowth', name: '草地蔓延', desc: '本波開始前長出更多草地。',
      apply: () => {
        for (let i = 0; i < 5; i++) growGrassPatch();
      }
    },
    {
      id: 'toxic_supply', name: '毒霧補給', desc: '場上多出數團毒霧，可以被火元素引爆。',
      apply: () => {
        for (let i = 0; i < 3; i++) {
          const p = randomOpenSpot(150);
          addPoisonCloud(p.x, p.y, rnd(30, 44), 5.5);
        }
      }
    },
    {
      id: 'leaking_floor', name: '地板滲水', desc: '場上生成新的水池，雷鏈導電與冰面機會增加。',
      apply: () => {
        for (let i = 0; i < 3; i++) addWaterPatch();
      }
    },
    {
      id: 'frost_cracks', name: '寒霜裂縫', desc: '場上出現冰面，衝鋒怪可能會滑倒。',
      apply: () => {
        for (let i = 0; i < 3; i++) addIcePatch();
      }
    },
    {
      id: 'frenzy', name: '暴走小怪', desc: '本波敵人更多、速度更快。',
      apply: (mods) => {
        mods.enemySpeedMul *= 1.18;
        mods.enemyCountMul *= 1.18;
      }
    },
    {
      id: 'overload', name: '魔力過載', desc: '本波你的傷害提高，但自傷也提高。',
      apply: (mods) => {
        mods.damageMul *= 1.22;
        mods.selfDamageMul *= 1.28;
      }
    },
    {
      id: 'elite_patrol', name: '菁英巡邏', desc: '本波額外出現一隻盾甲衝鋒怪。',
      minWave: 3,
      apply: (mods) => {
        mods.extraChargers += 1;
      }
    }
  ];


  export const upgradePool = [
    { id: 'inject_fire', element: 'fire', name: '注入火焰', desc: '把目前魔法飛彈改造成火球；若已有冰，會融合成蒸氣彈。', apply: () => injectElement('fire') },
    { id: 'inject_ice', element: 'ice', name: '注入寒冰', desc: '把目前魔法飛彈改造成冰箭；若已有火，會融合成蒸氣彈。', apply: () => injectElement('ice') },
    { id: 'inject_lightning', element: 'lightning', name: '注入雷電', desc: '把目前魔法飛彈改造成雷彈；命中水池會導電。', apply: () => injectElement('lightning') },
    { id: 'inject_poison', element: 'poison', name: '注入劇毒', desc: '把目前魔法飛彈改造成毒彈；若已有火，會融合成毒爆彈。', apply: () => injectElement('poison') },
    { id: 'inject_earth', element: 'earth', name: '注入大地', desc: '把目前魔法飛彈改造成巨石：重擊擊退、打碎薄牆、迸出碎石；與火/冰/雷/毒融合成熔岩/凍岩/磁暴/毒沼。', apply: () => injectElement('earth') },
    { id: 'split', name: '分裂', desc: '目前魔法飛彈變成多發，適合擴大元素災難。', apply: () => { game.stats.split += 1; toast('魔法飛彈開始分裂！'); } },
    { id: 'explode', name: '命中爆炸', desc: '目前魔法飛彈命中或撞牆時會爆炸。', apply: () => { game.stats.explosive += 1; toast('命中會爆炸！'); } },
    { id: 'trail', name: '元素留痕', desc: '飛行路徑會留下目前元素的殘留區域。', apply: () => { game.stats.trail += 1; toast('飛彈開始留下元素痕跡！'); } },
    { id: 'haste', name: '快速施法', desc: '主攻擊冷卻降低 25%。', apply: () => { game.stats.cooldownMul *= 0.75; toast('施法速度提升！'); } },
    { id: 'big', name: '巨大化', desc: '半徑、傷害、反應範圍提高（飛彈／拳／衝刺／災難都吃）。', apply: () => { game.stats.size += 1; toast('威能變大了！'); } },
    { id: 'vamp', name: '災難回血', desc: '引爆毒霧或擊殺敵人時，少量回血。', apply: () => { game.stats.siphon += 1; toast('混亂正在餵養你！'); } },
    { id: 'spread', name: '元素蔓延', desc: '火焰、毒霧、蒸氣等區域效果更大。', apply: () => { game.stats.fireSpread += 1; toast('元素區域開始失控！'); } },
    { id: 'toxic_boom', name: '毒爆擴大', desc: '毒霧被點燃時，爆炸範圍與傷害提高。', apply: () => { game.stats.poisonBoom += 1; toast('毒霧變得更危險！'); } },
    { id: 'shock', name: '導電麻痺', desc: '雷電導通水池時更容易打斷衝鋒怪。', apply: () => { game.stats.shockStun += 1; game.stats.storm += 1; toast('電流開始麻痺敵人！'); } },
    { id: 'ice_lake', name: '大冰面', desc: '冰元素凍水範圍提高，緩速時間增加。', apply: () => { game.stats.iceRadius += 1; game.stats.iceSlow += 1; toast('水池開始結成大片冰面！'); } },
    { id: 'ice_shatter', name: '寒冰碎裂', desc: '被冰系飛彈緩速的敵人死亡時會小範圍冰爆。', apply: () => { game.stats.iceShatter += 1; toast('冰凍敵人會碎裂！'); } },
    { id: 'danger', name: '危險魔力', desc: '所有傷害大幅提高，但自傷也提高。', apply: () => { game.stats.damageMul *= 1.28; game.stats.selfDamageMul *= 1.24; toast('你變強了，也更危險了！'); } },
    { id: 'dash_cd', name: '疾風步', desc: '衝刺冷卻降低 30%。', apply: () => { game.stats.dashCdMul *= 0.7; toast('衝刺更頻繁了！'); } },
    { id: 'dash_power', name: '衝刺強化', desc: '衝刺傷害、擊退與元素留痕提高（衝刺流派）。', apply: () => { game.stats.dashPower += 1; toast('衝刺變成武器了！'); } },
    { id: 'dash_charge', name: '疾風連步', desc: '衝刺多一段充能，可連續衝刺（雙閃/三閃）。', apply: () => { game.stats.dashCharges += 1; game.player.dashStock = game.stats.dashCharges; toast('衝刺多一段！'); } },
    { id: 'cap_meteor', name: '流星降臨', desc: '畢業大絕（火+土）：戰鬥中持續天降流星，落點預警後爆炸並留下岩漿池。', apply: () => { game.stats.capstone = 'meteor'; toast('流星降臨！從此天降災厄'); } },
    { id: 'cap_plague', name: '瘟疫核爆', desc: '畢業大絕（火+毒）：你佈下的毒霧會週期性自動連環引爆（距你太近的不引爆）。', apply: () => { game.stats.capstone = 'plague'; toast('瘟疫核爆！毒霧開始自爆'); } },
    { id: 'cap_storm', name: '磁暴奇點', desc: '畢業大絕（土+雷）：週期生成磁力奇點把敵人吸成一團，塌縮時雷鏈貫穿引爆。', apply: () => { game.stats.capstone = 'storm'; toast('磁暴奇點！敵人將被吸攏電穿'); } },
    { id: 'cap_frostpoison', name: '凍毒領域', desc: '畢業大絕（冰+毒）：身周凝結持續凍毒光環，範圍內敵人被冰緩並中毒。', apply: () => { game.stats.capstone = 'frostpoison'; toast('凍毒領域！身周凝結劇毒寒霜'); } },
    { id: 'cap_plasma', name: '電漿風暴', desc: '畢業大絕（火+雷）：一顆電漿球在場上自走，週期爆裂並雷鏈導電，獵殺敵人。', apply: () => { game.stats.capstone = 'plasma'; toast('電漿風暴！電漿球開始獵殺'); } },
    { id: 'cap_glacier', name: '冰川崩落', desc: '畢業大絕（土+冰）：週期在敵群外圍升起冰牆短暫關籠，隨即同時碎裂成大範圍冰爆。', apply: () => { game.stats.capstone = 'glacier'; toast('冰川崩落！冰牆將困敵碎裂'); } },
    { id: 'cap_boil', name: '沸騰領域', desc: '畢業大絕（火+冰）：全場籠罩蒸氣風暴，所有敵人持續減速並被灼燒。', apply: () => { game.stats.capstone = 'boil'; toast('沸騰領域！全場沸騰蒸騰'); } },
    { id: 'equip_earthwall', name: '副攻：土牆', desc: '副攻改成土牆，更耐久、可被爆炸炸開重塑戰場。', apply: () => equipOrLevelSecondary('earthwall') },
    { id: 'equip_icewall', name: '副攻：冰牆', desc: '副攻改成冰牆，遇火融成蒸氣、附近減速。', apply: () => equipOrLevelSecondary('icewall') },
    { id: 'equip_oil', name: '副攻：潑油', desc: '副攻改成潑油；油遇火會大範圍爆燃（佈場縱火流）。', apply: () => equipOrLevelSecondary('oil') },
    { id: 'equip_blackhole', name: '副攻：黑洞', desc: '副攻改成黑洞；吸聚敵人與災難後塌縮爆炸。', apply: () => equipOrLevelSecondary('blackhole') },
    { id: 'fist_mode', name: '土拳・肉搏', desc: '主攻擊改成近戰土拳：高傷擊退、打破牆、附帶當前元素效果。放棄遠程飛彈，成為肉搏戰士。', apply: () => { game.stats.mainMode = 'fist'; toast('你成了肉搏戰士！'); } },
    { id: 'lightpalm_mode', name: '雷掌・肉搏', desc: '主攻擊改成近戰電掌：擊退 + 短雷鏈，踩水放電整片水池（也會電到自己）。放棄遠程飛彈。', apply: () => { game.stats.mainMode = 'lightpalm'; toast('主攻換成雷掌！'); } },
    { id: 'windpalm_mode', name: '風掌・肉搏', desc: '主攻擊改成近戰風掌：錐形強力擊退、把火/毒/蒸氣往前吹。放棄遠程飛彈。重選→升星，一次可累積撿取更多並齊射。', apply: () => { const s = game.stats; if (s.mainMode === 'windpalm') { s.windpalmStar = Math.min(3, s.windpalmStar + 1); toast('風掌升星！可累積撿取 ' + s.windpalmStar + ' 個齊射'); } else { s.mainMode = 'windpalm'; s.windpalmStar = 1; toast('主攻換成風掌！'); } } },
    { id: 'vitality', name: '強健體魄', desc: '最大生命 +25，並立即回復同等生命。', apply: () => { game.player.maxHp += 25; healPlayer(25); toast('體質增強！'); } },
    { id: 'swift', name: '迅捷', desc: '移動速度 +12%。', apply: () => { game.player.speed *= 1.12; toast('腳程變快！'); } },
    { id: 'second_wind', name: '回春', desc: '立即回復 40% 最大生命。', apply: () => { healPlayer(game.player.maxHp * 0.4); toast('回復生命！'); } }
  ];

  export function resetGame() {
    game.state = 'title';
    game.time = 0;
    game.score = 0;
    game.kills = 0;
    game.biggestBoom = 0;
    game.chainBooms = 0;
    game.wave = 0;
    game.waveClearTimer = 0;
    game.screenShake = 0;
    game.flash = 0;
    game.message = '';
    game.messageTimer = 0;
    game.fireballs.length = 0;
    game.enemyProjectiles.length = 0;
    game.lightningBolts.length = 0;
    game.iceBolts.length = 0;
    game.enemies.length = 0;
    game.poisonClouds.length = 0;
    game.steamClouds.length = 0;
    game.fireZones.length = 0;
    game.electricZones.length = 0;
    game.explosions.length = 0;
    game.walls.length = 0;
    game.oils.length = 0;
    game.blackHoles.length = 0;
    game.plasmaOrb = null;
    game.glaciers = null;
    game.props.length = 0;
    game.bossWarnings.length = 0;
    game.particles.length = 0;
    game.rings.length = 0;
    game.slams.length = 0;
    game.floatingTexts.length = 0;
    game.upgrades.length = 0;
    game.run = {
      arena: null,
      events: [],
      eventDescs: [],
      started: false,
      startTime: 0
    };
    game.waveMods = { enemySpeedMul: 1, enemyCountMul: 1, damageMul: 1, selfDamageMul: 1, extraChargers: 0 };
    game.fusionBanner = null;
    game.bossPhaseBanner = null;
    game.bossAttackLabel = '';
    game.bossAttackTimer = 0;
    game.bossStarted = false;
    game.bossDefeated = false;
    game.stats = {
      split: 0,
      explosive: 0,
      trail: 0,
      cooldownMul: 1,
      dashCdMul: 1,
      dashPower: 0,
      dashCharges: 1,
      capstone: null,   // build 畢業大絕 id（一局一條）：'meteor'(火+土) / 'plague'(火+毒) / 'storm'(土+雷) / 'frostpoison'(冰+毒) / 'plasma'(火+雷) / 'glacier'(土+冰) / 'boil'(火+冰)
      secondary: null,
      secondaryLvl: { icewall: 0, earthwall: 0, oil: 0, blackhole: 0 },
      mainMode: 'spell',
      windpalmStar: 0,  // 風掌星級 (1–3)；= 風掌一次可累積撿取的數量（0 = 未選風掌）
      mastery: { fire: 0, ice: 0, lightning: 0, poison: 0, earth: 0 },
      size: 0,
      siphon: 0,
      lightningChain: 0,
      lightningCooldownMul: 1,
      storm: 0,
      shots: 0,
      lightningCasts: 0,
      iceCasts: 0,
      frozenWater: 0,
      iceFalls: 0,
      iceKills: 0,
      bossDamage: 0,
      bossSummons: 0,
      bossPhase: 1,
      bossHazards: 0,
      bossLastHit: '尚未命中 Boss',
      bossKillSource: '',
      deathSource: '',
      bossPhaseTwo: false,
      waterElectrocutes: 0,
      burnedGrass: 0,
      shatteredWalls: 0,
      maxCombo: 0,
      frontBlocks: 0,
      backHits: 0,
      chargerStuns: 0,
      elitesKilled: 0,
      damageMul: 1,
      selfDamageMul: 1,
      enemyCountMul: 1,
      fireSpread: 0,
      poisonBoom: 0,
      shockStun: 0,
      iceCooldownMul: 1,
      iceRadius: 0,
      iceSlow: 0,
      iceShatter: 0,
      selfHits: 0,
      biggestDisaster: '尚未發生',
      biggestDisasterScore: 0,
      spellElements: [],
      spellKind: 'neutral',
      spellName: '魔法飛彈',
      elementPicks: 0,
      fusions: 0,
      steamClouds: 0,
      spellHistory: ['普通魔法飛彈'],
      fusionLog: [],
      upgradeNames: []
    };
    game.player = {
      x: W / 2,
      y: H / 2,
      r: 13,
      hp: 100,
      maxHp: 100,
      speed: 220,
      cooldown: 0,
      lightningCooldown: 0,
      iceCooldown: 0,
      dashStock: 1,
      dashRecharge: 0,
      dashTapCd: 0,
      dashTime: 0,
      dashTrailCd: 0,
      dashHits: null,
      dashDirX: 0,
      dashDirY: 0,
      dashSpeed: 520,
      lungeStrike: false,
      dashEl: null,
      dashCharge: false,
      dashArrive: false,
      fistHand: 0,
      fistAnim: 0,
      fistAnimMax: 0.14,
      fistCombo: 0,
      fistComboTimer: 0,
      secondaryCooldown: 0,
      held: [],   // 風掌撿起的東西(木箱/小怪混裝)，上限 = windpalmStar
      eDown: false,
      invuln: 0,
      hurtTimer: 0,
      facing: 0,
      vx: 0,
      vy: 0
    };
    makeMap('garden');
  }

  export function startRun() {
    if (game.state !== 'title') return;
    const arena = arenaTemplates[Math.floor(Math.random() * arenaTemplates.length)];
    game.run.arena = arena;
    game.run.started = true;
    game.run.startTime = game.time;
    makeMap(arena.id);
    game.state = 'playing';
    toast(`普通魔法飛彈 / ${arena.name}`);
    spawnWave();
  }

  export function makeMap(template = 'garden') {
    game.map = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        let t = TILE_FLOOR;
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) t = TILE_WALL;
        row.push(t);
      }
      game.map.push(row);
    }

    if (template === 'garden') {
      fillRectTiles(2, 2, 7, 5, TILE_GRASS);
      fillRectTiles(20, 2, 8, 5, TILE_GRASS);
      fillRectTiles(2, 13, 8, 5, TILE_GRASS);
      fillRectTiles(20, 13, 8, 5, TILE_GRASS);
      fillRectTiles(12, 7, 6, 6, TILE_GRASS);
      fillRectTiles(7, 8, 3, 2, TILE_WATER);
      fillRectTiles(21, 10, 3, 2, TILE_WATER);
      fillRectTiles(12, 4, 1, 5, TILE_THIN);
      fillRectTiles(18, 11, 1, 5, TILE_THIN);
    } else if (template === 'toxic') {
      fillRectTiles(3, 3, 4, 3, TILE_GRASS);
      fillRectTiles(22, 14, 5, 3, TILE_GRASS);
      fillRectTiles(6, 7, 3, 2, TILE_WATER);
      fillRectTiles(21, 7, 3, 2, TILE_WATER);
      fillRectTiles(10, 4, 1, 12, TILE_THIN);
      fillRectTiles(19, 4, 1, 12, TILE_THIN);
      fillRectTiles(12, 4, 6, 1, TILE_THIN);
      fillRectTiles(12, 15, 6, 1, TILE_THIN);
      for (let i = 0; i < 5; i++) {
        const p = randomOpenSpot(170);
        addPoisonCloud(p.x, p.y, rnd(28, 42), 5.8);
      }
    } else if (template === 'temple') {
      fillRectTiles(5, 4, 5, 3, TILE_WATER);
      fillRectTiles(20, 4, 5, 3, TILE_WATER);
      fillRectTiles(5, 13, 5, 3, TILE_WATER);
      fillRectTiles(20, 13, 5, 3, TILE_WATER);
      fillRectTiles(13, 8, 4, 4, TILE_WATER);
      fillRectTiles(3, 3, 4, 3, TILE_GRASS);
      fillRectTiles(23, 14, 4, 3, TILE_GRASS);
      fillRectTiles(12, 3, 1, 5, TILE_THIN);
      fillRectTiles(17, 12, 1, 5, TILE_THIN);
    } else if (template === 'maze') {
      fillRectTiles(5, 4, 20, 1, TILE_THIN);
      fillRectTiles(5, 15, 20, 1, TILE_THIN);
      fillRectTiles(7, 5, 1, 7, TILE_THIN);
      fillRectTiles(22, 8, 1, 7, TILE_THIN);
      fillRectTiles(13, 4, 1, 5, TILE_THIN);
      fillRectTiles(16, 11, 1, 5, TILE_THIN);
      fillRectTiles(3, 3, 5, 4, TILE_GRASS);
      fillRectTiles(22, 13, 5, 4, TILE_GRASS);
      fillRectTiles(7, 8, 3, 2, TILE_WATER);
      fillRectTiles(20, 9, 3, 2, TILE_WATER);
    }

    // Keep player spawn clean.
    fillRectTiles(13, 9, 4, 3, TILE_FLOOR);

    // Scatter a few interactive crates (keystone props): push / break / charge them.
    game.props.length = 0;
    const crateN = 3 + Math.floor(Math.random() * 2); // 3–4
    for (let i = 0; i < crateN; i++) { const s = randomOpenSpot(150); spawnCrate(s.x, s.y); }
  }

  export function fillRectTiles(tx, ty, tw, th, tile) {
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1) game.map[y][x] = tile;
      }
    }
  }


  export function randomOpenSpot(minDist = 120) {
    for (let tries = 0; tries < 250; tries++) {
      const tx = Math.floor(rnd(2, COLS - 2));
      const ty = Math.floor(rnd(2, ROWS - 2));
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (isSolidTile(game.map[ty][tx])) continue;
      if (game.player && Math.hypot(x - game.player.x, y - game.player.y) < minDist) continue;
      return { x, y, tx, ty };
    }
    return { x: W / 2 + rnd(-160, 160), y: H / 2 + rnd(-120, 120), tx: 15, ty: 10 };
  }

  export function growGrassPatch() {
    const p = randomOpenSpot(145);
    const w = Math.floor(rnd(2, 5));
    const h = Math.floor(rnd(2, 4));
    fillRectTiles(clamp(p.tx - Math.floor(w / 2), 1, COLS - w - 1), clamp(p.ty - Math.floor(h / 2), 1, ROWS - h - 1), w, h, TILE_GRASS);
  }

  export function addWaterPatch() {
    const p = randomOpenSpot(135);
    const w = Math.floor(rnd(2, 4));
    const h = Math.floor(rnd(1, 3));
    fillRectTiles(clamp(p.tx - Math.floor(w / 2), 1, COLS - w - 1), clamp(p.ty - Math.floor(h / 2), 1, ROWS - h - 1), w, h, TILE_WATER);
  }

  export function addIcePatch() {
    const p = randomOpenSpot(135);
    const w = Math.floor(rnd(2, 5));
    const h = Math.floor(rnd(1, 3));
    fillRectTiles(clamp(p.tx - Math.floor(w / 2), 1, COLS - w - 1), clamp(p.ty - Math.floor(h / 2), 1, ROWS - h - 1), w, h, TILE_ICE);
  }




  export function spellDisplayName(kind) {
    const names = {
      neutral: '魔法飛彈', fire: '火球', ice: '冰箭', lightning: '雷彈', poison: '毒彈',
      steam: '蒸氣彈', toxic_boom: '毒爆彈', plasma: '電漿彈', frost_shock: '電霜彈',
      toxic_shock: '電毒彈', venom_frost: '毒冰刺',
      earth: '巨石', magma: '熔岩彈', frost_rock: '凍岩', magnet: '磁暴彈', toxic_mire: '毒沼彈'
    };
    return names[kind] || '融合飛彈';
  }

  export function syncSpell() {
    const kind = fusionKind(game.stats.spellElements || []);
    game.stats.spellKind = kind;
    game.stats.spellName = spellDisplayName(kind);
  }

  export function spellDescription(kind) {
    const desc = {
      neutral: '中性傷害，穩定但不會觸發元素反應。',
      fire: '點燃草地與敵人，可引爆毒霧。',
      ice: '緩速敵人，命中水池會凍成冰面。',
      lightning: '命中敵人會連鎖，打到水池會導電。',
      poison: '命中後留下毒霧，適合佈置陷阱。',
      steam: '命中產生蒸氣雲，緩速並融化冰面，能遮住戰場。',
      toxic_boom: '火毒融合，毒霧更容易爆燃，命中會製造連鎖爆炸。',
      plasma: '火雷融合，命中爆裂並導電，清場強但自傷危險。',
      frost_shock: '雷冰融合，導電與緩速並存，適合控住衝鋒怪。',
      toxic_shock: '雷毒融合，產生帶電毒雲，持續傷害與連鎖兼具。',
      venom_frost: '冰毒融合，緩速並留下毒性冰刺，控場穩定。',
      earth: '巨石彈，重擊擊退、打碎薄牆，落地迸出碎石。',
      magma: '土火融合，重擊後留下大片岩漿火池，焚燒兼控場。',
      frost_rock: '土冰融合，重擊強化減速，凍住水面、破薄牆。',
      magnet: '土雷融合，命中磁力吸引周圍敵人聚成一團再雷鏈。',
      toxic_mire: '土毒融合，落地生成減速且持續中毒的毒沼。'
    };
    return desc[kind] || '未知融合，會造成不穩定的元素災難。';
  }

  export function elementLabel(element) {
    return (ELEMENT_INFO[element] && ELEMENT_INFO[element].name) || '無';
  }

  export function previewSpellState(element) {
    let next = [...(game.stats.spellElements || [])];
    const before = [...next];
    if (!next.includes(element)) {
      if (next.length < 2) next.push(element);
      else next = [next[1], element];
    }
    const kind = fusionKind(next);
    const replaced = before.length >= 2 && !before.includes(element);
    const fused = next.length >= 2;
    return {
      elements: next,
      kind,
      name: spellDisplayName(kind),
      desc: spellDescription(kind),
      fused,
      replaced,
      element
    };
  }

  export function previewSpellName(element) {
    return previewSpellState(element).name;
  }

  export function fusionEquation(elements, resultKind) {
    const left = elements.length ? elements.map(elementLabel).join(' + ') : '中性';
    return `${left} = ${spellDisplayName(resultKind)}`;
  }

  export function injectElement(element) {
    let elements = [...(game.stats.spellElements || [])];
    // Already own this element → no wasted pick: deepen it (mastery, B step 1).
    if (elements.includes(element)) {
      game.stats.mastery[element] = (game.stats.mastery[element] || 0) + 1;
      game.stats.elementPicks++;
      const lvl = game.stats.mastery[element];
      const nm = ELEMENT_INFO[element].name + '精通';
      addText(game.player.x, game.player.y - 42, `${nm} Lv${lvl}`, ELEMENT_INFO[element].color);
      game.fusionBanner = { title: 'MASTERY', equation: `${nm} Lv${lvl}`, desc: masteryDesc(element), life: 1.45, maxLife: 1.45, color: ELEMENT_INFO[element].color };
      toast(`${nm}！`);
      return;
    }
    const before = game.stats.spellName || '魔法飛彈';
    const preview = previewSpellState(element);
    if (elements.length < 2) elements.push(element);
    else elements = [elements[1], element]; // replace the oldest element
    game.stats.spellElements = elements;
    const oldKind = game.stats.spellKind;
    syncSpell();
    game.stats.elementPicks++;
    const after = game.stats.spellName;
    const isFusion = oldKind !== game.stats.spellKind && elements.length >= 2;
    if (isFusion) game.stats.fusions++;
    game.stats.spellHistory.push(after);
    const equation = fusionEquation(elements, game.stats.spellKind);
    if (isFusion) game.stats.fusionLog.push(equation);
    addText(game.player.x, game.player.y - 42, `${before} → ${after}`, ELEMENT_INFO[game.stats.spellKind]?.color || '#fff1bb');
    if (isFusion) {
      game.fusionBanner = { title: 'FUSION!', equation, desc: spellDescription(game.stats.spellKind), life: 2.15, maxLife: 2.15, color: ELEMENT_INFO[game.stats.spellKind]?.color || '#fff1bb' };
      toast(`融合完成：${equation}`);
    } else {
      game.fusionBanner = { title: 'SPELL SHIFT', equation, desc: spellDescription(game.stats.spellKind), life: 1.45, maxLife: 1.45, color: ELEMENT_INFO[game.stats.spellKind]?.color || '#fff1bb' };
      toast(`目前主法術：${after}`);
    }
  }

  export function currentFlowName() {
    const kind = game.stats.spellKind || 'neutral';
    if (kind === 'steam') return '蒸氣控場流';
    if (kind === 'toxic_boom') return '火毒爆燃流';
    if (kind === 'plasma') return '電漿破壞流';
    if (kind === 'frost_shock') return '電霜控場流';
    if (kind === 'toxic_shock') return '電毒雲流';
    if (kind === 'venom_frost') return '毒冰緩速流';
    if (kind === 'fire') return '火焰燃燒流';
    if (kind === 'ice') return '冰面控場流';
    if (kind === 'lightning') return '雷池清場流';
    if (kind === 'poison') return '毒霧消耗流';
    const chaos = Math.max(0, game.stats.damageMul - 1) * 4 + Math.max(0, game.stats.selfDamageMul - 1) * 2;
    if (chaos > 1) return '危險混沌流';
    return '中性飛彈流';
  }

  export function tileAtPixel(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return TILE_WALL;
    return game.map[ty][tx];
  }

  export function isSolidTile(t) { return t === TILE_WALL || t === TILE_THIN || t === TILE_ICEWALL; }

  export function circleHitsSolid(x, y, r) {
    const minX = Math.floor((x - r) / TILE);
    const maxX = Math.floor((x + r) / TILE);
    const minY = Math.floor((y - r) / TILE);
    const maxY = Math.floor((y + r) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
        if (isSolidTile(game.map[ty][tx]) && circleRectOverlap(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
      }
    }
    return false;
  }

  export function damagePlayer(amount, source = '災難') {
    const p = game.player;
    if (p.invuln > 0 || game.state !== 'playing') return;
    const hazard = /爆|火焰地板|毒霧|水池導電/.test(source);
    if (hazard) {
      amount *= (game.stats.selfDamageMul || 1) * ((game.waveMods && game.waveMods.selfDamageMul) || 1);
      game.stats.selfHits++;
    }
    p.hp -= amount;
    p.hurtTimer = 0.22;
    p.invuln = 0.35;
    game.screenShake = Math.max(game.screenShake, 7.5);
    game.flash = Math.max(game.flash, 0.07);
    addRing(p.x, p.y, 24, '#ffb3a1', 0.28, 3);
    addText(p.x, p.y - 26, '-' + Math.round(amount), '#ffb3a1');
    if (p.hp <= 0) {
      p.hp = 0;
      game.state = 'over';
      game.stats.deathSource = source;
      game.message = makeDeathMessage(source);
    }
  }

  export function healPlayer(amount) {
    const p = game.player;
    const old = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > old) addText(p.x, p.y - 40, '+' + Math.round(p.hp - old), '#9dffb5');
  }

  export function spawnWave() {
    game.wave += 1;
    game.waveClearTimer = 0;
    game.fireballs.length = 0;
    game.enemyProjectiles.length = 0;
    game.waveMods = { enemySpeedMul: 1, enemyCountMul: 1, damageMul: 1, selfDamageMul: 1, extraChargers: 0 };
    game.fusionBanner = null;

    const validEvents = waveEvents.filter(ev => !ev.minWave || game.wave >= ev.minWave);
    const ev = validEvents[Math.floor(Math.random() * validEvents.length)];
    if (ev) {
      ev.apply(game.waveMods);
      game.run.events.push(ev.name);
      game.run.eventDescs.push(ev.desc);
      game.message = `第 ${game.wave} 波：${ev.name}`;
      game.messageTimer = 1.7;
    } else {
      game.message = `第 ${game.wave} 波開始！`;
      game.messageTimer = 1.4;
    }

    const wave = game.wave;
    const add = (type, n) => {
      const total = Math.max(1, Math.round(n * game.stats.enemyCountMul * game.waveMods.enemyCountMul));
      for (let i = 0; i < total; i++) spawnEnemy(type);
    };
    if (wave === 1) { add('slime', 6); }
    if (wave === 2) { add('slime', 6); add('bug', 3); }
    if (wave === 3) { add('slime', 6); add('bug', 4); add('charger', 1); }
    if (wave === 4) { add('slime', 7); add('bug', 4); add('imp', 3); add('charger', 1); }
    if (wave === 5) { add('slime', 7); add('bug', 5); add('imp', 3); add('charger', 1); }
    for (let i = 0; i < game.waveMods.extraChargers; i++) spawnEnemy('charger');
    while (game.props.length < 3) { const s = randomOpenSpot(150); spawnCrate(s.x, s.y); } // keep a few crates around
  }

  export function spawnEnemy(type) {
    let x, y;
    for (let tries = 0; tries < 100; tries++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = rnd(80, W - 80); y = 70; }
      if (side === 1) { x = rnd(80, W - 80); y = H - 70; }
      if (side === 2) { x = 70; y = rnd(80, H - 80); }
      if (side === 3) { x = W - 70; y = rnd(80, H - 80); }
      if (!circleHitsSolid(x, y, 15) && Math.hypot(x - game.player.x, y - game.player.y) > 220) break;
    }
    const presets = {
      slime: { hp: 28, r: 14, speed: rnd(72, 94), color: '#75d56b', touch: 9, value: 10 },
      bug: { hp: 20, r: 12, speed: rnd(98, 125), color: '#9b5fd1', touch: 7, value: 14 },
      imp: { hp: 34, r: 13, speed: rnd(64, 82), color: '#ff8b47', touch: 10, value: 20 },
      charger: { hp: 92, r: 18, speed: rnd(66, 78), color: '#c2a66e', touch: 16, value: 55 }
    };
    const e = Object.assign({
      type, x, y, vx: 0, vy: 0, hurt: 0, shootCd: rnd(0.4, 1.6),
      state: 'pursue', stateTimer: 0, chargeCooldown: rnd(0.6, 1.4), facing: angleTo({ x, y }, game.player),
      stunTimer: 0, blockTextCd: 0, slowTimer: 0, chilled: false
    }, presets[type]);
    e.speed *= ((game.waveMods && game.waveMods.enemySpeedMul) || 1);
    if (game.wave >= 4) e.hp *= 1.08;
    e.maxHp = e.hp;
    game.enemies.push(e);
  }

  export function spawnBoss() {
    game.bossStarted = true;
    game.bossDefeated = false;
    game.bossWarnings.length = 0;
    game.enemyProjectiles.length = 0;
    const e = {
      type: 'boss',
      x: W / 2,
      y: 96,
      vx: 0,
      vy: 0,
      hp: 660,
      maxHp: 660,
      r: 30,
      speed: 78,
      color: '#66e0a6',
      touch: 15,
      value: 500,
      hurt: 0,
      shootCd: 0,
      state: 'boss',
      stateTimer: 0,
      facing: Math.PI / 2,
      slowTimer: 0,
      chilled: false,
      attackCd: 2.25,
      summonCd: 7.2,
      phase: 1,
      bossName: '元素哥布林法師'
    };
    game.enemies.push(e);
    game.message = 'Boss 登場：元素哥布林法師！';
    game.messageTimer = 2.6;
    game.bossAttackLabel = '觀察 Boss 預警圈';
    game.bossAttackTimer = 3.2;
    game.fusionBanner = { title: 'BOSS!', equation: '元素哥布林法師', desc: '先看地上的預警圈：毒、火、雷、水會連續改變戰場。', life: 2.8, maxLife: 2.8, color: '#66e0a6' };
    addText(W / 2, 140, 'BOSS FIGHT', '#66e0a6');
    addRing(e.x, e.y, 96, '#66e0a6', 0.75, 5);
    game.screenShake = Math.max(game.screenShake, 8);
  }

  export function spawnEnemyNear(type, x, y) {
    const presets = {
      slime: { hp: 28, r: 14, speed: rnd(72, 94), color: '#75d56b', touch: 9, value: 10 },
      bug: { hp: 20, r: 12, speed: rnd(98, 125), color: '#9b5fd1', touch: 7, value: 14 },
      imp: { hp: 34, r: 13, speed: rnd(64, 82), color: '#ff8b47', touch: 10, value: 20 },
      charger: { hp: 92, r: 18, speed: rnd(66, 78), color: '#c2a66e', touch: 16, value: 55 }
    };
    const p = presets[type];
    if (!p) return;
    let sx = x, sy = y;
    for (let tries = 0; tries < 40; tries++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(42, 88);
      sx = clamp(x + Math.cos(a) * d, 48, W - 48);
      sy = clamp(y + Math.sin(a) * d, 48, H - 48);
      if (!circleHitsSolid(sx, sy, p.r)) break;
    }
    const e = Object.assign({
      type, x: sx, y: sy, vx: 0, vy: 0, hurt: 0, shootCd: rnd(0.6, 1.6),
      state: 'pursue', stateTimer: 0, chargeCooldown: rnd(0.8, 1.5), facing: angleTo({ x: sx, y: sy }, game.player),
      stunTimer: 0, blockTextCd: 0, slowTimer: 0, chilled: false
    }, p);
    if (game.bossStarted) e.hp *= 0.85;
    e.maxHp = e.hp;
    game.enemies.push(e);
  }

  // --- element mastery (B): a per-element level that scales that element's
  // signature effects, read at use-time (see spawnSpellProjectile / addFireZone
  // / addPoisonCloud / chillEnemy / lightning jumps). Picking an owned element
  // levels it up — never a wasted pick, and the pool never dries late game.
  export function mLvl(el) { return (game.stats.mastery && game.stats.mastery[el]) || 0; }
  export function spellMastery() { let s = 0; for (const el of (game.stats.spellElements || [])) s += mLvl(el); return s; }
  export function masteryDesc(element) {
    return {
      fire: '火焰精通：每級提升火球傷害、火場範圍與燃燒強度。',
      ice: '寒冰精通：每級提升緩速時間、冰面範圍與傷害。',
      lightning: '雷電精通：每級增加雷鏈跳數與導電強度。',
      poison: '劇毒精通：每級擴大毒霧範圍、提升毒傷與毒爆。',
      earth: '大地精通：每級提升巨石撞擊傷害、碎石與擊退。'
    }[element] || '強化目前元素。';
  }
  export function isMastery(up) { return up.element && (game.stats.spellElements || []).includes(up.element); }
  // equip_X for the already-equipped secondary reads as a 強化 (mastery) card.
  export function isSecMastery(up) { return up.id && up.id.indexOf('equip_') === 0 && game.stats.secondary === up.id.slice('equip_'.length); }
  export function upgradeName(up) {
    if (isMastery(up)) return ELEMENT_INFO[up.element].name + '精通 Lv' + (mLvl(up.element) + 1);
    if (isSecMastery(up)) { const id = up.id.slice('equip_'.length); return SECONDARY[id].name + '強化 Lv' + (sLvl(id) + 1); }
    if (up.id === 'windpalm_mode' && game.stats.mainMode === 'windpalm') return '風掌 ★' + Math.min(3, game.stats.windpalmStar + 1);
    return up.name;
  }
  export function upgradeDesc(up) {
    if (isMastery(up)) return masteryDesc(up.element);
    if (isSecMastery(up)) return '副攻強化：範圍/耐久更大，冷卻更短。';
    return up.desc;
  }
  // Would this upgrade actually do something for the current build?
  export function upgradeRelevant(up) {
    const s = game.stats;
    const owns = (el) => (s.spellElements || []).includes(el);
    // equip_X is always meaningful now: equip (none yet) / swap (different) / 強化 (same → mastery).
    if (up.id && up.id.indexOf('equip_') === 0) return true;
    if (up.id === 'fist_mode') return s.mainMode !== 'fist';        // already that brawler stance
    if (up.id === 'lightpalm_mode') return s.mainMode !== 'lightpalm';
    if (up.id === 'windpalm_mode') return s.mainMode !== 'windpalm' || s.windpalmStar < 3; // 重選 → 升星(上限 ★3)
    if (up.id === 'ice_lake' || up.id === 'ice_shatter') return owns('ice');
    if (up.id === 'shock') return owns('lightning');
    if (up.id === 'toxic_boom') return owns('poison');
    if (up.id === 'dash_charge') return s.dashCharges < 3; // cap at triple-dash
    if (up.id === 'split' || up.id === 'explode' || up.id === 'trail') return s.mainMode === 'spell'; // pure-projectile mechanics — dead once a brawler stance is picked
    if (up.id === 'cap_meteor') return !s.capstone && owns('fire') && owns('earth'); // capstone: one per run, gated on the fire+earth combo
    if (up.id === 'cap_plague') return !s.capstone && owns('fire') && owns('poison'); // capstone: fire+poison
    if (up.id === 'cap_storm') return !s.capstone && owns('earth') && owns('lightning'); // capstone: earth+lightning
    if (up.id === 'cap_frostpoison') return !s.capstone && owns('ice') && owns('poison'); // capstone: ice+poison
    if (up.id === 'cap_plasma') return !s.capstone && owns('fire') && owns('lightning'); // capstone: fire+lightning
    if (up.id === 'cap_glacier') return !s.capstone && owns('earth') && owns('ice'); // capstone: earth+ice
    if (up.id === 'cap_boil') return !s.capstone && owns('fire') && owns('ice'); // capstone: fire+ice
    return true; // inject_* (inject or mastery) and generics are always meaningful
  }
  export function openUpgrade() {
    game.state = 'upgrade';
    game.upgrades = [];
    let pool = upgradePool.filter(upgradeRelevant);
    for (let i = 0; i < 3 && pool.length; i++) {
      const pick = Math.floor(Math.random() * pool.length);
      game.upgrades.push(pool.splice(pick, 1)[0]);
    }
  }

  export function applyUpgrade(index) {
    const up = game.upgrades[index];
    if (!up) return;
    game.stats.upgradeNames.push(upgradeName(up));
    up.apply();
    game.state = 'playing';
    if (game.training) return; // training arena: apply effect only, no wave progression
    if (game.wave >= 5 && !game.bossStarted) {
      healPlayer(18);
      addText(game.player.x, game.player.y - 46, 'Boss 前恢復', '#afff9d');
      spawnBoss();
    } else if (game.bossStarted && game.bossDefeated) {
      game.state = 'win';
      game.message = '你擊敗了元素哥布林法師！';
    } else {
      spawnWave();
    }
  }

  export function shoot(angle) {
    const p = game.player;
    const baseCount = 1 + Math.min(game.stats.split, 2) * 2;
    const spread = baseCount === 1 ? 0 : 0.16 + game.stats.split * 0.045;
    for (let i = 0; i < baseCount; i++) {
      const offset = (i - (baseCount - 1) / 2) * spread;
      spawnSpellProjectile(p.x + Math.cos(angle) * 20, p.y + Math.sin(angle) * 20, angle + offset);
    }
    game.stats.shots++;
  }

  export function spawnSpellProjectile(x, y, angle) {
    const sizeLevel = game.stats.size;
    const kind = game.stats.spellKind || 'neutral';
    const info = ELEMENT_INFO[kind] || ELEMENT_INFO.neutral;
    const speedByKind = { neutral: 510, fire: 480, ice: 440, lightning: 570, poison: 430, steam: 390, toxic_boom: 420, plasma: 520, frost_shock: 500, toxic_shock: 480, venom_frost: 440, earth: 360, magma: 380, frost_rock: 360, magnet: 430, toxic_mire: 350 };
    const mm = spellMastery(); // total mastery across the spell's current elements
    const r = ((kind === 'steam' ? 10 : 7) + sizeLevel * 2) * (1 + 0.04 * mm);
    const baseDamage = { neutral: 15, fire: 17, ice: 12, lightning: 15, poison: 10, steam: 11, toxic_boom: 14, plasma: 18, frost_shock: 14, toxic_shock: 13, venom_frost: 12, earth: 21, magma: 19, frost_rock: 16, magnet: 15, toxic_mire: 12 }[kind] || 14;
    const speed = speedByKind[kind] || 480;
    game.fireballs.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r, kind, color: info.color, coreColor: info.core,
      damage: (baseDamage + sizeLevel * 5) * (1 + 0.10 * mm),
      life: kind === 'steam' ? 1.25 : 1.45,
      trailTick: 0,
      explosive: game.stats.explosive > 0 || kind === 'toxic_boom' || kind === 'plasma',
      trail: game.stats.trail > 0,
      boomRadius: 42 + game.stats.explosive * 15 + sizeLevel * 8,
      fromPlayer: true
    });
    game.screenShake = Math.max(game.screenShake, 1.1);
    for (let i = 0; i < 5; i++) {
      const a = angle + rnd(-0.9, 0.9);
      game.particles.push({ x, y, vx: Math.cos(a) * rnd(-60, 40), vy: Math.sin(a) * rnd(-60, 40), r: rnd(1.5, 3), life: rnd(0.12, 0.28), maxLife: 0.28, color: info.color });
    }
  }

  export function castIce(angle) {
    const p = game.player;
    game.stats.iceCasts++;
    const speed = 430;
    game.iceBolts.push({
      x: p.x + Math.cos(angle) * 18,
      y: p.y + Math.sin(angle) * 18,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 7,
      damage: 9 + game.stats.iceSlow * 2,
      life: 1.25,
      freezeRadius: 48 + game.stats.iceRadius * 18,
      slowTime: 1.25 + game.stats.iceSlow * 0.55
    });
    game.screenShake = Math.max(game.screenShake, 1.1);
    for (let i = 0; i < 8; i++) {
      const a = angle + rnd(-0.75, 0.75);
      game.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * rnd(70, 210), vy: Math.sin(a) * rnd(70, 210), r: rnd(1.5, 3), life: rnd(0.18, 0.42), maxLife: 0.42, color: '#bff4ff' });
    }
  }

  export function freezeWaterAt(x, y, radius) {
    let count = 0;
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        if (game.map[ty][tx] === TILE_WATER) {
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          if (Math.hypot(cx - x, cy - y) <= radius + 18) {
            game.map[ty][tx] = TILE_ICE;
            count++;
            if (Math.random() < 0.5) game.particles.push({ x: cx, y: cy, vx: rnd(-35,35), vy: rnd(-45,10), r: rnd(2,4), life: rnd(0.35,0.75), maxLife: 0.75, color: '#bff4ff' });
          }
        }
      }
    }
    if (count > 0) {
      game.stats.frozenWater += count;
      addRing(x, y, radius, '#bff4ff', 0.42, 3);
      addText(x, y - 28, '水池結冰！', '#bff4ff');
      recordDisaster('冰凍水池', 0, radius);
    }
    return count;
  }

  export function chillEnemy(e, time, sourceX, sourceY) {
    const im = mLvl('ice'); // ice mastery → longer slow + more damage
    e.slowTimer = Math.max(e.slowTimer || 0, time + im * 0.25);
    e.chilled = true;
    damageEnemy(e, 9 + game.stats.iceSlow * 2 + im * 2, sourceX, sourceY);
    addText(e.x, e.y - e.r - 12, '緩速', '#bff4ff');
    addRing(e.x, e.y, e.r + 10, '#bff4ff', 0.25, 2);
  }

  export function addIceBurst(x, y, r = 52, damage = 18) {
    addRing(x, y, r, '#bff4ff', 0.44, 4);
    game.screenShake = Math.max(game.screenShake, 4.5);
    game.stats.iceKills++;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < r + e.r && e.hp > 0) {
        e.slowTimer = Math.max(e.slowTimer || 0, 1.15 + game.stats.iceSlow * 0.35);
        damageEnemy(e, damage * (1 - d / (r + e.r) * 0.4), x, y);
      }
    }
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, Math.PI * 2);
      game.particles.push({ x, y, vx: Math.cos(a) * rnd(70, 240), vy: Math.sin(a) * rnd(70, 240), r: rnd(1.5, 4), life: rnd(0.35,0.75), maxLife: 0.75, color: Math.random() < 0.5 ? '#bff4ff' : '#e8fbff' });
    }
  }



  export function chainLightningFrom(x, y, firstTarget = null, damage = 14) {
    let current = firstTarget || nearestEnemy(x, y, 180);
    const hit = new Set();
    let fromX = x, fromY = y;
    const jumps = 1 + Math.min(4, game.stats.storm + game.stats.shockStun + (game.stats.spellKind === 'lightning' ? 1 : 0)) + Math.min(3, mLvl('lightning'));
    for (let i = 0; i <= jumps && current; i++) {
      hit.add(current);
      game.lightningBolts.push({ x1: fromX, y1: fromY, x2: current.x, y2: current.y, life: 0.14, maxLife: 0.14 });
      damageEnemy(current, damage, fromX, fromY);
      fromX = current.x; fromY = current.y;
      current = nearestEnemy(fromX, fromY, 145 + game.stats.storm * 18, hit);
    }
  }

  export function castLightning(angle) {
    const p = game.player;
    game.stats.lightningCasts++;
    const target = findLightningTarget(angle);
    const waterTarget = findWaterTarget(angle);
    let x2 = p.x + Math.cos(angle) * 320;
    let y2 = p.y + Math.sin(angle) * 320;
    let hitSomething = false;

    if (target) {
      x2 = target.x;
      y2 = target.y;
      let current = target;
      const hit = new Set();
      const jumps = 2 + game.stats.lightningChain * 2 + Math.min(3, mLvl('lightning'));
      for (let i = 0; i <= jumps && current; i++) {
        hit.add(current);
        const fromX = i === 0 ? p.x : x2;
        const fromY = i === 0 ? p.y : y2;
        game.lightningBolts.push({ x1: fromX, y1: fromY, x2: current.x, y2: current.y, life: 0.16, maxLife: 0.16 });
        damageEnemy(current, 18 + game.stats.lightningChain * 4, fromX, fromY);
        x2 = current.x;
        y2 = current.y;
        current = nearestEnemy(current.x, current.y, 135 + game.stats.lightningChain * 22, hit);
        hitSomething = true;
      }
    }

    if (waterTarget) {
      game.lightningBolts.push({ x1: p.x, y1: p.y, x2: waterTarget.x, y2: waterTarget.y, life: 0.18, maxLife: 0.18 });
      addElectricZone(waterTarget.x, waterTarget.y, 62 + game.stats.storm * 26, 0.9 + game.stats.storm * 0.12);
      addText(waterTarget.x, waterTarget.y - 28, '水池導電！', '#9fe7ff');
      hitSomething = true;
    }

    if (!hitSomething) {
      game.lightningBolts.push({ x1: p.x, y1: p.y, x2, y2, life: 0.12, maxLife: 0.12 });
      addText(p.x + Math.cos(angle) * 70, p.y + Math.sin(angle) * 70, '雷鏈落空', '#a9c7ff');
    }
    game.screenShake = Math.max(game.screenShake, 2.6);
    for (let i = 0; i < 12; i++) {
      const a = angle + rnd(-0.8, 0.8);
      game.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * rnd(80, 240), vy: Math.sin(a) * rnd(80, 240), r: rnd(1.5, 3.5), life: rnd(0.16, 0.38), maxLife: 0.38, color: '#9fe7ff' });
    }
  }

  export function findLightningTarget(angle) {
    let best = null;
    let bestScore = Infinity;
    for (const e of game.enemies) {
      const dx = e.x - game.player.x;
      const dy = e.y - game.player.y;
      const d = Math.hypot(dx, dy);
      if (d > 390) continue;
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle)));
      if (da > 0.62) continue;
      const mouseBias = Math.hypot(e.x - mouse.x, e.y - mouse.y) * 0.45;
      const score = d + mouseBias + da * 120;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  export function nearestEnemy(x, y, range, exclude = new Set()) {
    let best = null;
    let bestD = Infinity;
    for (const e of game.enemies) {
      if (exclude.has(e) || e.dead || e.hp <= 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < range && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  export function findWaterTarget(angle) {
    if (tileAtPixel(mouse.x, mouse.y) === TILE_WATER) return { x: mouse.x, y: mouse.y };
    for (let d = 24; d <= 380; d += 16) {
      const x = game.player.x + Math.cos(angle) * d;
      const y = game.player.y + Math.sin(angle) * d;
      if (tileAtPixel(x, y) === TILE_WATER) return { x, y };
      if (isSolidTile(tileAtPixel(x, y))) return null;
    }
    return null;
  }

  export function addElectricZone(x, y, r, life = 0.8) {
    game.electricZones.push({ x, y, r, life, maxLife: life, tick: 0, pulse: 0 });
    game.stats.waterElectrocutes++;
    game.flash = Math.max(game.flash, 0.08);
    game.screenShake = Math.max(game.screenShake, 5);
    addRing(x, y, r, '#9fe7ff', 0.42, 4);
  }

  export function spawnEnemyBolt(enemy) {
    const a = angleTo(enemy, game.player);
    const speed = 230;
    game.enemyProjectiles.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 6,
      damage: 9,
      life: 2.5,
      color: '#ff945a'
    });
  }


  export function addSteamCloud(x, y, r, life = 3.2) {
    game.steamClouds.push({ x, y, r: r + game.stats.fireSpread * 4, life, maxLife: life, pulse: rnd(0, 6.28), tick: 0 });
    game.stats.steamClouds++;
    addRing(x, y, r, '#d8f6ff', 0.34, 3);
    meltIceAt(x, y, r * 0.8);
    for (const fz of game.fireZones) {
      if (Math.hypot(fz.x - x, fz.y - y) < fz.r + r) fz.life *= 0.45;
    }
    recordDisaster('蒸氣雲', 0, r);
  }

  export function meltIceAt(x, y, radius) {
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    let melted = 0;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        if (game.map[ty][tx] === TILE_ICE) {
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          if (Math.hypot(cx - x, cy - y) <= radius + 16) { game.map[ty][tx] = TILE_WATER; melted++; }
        }
      }
    }
    if (melted > 0) addText(x, y - 26, '冰面融化', '#d8f6ff');
    return melted;
  }

  export function addFireZone(x, y, r, life = 2.2, friendly = false) {
    const fm = friendly ? mLvl('fire') : 0; // fire mastery makes your fire bigger/hotter/longer
    const rr = r + (friendly ? game.stats.fireSpread * 4 + fm * 5 : 0);
    const lf = life * (1 + fm * 0.08);
    game.fireZones.push({ x, y, r: rr, life: lf, maxLife: lf, dps: friendly ? 10 + game.stats.fireSpread * 1.5 + fm * 2.5 : 14, tick: 0, friendly });
    igniteGrass(x, y, rr + 8 + game.stats.fireSpread * 5);
  }

  export function addPoisonCloud(x, y, r, life = 5.0, mire = false) {
    const pm = mLvl('poison'); // poison mastery → larger, longer, nastier clouds
    const rr = (r + pm * 5) * (mire ? 1.3 : 1), lf = life * (1 + pm * 0.08) * (mire ? 1.4 : 1);
    const pc = { x, y, r: rr, life: lf, maxLife: lf, dps: 9 + pm * 1.5, pulse: rnd(0, 6.28), mire };
    game.poisonClouds.push(pc);
    return pc; // 毒沼 (mire) clouds also slow enemies — see the poison-cloud update loop
  }

  export function addExplosion(x, y, r, damage = 42, source = '爆炸') {
    game.explosions.push({ x, y, r, life: 0.32, maxLife: 0.32 });
    addRing(x, y, r, '#ffeea1', 0.42, 5);
    game.screenShake = Math.max(game.screenShake, Math.min(19, r * 0.16));
    game.flash = Math.max(game.flash, 0.12);
    igniteGrass(x, y, r);
    breakThinWalls(x, y, r);
    addFireZone(x, y, r * 0.35, 1.35, true);

    let killsInBoom = 0;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < r + e.r) {
        const falloff = 1 - d / (r + e.r);
        damageEnemy(e, damage * (0.45 + falloff), x, y, source);
        e.vx += (e.x - x) / Math.max(1, d) * 230 * falloff;
        e.vy += (e.y - y) / Math.max(1, d) * 230 * falloff;
        if (e.hp <= 0) killsInBoom++;
      }
    }
    game.biggestBoom = Math.max(game.biggestBoom, killsInBoom);
    if (killsInBoom >= 2) {
      game.stats.maxCombo = Math.max(game.stats.maxCombo, killsInBoom);
      addText(x, y - r * 0.55, `${killsInBoom} COMBO!`, '#fff08a');
    }
    recordDisaster(source, killsInBoom, r);

    const dp = Math.hypot(game.player.x - x, game.player.y - y);
    if (dp < r + game.player.r) {
      damagePlayer(14 * (1 - dp / (r + game.player.r)) + 5, source);
    }

    for (let i = 0; i < 28; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(80, 340);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rnd(2, 5),
        life: rnd(0.35, 0.75),
        maxLife: 0.75,
        color: Math.random() < 0.55 ? '#ffcf5a' : '#ff654f'
      });
    }
  }

  export function igniteGrass(x, y, radius) {
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        if (game.map[ty][tx] === TILE_GRASS) {
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          if (Math.hypot(cx - x, cy - y) <= radius + 18) {
            game.map[ty][tx] = TILE_BURNT;
            game.stats.burnedGrass++;
            addFireZone(cx, cy, 18, rnd(2.0, 3.4), true);
            if (Math.random() < 0.16) addText(cx, cy, '燃燒', '#ffb356');
            if (Math.random() < 0.35) game.particles.push({ x: cx, y: cy, vx: rnd(-18,18), vy: rnd(-42,-12), r: rnd(2,4), life: rnd(0.35,0.7), maxLife: 0.7, color: '#ff9a4d' });
          }
        }
      }
    }
  }

  export function breakThinWalls(x, y, radius) {
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        if (game.map[ty][tx] === TILE_THIN) {
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          if (Math.hypot(cx - x, cy - y) <= radius + 20) {
            game.map[ty][tx] = TILE_FLOOR;
            game.stats.shatteredWalls++;
            if (Math.random() < 0.65) addText(cx, cy - 10, '破牆', '#d8c0a0');
            for (let i = 0; i < 10; i++) game.particles.push({
              x: cx, y: cy,
              vx: rnd(-120, 120), vy: rnd(-120, 120),
              r: rnd(2, 5), life: rnd(0.35, 0.8), maxLife: 0.8,
              color: '#9e8c76'
            });
          }
        }
      }
    }
  }

  export function damageEnemy(e, amount, sourceX = null, sourceY = null, sourceName = '攻擊') {
    if (e.hp <= 0) return;

    let finalAmount = amount * (game.stats.damageMul || 1) * ((game.waveMods && game.waveMods.damageMul) || 1);
    if (e.type === 'charger' && sourceX !== null && sourceY !== null) {
      const sourceAngle = Math.atan2(sourceY - e.y, sourceX - e.x);
      const diff = Math.abs(Math.atan2(Math.sin(sourceAngle - e.facing), Math.cos(sourceAngle - e.facing)));
      const isStunned = e.state === 'stunned' || e.stunTimer > 0;
      if (isStunned) {
        finalAmount *= 1.2;
        if (amount >= 6 && e.blockTextCd <= 0) {
          addText(e.x, e.y - e.r - 18, 'STUN HIT!', '#d7ff8c');
          e.blockTextCd = 0.28;
        }
      } else if (diff < Math.PI * 0.38) {
        finalAmount *= 0.2;
        game.stats.frontBlocks++;
        if (amount >= 6 && e.blockTextCd <= 0) {
          addText(e.x, e.y - e.r - 18, 'BLOCK', '#bfe7ff');
          e.blockTextCd = 0.28;
        }
      } else if (diff > Math.PI * 0.68) {
        finalAmount *= 1.5;
        game.stats.backHits++;
        if (amount >= 6 && e.blockTextCd <= 0) {
          addText(e.x, e.y - e.r - 18, 'BACK HIT!', '#fff08a');
          e.blockTextCd = 0.28;
        }
      }
    }

    if (e.type === 'boss') {
      game.stats.bossDamage += finalAmount;
      game.stats.bossLastHit = sourceName;
    }
    e.hp -= finalAmount;
    e.hurt = 0.18;
    if (finalAmount >= 20) addText(e.x, e.y - e.r - 10, Math.round(finalAmount), '#fff3e2');
    if (finalAmount >= 28) addRing(e.x, e.y, e.r + 10, '#fff3e2', 0.18, 2);
    if (sourceX !== null) {
      const d = Math.hypot(e.x - sourceX, e.y - sourceY) || 1;
      const knock = e.type === 'charger' ? 42 : 75;
      e.vx += (e.x - sourceX) / d * knock;
      e.vy += (e.y - sourceY) / d * knock;
    }
    if (e.hp <= 0) {
      if (e.type === 'boss') game.stats.bossKillSource = sourceName;
      killEnemy(e);
    }
  }

  export function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    game.kills++;
    game.score += e.value;
    addText(e.x, e.y - 16, '+' + e.value, '#ffe28a');
    addRing(e.x, e.y, e.r + 18, e.color, 0.32, 2.5);
    if (e.type === 'bug') {
      addPoisonCloud(e.x, e.y, rnd(34, 48), 5.2);
      addText(e.x, e.y - 32, '毒霧', '#c07aff');
    }
    if (e.type === 'boss') {
      game.bossDefeated = true;
      game.stats.bossPhase = Math.max(game.stats.bossPhase || 1, 2);
      game.score += 1000;
      game.message = '你擊敗了元素哥布林法師！';
      game.state = 'win';
      game.fusionBanner = { title: 'VICTORY!', equation: 'Boss 已擊敗', desc: `主法術 ${game.stats.spellName} 完成最後一擊。`, life: 2.6, maxLife: 2.6, color: '#afff9d' };
      addText(e.x, e.y - 62, 'BOSS 擊破！', '#afff9d');
      addExplosion(e.x, e.y, 112, 0, 'Boss 爆散');
      game.screenShake = Math.max(game.screenShake, 18);
    }
    if (e.type === 'charger') {
      game.stats.elitesKilled++;
      addText(e.x, e.y - 42, '菁英擊破！', '#ffd36d');
      game.screenShake = Math.max(game.screenShake, 7);
      for (let i = 0; i < 18; i++) {
        const a = rnd(0, Math.PI * 2);
        game.particles.push({
          x: e.x, y: e.y,
          vx: Math.cos(a) * rnd(60, 190),
          vy: Math.sin(a) * rnd(60, 190),
          r: rnd(2, 5), life: rnd(0.35, 0.75), maxLife: 0.75,
          color: Math.random() < 0.5 ? '#ffd36d' : '#bfe7ff'
        });
      }
    }
    if (game.stats.iceShatter > 0 && e.chilled) {
      addIceBurst(e.x, e.y, 46 + game.stats.iceShatter * 10, 14 + game.stats.iceShatter * 5);
      addText(e.x, e.y - 52, '冰爆！', '#bff4ff');
    }
    if (game.stats.siphon > 0) healPlayer(2 + game.stats.siphon * 2);
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, Math.PI * 2);
      game.particles.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * rnd(30, 130),
        vy: Math.sin(a) * rnd(30, 130),
        r: rnd(2, 4), life: rnd(0.35, 0.65), maxLife: 0.65,
        color: e.color
      });
    }
  }

  export function addText(x, y, text, color = '#fff') {
    game.floatingTexts.push({ x, y, text, color, life: 0.82, maxLife: 0.82, vy: -34 });
  }

  // Big directional palm-slam shock (brawler main attack) — rendered in syncZones.
  export function addSlam(x, y, angle, hex, power = 1) {
    game.slams.push({ x, y, angle, hex, power, life: 0.28, maxLife: 0.28 });
  }
  export function addRing(x, y, r, color = '#fff', life = 0.35, width = 3) {
    game.rings.push({ x, y, r, color, life, maxLife: life, width });
  }

  export function recordDisaster(source, kills, radius) {
    const score = kills * 100 + Math.round(radius) + (source.includes('毒') ? 55 : 0) + (source.includes('水池') ? 35 : 0);
    if (score > game.stats.biggestDisasterScore) {
      game.stats.biggestDisasterScore = score;
      const killText = kills > 0 ? `，炸死 ${kills} 隻敵人` : '，場面一片混亂';
      game.stats.biggestDisaster = `${source}${killText}`;
    }
  }


  export function makeDeathMessage(source) {
    if (/Boss|哥布林|雷擊|火圈|毒瓶/.test(source)) return '你倒在元素哥布林法師的元素連招中。死因：' + source;
    if (/爆|火焰地板|毒霧|水池導電/.test(source)) return '你被自己的魔法災難吞掉了。死因：' + source;
    if (/衝撞|撞擊/.test(source)) return '你被怪物逼入混亂地形後擊倒。死因：' + source;
    return '魔法失控，地牢吞沒了你。死因：' + source;
  }

  export function makeRunStory(win) {
    const spell = game.stats.spellName || '魔法飛彈';
    const arena = game.run && game.run.arena ? game.run.arena.name : '未知競技場';
    if (win) {
      const source = game.stats.bossKillSource || game.stats.bossLastHit || spell;
      return `你在${arena}用「${spell}」擊敗元素哥布林法師，最後一擊來自：${source}。`;
    }
    const death = game.stats.deathSource || '未知災難';
    if (game.bossStarted) return `你帶著「${spell}」打進 Boss 戰，但被 ${death} 終結。`;
    return `你在${arena}把「${spell}」改造到失控，但被 ${death} 終結。`;
  }

  export function toast(message) {
    game.message = message;
    game.messageTimer = 1.5;
  }

  export function update(dt) {
    game.time += dt;
    game.screenShake = Math.max(0, game.screenShake - dt * 28);
    game.flash = Math.max(0, game.flash - dt * 1.7);
    if (game.messageTimer > 0) game.messageTimer -= dt;
    if (game.bossAttackTimer > 0) game.bossAttackTimer -= dt;
    if (game.bossPhaseBanner) {
      game.bossPhaseBanner.life -= dt;
      if (game.bossPhaseBanner.life <= 0) game.bossPhaseBanner = null;
    }
    if (game.fusionBanner) {
      game.fusionBanner.life -= dt;
      if (game.fusionBanner.life <= 0) game.fusionBanner = null;
    }

    updateParticles(dt);
    updateRings(dt);
    updateFloatingTexts(dt);

    if (game.state !== 'playing') return;
    updatePlayer(dt);
    // capstone 流星降臨 (火+土): periodic telegraphed meteors while fighting
    if (game.stats.capstone === 'meteor' && game.state === 'playing') {
      game.meteorTimer = (game.meteorTimer || 0) - dt;
      if (game.meteorTimer <= 0) {
        game.meteorTimer = 2.6;
        const live = game.enemies.filter(e => !e.dead && e.type !== 'boss');
        const t = live.length ? live[Math.floor(Math.random() * live.length)] : { x: mouse.x, y: mouse.y };
        const r = 58 + game.stats.size * 6 + spellMastery() * 4;
        addBossWarning('meteor', clamp(t.x, 30, W - 30), clamp(t.y, 30, H - 30), r, 0.85, '#ff7a3a');
      }
    }
    // capstone 瘟疫核爆 (火+毒): periodically chain-detonate your own poison clouds
    if (game.stats.capstone === 'plague' && game.state === 'playing') {
      game.plagueTimer = (game.plagueTimer || 0) - dt;
      if (game.plagueTimer <= 0) {
        game.plagueTimer = 2.8;
        const p = game.player; let n = 0;
        for (const cloud of game.poisonClouds) {
          if (cloud.life > 0 && Math.hypot(cloud.x - p.x, cloud.y - p.y) > 50) { // skip clouds hugging the player (auto-proc fairness)
            cloud.life = -1; game.chainBooms++; n++;
            addExplosion(cloud.x, cloud.y, Math.max(70, cloud.r) + game.stats.poisonBoom * 18, 46 + game.stats.size * 8 + game.stats.poisonBoom * 12, '瘟疫核爆');
            if (game.stats.siphon > 0) healPlayer(4 + game.stats.siphon * 3);
          }
        }
        if (n) addText(p.x, p.y - 40, `瘟疫核爆 ×${n}!`, '#d998ff');
      }
    }
    // capstone 磁暴奇點 (土+雷): periodic singularity clumps foes, then chain-detonates on collapse
    if (game.stats.capstone === 'storm' && game.state === 'playing') {
      game.stormTimer = (game.stormTimer || 0) - dt;
      if (game.stormTimer <= 0) {
        const live = game.enemies.filter(e => !e.dead && e.type !== 'boss');
        if (live.length >= 2) {
          game.stormTimer = 3.6;
          // aim at the densest clump: the foe with the most neighbours within 130px
          let best = live[0], bestN = -1;
          for (const e of live) { let c = 0; for (const o of live) if (Math.hypot(o.x - e.x, o.y - e.y) < 130) c++; if (c > bestN) { bestN = c; best = e; } }
          const r = 130 + game.stats.size * 14 + spellMastery() * 6;
          game.blackHoles.push({ x: clamp(best.x, 40, W - 40), y: clamp(best.y, 40, H - 40), r, life: 1.5, maxLife: 1.5, exploded: false, storm: true });
          addRing(best.x, best.y, 36, '#b07aff', 0.4, 4); game.screenShake = Math.max(game.screenShake, 3);
        } else { game.stormTimer = 1.2; } // no clump yet — re-check soon (don't waste the proc)
      }
    }
    // capstone 凍毒領域 (冰+毒): a frost-venom aura that follows you — chills + poisons foes in range.
    // Player-centred, so no telegraph needed; the risk/reward is you must keep foes close.
    if (game.stats.capstone === 'frostpoison' && game.state === 'playing') {
      const p = game.player;
      const r = 116 + game.stats.size * 10 + spellMastery() * 6;
      game.frostAuraR = r; // render reads this to draw the disc (kept in sync here)
      const dps = 9 + mLvl('poison') * 1.5; // mirrors a poison cloud's bite
      for (const e of game.enemies) {
        if (e.dead || e.type === 'bug') continue; // bugs shrug off poison (as in the cloud logic)
        if (Math.hypot(e.x - p.x, e.y - p.y) < r + e.r) {
          damageEnemy(e, dps * 0.45 * dt, p.x, p.y, '凍毒領域');
          e.slowTimer = Math.max(e.slowTimer || 0, 0.5); e.chilled = true;
        }
      }
      game.auraTimer = (game.auraTimer || 0) - dt; // periodic pulse + frost/venom motes (reuse ring + particles)
      if (game.auraTimer <= 0) {
        game.auraTimer = 0.6;
        addRing(p.x, p.y, r, '#9fe0d0', 0.22, 3);
        for (let i = 0; i < 4; i++) { const a = rnd(0, 6.28), d = rnd(r * 0.4, r); game.particles.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: rnd(-12, 12), vy: rnd(-24, -6), r: rnd(2, 4), life: 0.6, maxLife: 0.6, color: i % 2 ? '#bff4ff' : '#a7ff45' }); }
      }
    }
    // capstone 電漿風暴 (火+雷): a self-roaming plasma orb that hunts foes, bursting + conducting where it passes.
    // A mobile autonomous hazard — it homes onto the nearest enemy, bounces off walls, and only ever hurts enemies.
    if (game.stats.capstone === 'plasma' && game.state === 'playing') {
      if (!game.plasmaOrb) { const p = game.player; game.plasmaOrb = { x: clamp(p.x, 40, W - 40), y: clamp(p.y, 40, H - 40), vx: rnd(-1, 1) || 1, vy: rnd(-1, 1) || 1, zap: 0 }; }
      const orb = game.plasmaOrb;
      const speed = 150 + spellMastery() * 12;
      const tgt = nearestEnemy(orb.x, orb.y, 9999); // homing servant: drift toward the nearest foe
      if (tgt) { const a = Math.atan2(tgt.y - orb.y, tgt.x - orb.x); orb.vx += Math.cos(a) * 2.4; orb.vy += Math.sin(a) * 2.4; }
      const sp = Math.hypot(orb.vx, orb.vy) || 1; orb.vx = orb.vx / sp * speed; orb.vy = orb.vy / sp * speed;
      let nx = orb.x + orb.vx * dt, ny = orb.y + orb.vy * dt;
      if (circleHitsSolid(nx, orb.y, 10) || nx <= 16 || nx >= W - 16) { orb.vx *= -1; nx = orb.x; }
      if (circleHitsSolid(orb.x, ny, 10) || ny <= 16 || ny >= H - 16) { orb.vy *= -1; ny = orb.y; }
      orb.x = clamp(nx, 16, W - 16); orb.y = clamp(ny, 16, H - 16);
      game.particles.push({ x: orb.x, y: orb.y, vx: rnd(-24, 24), vy: rnd(-24, 24), r: rnd(2, 4), life: 0.3, maxLife: 0.3, color: Math.random() < 0.5 ? '#bdf5ff' : '#ffb46a' });
      orb.zap -= dt;
      if (orb.zap <= 0) { // periodic 爆裂 (radial damage) + 導電 (chain) where it sits
        orb.zap = 0.7;
        const br = 36 + game.stats.size * 5;
        for (const e of game.enemies) { if (!e.dead && Math.hypot(e.x - orb.x, e.y - orb.y) < br + e.r) { damageEnemy(e, 16 + game.stats.size * 4, orb.x, orb.y, '電漿風暴'); e.stunTimer = Math.max(e.stunTimer || 0, 0.25); } }
        chainLightningFrom(orb.x, orb.y, null, 16 + game.stats.storm * 3);
        if (tileAtPixel(orb.x, orb.y) === TILE_WATER) addElectricZone(orb.x, orb.y, 52, 0.6);
        addRing(orb.x, orb.y, br, '#9fe7ff', 0.22, 3);
        game.screenShake = Math.max(game.screenShake, 2);
      }
    }
    // capstone 冰川崩落 (土+冰): raise a cage of ice walls around a foe cluster, then shatter it into a wide ice burst.
    // Reuses TILE_ICEWALL (solid → caging) + addIceBurst; self-contained — tiles set directly, cleared on shatter.
    if (game.stats.capstone === 'glacier' && game.state === 'playing') {
      const p = game.player;
      if (!game.glaciers) game.glaciers = [];
      for (const gl of game.glaciers) { // tick fuses → shatter
        gl.fuse -= dt;
        if (gl.fuse <= 0 && !gl.done) {
          gl.done = true;
          for (const [tx, ty] of gl.tiles) if (game.map[ty][tx] === TILE_ICEWALL) game.map[ty][tx] = TILE_FLOOR;
          addIceBurst(gl.x, gl.y, gl.r, 22 + game.stats.size * 5 + mLvl('ice') * 3);
          addText(gl.x, gl.y - 34, '冰川崩落！', '#bff4ff');
        }
      }
      game.glaciers = game.glaciers.filter(gl => !gl.done);
      game.glacierTimer = (game.glacierTimer || 0) - dt;
      if (game.glacierTimer <= 0) {
        const live = game.enemies.filter(e => !e.dead && e.type !== 'boss');
        let best = live[0], bestN = -1; // densest cluster, like the singularity
        for (const e of live) { let c = 0; for (const o of live) if (Math.hypot(o.x - e.x, o.y - e.y) < 110) c++; if (c > bestN) { bestN = c; best = e; } }
        if (!live.length || Math.hypot(best.x - p.x, best.y - p.y) < 3.4 * TILE) {
          game.glacierTimer = 1.2; // no foes, or the cage would enclose you — re-check soon
        } else {
          game.glacierTimer = 4.2;
          const ctx0 = Math.floor(best.x / TILE), cty0 = Math.floor(best.y / TILE), tiles = [];
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue; // ring only (cage), interior left open
            const tx = ctx0 + dx, ty = cty0 + dy;
            if (tx < 1 || ty < 1 || tx >= COLS - 1 || ty >= ROWS - 1) continue;
            if (isSolidTile(game.map[ty][tx])) continue; // never overwrite walls/borders
            const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
            if (Math.hypot(cx - p.x, cy - p.y) < p.r + 14) continue; // never cage the player's own tile
            game.map[ty][tx] = TILE_ICEWALL; tiles.push([tx, ty]);
          }
          if (tiles.length) {
            game.glaciers.push({ x: best.x, y: best.y, r: 2.7 * TILE + game.stats.size * 5, fuse: 0.9, done: false, tiles });
            addRing(best.x, best.y, 2.7 * TILE, '#bff4ff', 0.3, 3); game.screenShake = Math.max(game.screenShake, 2);
          } else { game.glacierTimer = 1.2; } // all ring tiles blocked — re-check soon
        }
      }
    }
    // capstone 沸騰領域 (火+冰): an arena-wide steam storm — every foe is continuously slowed + scalded.
    // Global weather (not localised); only enemies are affected — you walk through your own storm unharmed.
    if (game.stats.capstone === 'boil' && game.state === 'playing') {
      const burnDps = 5 + game.stats.size * 1.5 + spellMastery() * 1.5;
      for (const e of game.enemies) {
        if (e.dead) continue;
        e.slowTimer = Math.max(e.slowTimer || 0, 0.4);           // 全場減速
        damageEnemy(e, burnDps * dt, e.x, e.y, '沸騰領域');       // 灼燒 (gentle per-frame DoT, like a cloud)
      }
      game.boilTimer = (game.boilTimer || 0) - dt;
      if (game.boilTimer <= 0) { // scatter steam across the arena for the storm look (also reinforces the slow)
        game.boilTimer = 0.6;
        for (let i = 0; i < 2; i++) addSteamCloud(rnd(60, W - 60), rnd(60, H - 60), 40 + game.stats.size * 4, 1.6);
      }
    }

    updateProjectiles(dt);
    updateEnemies(dt);
    updateBossWarnings(dt);
    updateZones(dt);
    updateWalls(dt);
    updateOil(dt);
    updateBlackHoles(dt);
    updateProps(dt);

    game.enemies = game.enemies.filter(e => !e.dead);

    if (game.enemies.length === 0 && game.wave > 0) {
      game.waveClearTimer += dt;
      if (game.waveClearTimer > 0.9) {
        if (game.bossStarted && game.bossDefeated) {
          game.state = 'win';
          game.message = '你擊敗了元素哥布林法師！';
        } else if (game.wave >= 5 && !game.bossStarted) {
          openUpgrade();
        } else if (!game.bossStarted) {
          openUpgrade();
        }
      }
    }
  }

  export function updatePlayer(dt) {
    const p = game.player;
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.lightningCooldown = Math.max(0, p.lightningCooldown - dt);
    p.iceCooldown = Math.max(0, p.iceCooldown - dt);
    // Dash charges (C): hold up to stats.dashCharges; each spent charge recharges serially.
    p.dashTapCd = Math.max(0, p.dashTapCd - dt);
    const dashMax = game.stats.dashCharges;
    if (p.dashStock < dashMax) {
      p.dashRecharge -= dt;
      if (p.dashRecharge <= 0) {
        p.dashStock = Math.min(dashMax, p.dashStock + 1);
        p.dashRecharge = p.dashStock < dashMax ? 1.1 * game.stats.dashCdMul : 0;
      }
    }
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.dashTrailCd = Math.max(0, p.dashTrailCd - dt);
    p.fistAnim = Math.max(0, p.fistAnim - dt);
    p.fistComboTimer = Math.max(0, p.fistComboTimer - dt);
    if (p.fistComboTimer <= 0) p.fistCombo = 0;
    p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    p.facing = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    if (p.dashTime <= 0) {
      // Lunge payoff (A): a 突進 ends with a gap-closing melee strike toward the cursor.
      if (p.lungeStrike) { p.lungeStrike = false; meleeAttack(p.facing); }
      // Element shaping (B): fire/lightning dashes detonate where they land.
      if (p.dashArrive) { p.dashArrive = false; dashArrival(p); }
    }

    let mx = 0, my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    // Camera-relative movement so WASD matches the screen at any azimuth.
    const _maz = (CAM.azimuth || 0) * Math.PI / 180;
    const _fX = -Math.sin(_maz), _fY = -Math.cos(_maz); // screen-up in world
    const _rX = Math.cos(_maz), _rY = -Math.sin(_maz);  // screen-right in world
    const n = norm(_rX * mx + _fX * (-my), _rY * mx + _fY * (-my));
    let speed = p.speed;

    if ((keys.has(' ') || keys.has('shift')) && p.dashStock >= 1 && p.dashTapCd <= 0 && p.dashTime <= 0) {
      p.dashStock -= 1;
      p.dashTapCd = 0.22;                                                   // brief rhythm gate between chained dashes
      if (p.dashRecharge <= 0) p.dashRecharge = 1.1 * game.stats.dashCdMul; // begin recharge if idle
      p.dashHits = new Set();   // enemies hit by this dash (offensive dash)
      p.dashTrailCd = 0;        // lay first trail node immediately
      p.lungeStrike = false;
      // Direction defaults to movement input (steer your dodge); aim is the fallback when standing still.
      let dirX = n.x, dirY = n.y;
      const refA = (Math.abs(n.x) + Math.abs(n.y) > 0) ? Math.atan2(n.y, n.x) : p.facing;
      // Build coupling (A): in a brawler stance the dash becomes a 突進 — snaps onto the nearest
      // enemy in a forward cone, closes the gap, and ends in a melee strike. This is melee's
      // "long arm"; ranged/spell builds keep the short i-frame hop. Long range stays build-gated.
      let lunge = false, gap = 0;
      if (game.stats.mainMode !== 'spell') {
        let best = null, bestD = 260;            // seek range
        for (const e of game.enemies) {
          if (e.dead) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d > bestD) continue;
          const a = Math.atan2(e.y - p.y, e.x - p.x);
          if (Math.abs(Math.atan2(Math.sin(a - refA), Math.cos(a - refA))) > 0.9) continue; // ~±51° cone
          best = e; bestD = d;
        }
        if (best) { const nn = norm(best.x - p.x, best.y - p.y); dirX = nn.x; dirY = nn.y; lunge = true; gap = bestD; }
      }
      if (lunge) {
        p.dashSpeed = 780;
        p.dashTime = clamp(Math.max(0, gap - 44) / p.dashSpeed, 0.1, 0.3); // reach the target, stop a hair short
        p.lungeStrike = true;
      } else {
        p.dashSpeed = 520;
        p.dashTime = 0.13;
      }
      // Direction B: the dash element reshapes the move itself, not just the trail it lays.
      // Long-range stays build-gated — only lightning (a build commitment) lengthens the dash.
      const dEl = dashElement();
      p.dashEl = dEl; p.dashCharge = false; p.dashArrive = false;
      if (dEl === 'lightning') { p.dashSpeed *= 1.4; p.dashTime *= 0.88; p.dashArrive = true; } // 瞬閃: snappy + longer reach, arrival zap
      else if (dEl === 'earth') { p.dashCharge = true; }                                        // 衝撞: heavy ram (handled in dashTrail)
      else if (dEl === 'fire') { p.dashArrive = true; }                                         // 火尾 + 結尾小爆
      p.dashDirX = dirX; p.dashDirY = dirY;
      p.invuln = Math.max(p.invuln, p.dashTime + 0.05); // i-frames cover the whole move
      game.screenShake = Math.max(game.screenShake, lunge ? 3 : 2);
      if (Math.abs(dirX) + Math.abs(dirY) > 0) { p.vx = dirX * p.dashSpeed; p.vy = dirY * p.dashSpeed; }
      const dc = ELEMENT_INFO[dashElement()] && ELEMENT_INFO[dashElement()].color || '#b7d8ff';
      for (let i = 0; i < 12; i++) {
        game.particles.push({ x: p.x, y: p.y, vx: rnd(-90, 90), vy: rnd(-90, 90), r: rnd(2, 4), life: 0.3, maxLife: 0.3, color: dc });
      }
    }
    const dashing = p.dashTime > 0;
    if (dashing) speed = p.dashSpeed || 520;

    // During a dash the direction is locked to the dash vector (a committed move); normal
    // movement steers with WASD as usual.
    const mvx = dashing ? p.dashDirX : n.x;
    const mvy = dashing ? p.dashDirY : n.y;
    const onIce = tileAtPixel(p.x, p.y) === TILE_ICE;
    if (onIce) {
      p.vx += mvx * speed * 4.4 * dt;
      p.vy += mvy * speed * 4.4 * dt;
      const maxSp = dashing ? Math.max(620, p.dashSpeed || 0) : 340;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > maxSp) { p.vx = p.vx / sp * maxSp; p.vy = p.vy / sp * maxSp; }
      p.vx *= Math.pow(0.16, dt);
      p.vy *= Math.pow(0.16, dt);
      if (Math.random() < 0.08) game.particles.push({ x: p.x, y: p.y + 10, vx: rnd(-45, 45), vy: rnd(-20, 25), r: rnd(1.5, 3), life: rnd(0.15, 0.32), maxLife: 0.32, color: '#d8fbff' });
    } else {
      p.vx = mvx * speed;
      p.vy = mvy * speed;
    }
    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;
    if (!circleHitsSolid(nx, p.y, p.r)) p.x = nx; else p.vx *= -0.15;
    if (!circleHitsSolid(p.x, ny, p.r)) p.y = ny; else p.vy *= -0.15;
    blockByProps(p);                                // crates are solid (hard walls)

    if (p.dashTime > 0) dashTrail(p);

    const wp = game.stats.mainMode === 'windpalm';
    // Main attack (LMB) — suppressed while 風掌 is carrying a crate (both hands full).
    if (mouse.down && p.cooldown <= 0 && !(wp && p.held.length)) {
      if (game.stats.mainMode !== 'spell') {
        meleeAttack(p.facing);
        // flurry: rapid presses ramp the combo and shorten the cadence (相撲突っ張り)
        p.cooldown = Math.max(0.13, (0.24 - Math.min(p.fistCombo, 5) * 0.02) * game.stats.cooldownMul);
      } else {
        shoot(p.facing);
        p.cooldown = Math.max(0.08, 0.28 * game.stats.cooldownMul);
      }
    }
    // Secondary slot (RMB or Q) — build-defined spell, unchanged in every stance.
    if ((mouse.right || keys.has('q')) && p.secondaryCooldown <= 0) {
      castSecondary(p.facing);
    }
    // 風掌 E（edge-triggered）：撿取（累積到星級上限）→ 滿了/沒得撿就齊射丟出。
    const eDown = keys.has('e'); const eEdge = eDown && !p.eDown; p.eDown = eDown;
    if (wp && eEdge) {
      const cap = game.stats.windpalmStar || 1;
      let grabbed = false;
      if (p.held.length < cap) grabbed = tryGrab(p);
      if (!grabbed && p.held.length > 0) throwHeld(p.facing);
    }
    // Carry held items (crates / foes) floating in a fan in front of the mage.
    if (p.held.length) {
      p.held = p.held.filter(it => !it.dead); // drop anything that died in your grip
      const n = p.held.length;
      p.held.forEach((it, i) => {
        const spread = n === 1 ? 0 : (i - (n - 1) / 2) * 0.34;
        const off = p.r + it.r + 12;
        it.x = clamp(p.x + Math.cos(p.facing + spread) * off, it.r, W - it.r);
        it.y = clamp(p.y + Math.sin(p.facing + spread) * off, it.r, H - it.r);
        it.vx = 0; it.vy = 0; it.thrown = 0;
        if (it.type) it.stunTimer = Math.max(it.stunTimer || 0, 0.3); // a held foe stays dazed
      });
    }
  }

  // --- Element-infused dash (movement-as-terrain build) -------------------
  export function dashElement() {
    const els = game.stats.spellElements || [];
    return els.length ? els[els.length - 1] : null; // most recent element
  }
  // element -> what the dash lays on the ground it crosses
  export const DASH_FX = {
    fire: (x, y) => { igniteGrass(x, y, 22); addFireZone(x, y, 16 + game.stats.dashPower * 6, 0.7, true); },
    ice: (x, y) => { freezeWaterAt(x, y, 26); },
    lightning: (x, y) => { if (tileAtPixel(x, y) === TILE_WATER) addElectricZone(x, y, 44 + game.stats.dashPower * 10, 0.7); },
    poison: (x, y) => { addPoisonCloud(x, y, 18 + game.stats.dashPower * 5, 2.2); }
  };
  export function dashTrail(p) {
    const el = dashElement();
    const col = (ELEMENT_INFO[el] && ELEMENT_INFO[el].color) || '#b7d8ff';
    // lay an element trail node on a short throttle
    if (p.dashTrailCd <= 0) {
      if (el && DASH_FX[el]) DASH_FX[el](p.x, p.y);
      if (p.dashCharge) breakThinWalls(p.x, p.y, p.r + 6); // 土衝撞: ram smashes thin walls it crosses
      for (let i = 0; i < 3; i++) game.particles.push({ x: p.x, y: p.y, vx: rnd(-50, 50), vy: rnd(-50, 50), r: rnd(2, 4), life: rnd(0.2, 0.4), maxLife: 0.4, color: col });
      p.dashTrailCd = 0.04;
    }
    // offensive dash: bump enemies passed through (once each)
    if (!p.dashHits) p.dashHits = new Set();
    const charge = p.dashCharge;                                                      // 土衝撞 hits harder + knocks back hard
    const dmg = (8 + game.stats.dashPower * 6 + game.stats.size * 2) * (charge ? 1.6 : 1);
    const kb = charge ? 520 : 240;
    for (const e of game.enemies) {
      if (e.dead || p.dashHits.has(e)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < p.r + e.r + 4) {
        p.dashHits.add(e);
        damageEnemy(e, dmg, p.x, p.y, '衝刺');
        const a = angleTo(p, e);
        e.vx = (e.vx || 0) + Math.cos(a) * kb;
        e.vy = (e.vy || 0) + Math.sin(a) * kb;
        if (el === 'ice') { e.slowTimer = Math.max(e.slowTimer || 0, 1.1); e.chilled = true; }
        if (el === 'poison') addPoisonCloud(e.x, e.y, 18, 2.0);
        if (charge) game.screenShake = Math.max(game.screenShake, 3);
      }
    }
    for (const pr of game.props) { if (Math.hypot(pr.x - p.x, pr.y - p.y) < p.r + pr.r + 4) pushProp(pr, p.x - p.vx * 0.05, p.y - p.vy * 0.05, 360); } // dash shoves crates
  }
  // Direction B arrival burst: fire detonates a small blaze, lightning zaps where the dash lands.
  export function dashArrival(p) {
    const el = p.dashEl;
    if (el === 'fire') {
      igniteGrass(p.x, p.y, 30);
      addFireZone(p.x, p.y, 30 + game.stats.dashPower * 8, 1.0, true);
      addRing(p.x, p.y, 28, '#ff9a3c', 0.3, 4);
    } else if (el === 'lightning') {
      const r = 56 + game.stats.dashPower * 8, dmg = 10 + game.stats.dashPower * 4 + game.stats.size * 2;
      for (const e of game.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < r) { damageEnemy(e, dmg, p.x, p.y, '瞬閃'); e.slowTimer = Math.max(e.slowTimer || 0, 0.6); }
      }
      if (tileAtPixel(p.x, p.y) === TILE_WATER) addElectricZone(p.x, p.y, r, 0.6);
      addRing(p.x, p.y, r * 0.6, '#bfe6ff', 0.25, 4);
      for (let i = 0; i < 10; i++) { const a = rnd(0, 6.28), sp = rnd(140, 280); game.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2, 4), life: 0.3, maxLife: 0.3, color: '#bfe6ff' }); }
    }
    game.screenShake = Math.max(game.screenShake, 3);
  }

  // --- Secondary slot: build-defined spell on one button ------------------
  // Add new secondary spells here as a single registry entry (see docs §7).
  // Secondary registry: each entry is { name, cd, cast(angle) } (see docs §7).
  export const SECONDARY = {
    icewall:   { name: '冰牆', cd: 3.0, cast: (a) => buildWall(a, 'ice',   TILE_ICEWALL, 6, 4) },
    earthwall: { name: '土牆', cd: 3.4, cast: (a) => buildWall(a, 'earth', TILE_THIN,    8, 4) },
    oil:       { name: '潑油', cd: 2.6, cast: (a) => layOil(a) },
    blackhole: { name: '黑洞', cd: 6.0, cast: (a) => castBlackHole(a) }
  };
  // Secondary mastery (mirrors element mastery): re-picking the equipped secondary
  // deepens it; a different pick swaps the slot, keeping each one's remembered level.
  export function sLvl(id) { return (game.stats.secondaryLvl && game.stats.secondaryLvl[id || game.stats.secondary]) || 0; }
  export function equipOrLevelSecondary(id) {
    const s = game.stats;
    if (s.secondary === id) {
      s.secondaryLvl[id] = (s.secondaryLvl[id] || 0) + 1;
      const lv = s.secondaryLvl[id];
      addText(game.player.x, game.player.y - 42, `${SECONDARY[id].name}強化 Lv${lv}`, '#8cecff');
      toast(`${SECONDARY[id].name}強化 Lv${lv}！`);
    } else {
      s.secondary = id;
      toast(`副攻換成${SECONDARY[id].name}！`);
    }
  }
  export function castSecondary(angle) {
    const def = SECONDARY[game.stats.secondary];
    if (!def) return; // no secondary equipped yet (gained via upgrades)
    game.player.secondaryCooldown = def.cd * Math.max(0.5, 1 - 0.08 * sLvl()); // mastery shortens cd
    def.cast(angle);
  }
  // Element coupling: a secondary inherits the player's current spell element(s) and
  // drops the matching ground effect, plugging into the same reaction system the
  // main spell uses. allowFire=false keeps oil's manual "ignite with a fireball" combo.
  export function applyElementalBurst(x, y, r, allowFire = true) {
    const els = game.stats.spellElements || [];
    if (allowFire && els.includes('fire')) { igniteGrass(x, y, r); addFireZone(x, y, r * 0.7, 1.4, true); }
    if (els.includes('poison')) addPoisonCloud(x, y, r * 0.8, 3.2);
    if (els.includes('lightning')) addElectricZone(x, y, r * 0.8, 0.7);
    if (els.includes('ice')) { freezeWaterAt(x, y, r); for (const e of game.enemies) { if (!e.dead && Math.hypot(e.x - x, e.y - y) < r) { e.slowTimer = Math.max(e.slowTimer || 0, 1.1); e.chilled = true; } } }
    if (els.includes('earth')) { for (let i = 0; i < 4; i++) { const a = rnd(0, 6.28), sp = rnd(120, 240); game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2, 4), life: 0.5, maxLife: 0.5, color: '#caa472' }); } }
  }

  // A barrier across your aim: a short perpendicular line of solid tiles ahead of you.
  export function buildWall(angle, kind, tile, life, len) {
    const lv = sLvl(); len += lv; life += lv * 2; // mastery: longer + more durable wall
    const p = game.player;
    const cx = p.x + Math.cos(angle) * 46, cy = p.y + Math.sin(angle) * 46;
    const px = Math.cos(angle + Math.PI / 2), py = Math.sin(angle + Math.PI / 2);
    const half = (len - 1) / 2;
    let placed = 0;
    for (let k = -half; k <= half; k++) {
      const tx = Math.floor((cx + px * k * TILE) / TILE), ty = Math.floor((cy + py * k * TILE) / TILE);
      if (tx < 1 || ty < 1 || tx >= COLS - 1 || ty >= ROWS - 1) continue;
      if (isSolidTile(game.map[ty][tx])) continue;
      if (Math.hypot(tx * TILE + TILE / 2 - p.x, ty * TILE + TILE / 2 - p.y) < p.r + 8) continue;
      game.walls.push({ tx, ty, kind, prev: game.map[ty][tx], life, maxLife: life });
      game.map[ty][tx] = tile;
      placed++;
    }
    if (placed) {
      addText(cx, cy - 20, kind === 'ice' ? '冰牆' : '土牆', kind === 'ice' ? '#bff4ff' : '#d1a06a');
      addRing(p.x, p.y, 24, kind === 'ice' ? '#bff4ff' : '#caa472', 0.3, 3);
      game.screenShake = Math.max(game.screenShake, 2);
      applyElementalBurst(cx, cy, Math.max(TILE, len * TILE * 0.42)); // element-coupled barrier
    }
  }

  // Spill a small oil patch ahead — does nothing until fire touches it, then big boom.
  export function layOil(angle) {
    const p = game.player;
    const lv = sLvl(), rad = 1 + Math.min(lv, 2), oilLife = 7 + lv * 1.5; // mastery: wider, longer-lasting slick
    const cx = p.x + Math.cos(angle) * 40, cy = p.y + Math.sin(angle) * 40;
    const ctx0 = Math.floor(cx / TILE), cty0 = Math.floor(cy / TILE);
    let placed = 0;
    for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
      const tx = ctx0 + ox, ty = cty0 + oy;
      if (tx < 1 || ty < 1 || tx >= COLS - 1 || ty >= ROWS - 1) continue;
      const t = game.map[ty][tx];
      if (t !== TILE_FLOOR && t !== TILE_GRASS && t !== TILE_BURNT && t !== TILE_ICE) continue;
      game.oils.push({ tx, ty, prev: t, life: oilLife, maxLife: oilLife });
      game.map[ty][tx] = TILE_OIL;
      placed++;
    }
    if (placed) { addText(cx, cy - 20, '潑油', '#cdb06a'); addRing(p.x, p.y, 22, '#caa45a', 0.3, 3); applyElementalBurst(cx, cy, TILE * (rad + 0.5), false); } // couple, but keep manual fire-ignite combo
  }

  // 風掌 (brawler MAIN): a melee palm that shoves a forward cone — strong knockback,
  // pushes fire/poison/steam the way you aim, light contact damage. No projectile.
  export function windPalm(angle) {
    const p = game.player, reach = 54, hitR = 44, range = 190, halfAng = 0.68;
    const fx = p.x + Math.cos(angle) * reach, fy = p.y + Math.sin(angle) * reach;
    const dmg = 12 + game.stats.size * 2 + game.stats.dashPower * 2;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > range) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) > halfAng) continue;
      const f = 600 * (1 - d / range);
      e.vx = (e.vx || 0) + Math.cos(angle) * f; e.vy = (e.vy || 0) + Math.sin(angle) * f;
      if (Math.hypot(e.x - fx, e.y - fy) < hitR + e.r) damageEnemy(e, dmg, p.x, p.y, '風掌');
    }
    const shove = (arr) => { for (const c of arr) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d > range) continue; const a = Math.atan2(c.y - p.y, c.x - p.x); if (Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) > halfAng + 0.35) continue; c.x = clamp(c.x + Math.cos(angle) * 64, 0, W); c.y = clamp(c.y + Math.sin(angle) * 64, 0, H); } };
    shove(game.poisonClouds); shove(game.fireZones); shove(game.steamClouds);
    for (const pr of game.props) {                    // 風推: shove crates along the aim (→ ram enemies)
      const d = Math.hypot(pr.x - p.x, pr.y - p.y);
      if (d > range) continue;
      const a = Math.atan2(pr.y - p.y, pr.x - p.x);
      if (Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) > halfAng + 0.2) continue;
      const f = 540 * (1 - d / range) + 180;
      pr.vx = (pr.vx || 0) + Math.cos(angle) * f; pr.vy = (pr.vy || 0) + Math.sin(angle) * f;
    }
    for (let i = 0; i < 16; i++) { const a = angle + rnd(-halfAng, halfAng), sp = rnd(140, 280); game.particles.push({ x: p.x + Math.cos(angle) * 16, y: p.y + Math.sin(angle) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2, 4), life: rnd(0.2, 0.4), maxLife: 0.4, color: '#dff3ff' }); }
    addRing(fx, fy, hitR, '#dff3ff', 0.24, 3); game.screenShake = Math.max(game.screenShake, 3);
  }

  // Brawler dispatch: one palm-strike feel across all melee stances. palmSwing()
  // drives the shared visible alternating thrust + flurry combo; each stance adds its FX.
  export function palmSwing() {
    const p = game.player;
    p.fistHand = p.fistHand ? 0 : 1;
    p.fistAnim = p.fistAnimMax;
    p.fistCombo = p.fistComboTimer > 0 ? Math.min(p.fistCombo + 1, 6) : 1;
    p.fistComboTimer = 0.55;
  }
  export function meleeAttack(angle) {
    palmSwing();
    const p = game.player, m = game.stats.mainMode;
    const hex = m === 'lightpalm' ? 0x9fe7ff
      : m === 'windpalm' ? 0xeafaff
      : colorHex((ELEMENT_INFO[dashElement()] && ELEMENT_INFO[dashElement()].color) || '#ffd7a0');
    addSlam(p.x, p.y, angle, hex, 1 + Math.min(p.fistCombo, 5) * 0.12); // grows with the flurry
    if (m === 'lightpalm') lightningPalm(angle);
    else if (m === 'windpalm') windPalm(angle);
    else earthFist(angle);
  }

  // 土拳 (brawler MAIN): close-range punch that carries the current element, knocks
  // back, and smashes thin/earth walls. Replaces the projectile.
  export function earthFist(angle) {
    const p = game.player, reach = 46, r = 36;
    const fx = p.x + Math.cos(angle) * reach, fy = p.y + Math.sin(angle) * reach;
    const el = dashElement();
    const dmg = 16 + game.stats.size * 3 + game.stats.dashPower * 2;
    for (const e of game.enemies) {
      if (Math.hypot(e.x - fx, e.y - fy) < r + e.r) {
        damageEnemy(e, dmg, p.x, p.y, '肉搏');
        const a = angleTo(p, e);
        e.vx = (e.vx || 0) + Math.cos(a) * 320; e.vy = (e.vy || 0) + Math.sin(a) * 320;
        if (el === 'ice') { e.slowTimer = Math.max(e.slowTimer || 0, 1.0); e.chilled = true; }
        else if (el === 'poison') addPoisonCloud(e.x, e.y, 16, 1.8);
      }
    }
    breakThinWalls(fx, fy, r);
    for (const pr of game.props) { if (Math.hypot(pr.x - fx, pr.y - fy) < r + pr.r + 8) shatterProp(pr, 'break'); } // 土碎: smash crates → 碎片
    if (el === 'fire') { addFireZone(fx, fy, 18, 0.7, true); igniteGrass(fx, fy, 20); }
    else if (el === 'lightning' && tileAtPixel(fx, fy) === TILE_WATER) addElectricZone(fx, fy, 40, 0.6);
    const col = (ELEMENT_INFO[el] && ELEMENT_INFO[el].color) || '#d8b888';
    addRing(fx, fy, r, col, 0.24, 3); game.screenShake = Math.max(game.screenShake, 3);
    for (let i = 0; i < 6; i++) game.particles.push({ x: fx, y: fy, vx: rnd(-130, 130), vy: rnd(-130, 130), r: rnd(2, 4), life: rnd(0.2, 0.4), maxLife: 0.4, color: col });
  }

  // Spawn a black hole that pulls enemies + hazards together, then collapses (explodes).
  export function castBlackHole(angle) {
    const p = game.player;
    const x = clamp(p.x + Math.cos(angle) * 160, 36, W - 36);
    const y = clamp(p.y + Math.sin(angle) * 160, 36, H - 36);
    const lv = sLvl(); // mastery: bigger reach + longer pull before collapse
    game.blackHoles.push({ x, y, r: 120 + game.stats.size * 14 + lv * 22, life: 1.6 + lv * 0.3, maxLife: 1.6 + lv * 0.3, exploded: false });
    addRing(x, y, 30, '#b07aff', 0.4, 4); game.screenShake = Math.max(game.screenShake, 3);
  }

  // Close-range electric palm: knockback + short chain; electrifies water you
  // stand in or aim at (which can shock you too — on-brand self-harm).
  export function lightningPalm(angle) {
    const p = game.player, reach = 50, r = 40;
    const fx = p.x + Math.cos(angle) * reach, fy = p.y + Math.sin(angle) * reach;
    const dmg = 18 + game.stats.size * 2 + mLvl('lightning') * 3;
    for (const e of game.enemies) {
      if (Math.hypot(e.x - fx, e.y - fy) < r + e.r) {
        damageEnemy(e, dmg, p.x, p.y, '雷掌');
        const a = angleTo(p, e);
        e.vx = (e.vx || 0) + Math.cos(a) * 360; e.vy = (e.vy || 0) + Math.sin(a) * 360;
        e.stunTimer = Math.max(e.stunTimer || 0, 0.5);
        game.lightningBolts.push({ x1: p.x, y1: p.y, x2: e.x, y2: e.y, life: 0.14, maxLife: 0.14 });
        chainLightningFrom(e.x, e.y, e, 14 + mLvl('lightning') * 2);
      }
    }
    if (tileAtPixel(fx, fy) === TILE_WATER) addElectricZone(fx, fy, 72, 0.9);
    else if (tileAtPixel(p.x, p.y) === TILE_WATER) addElectricZone(p.x, p.y, 72, 0.9);
    for (const pr of game.props) { if (Math.hypot(pr.x - fx, pr.y - fy) < r + pr.r + 8) { pr.charge = 'lightning'; pr.chargeTimer = 5; pr.zapCd = 0; addRing(pr.x, pr.y, pr.r + 8, '#9fe7ff', 0.3, 3); } } // 雷充能: charge crate → mobile electric wall
    addRing(fx, fy, r, '#9fe7ff', 0.25, 3); game.screenShake = Math.max(game.screenShake, 3);
    for (let i = 0; i < 8; i++) game.particles.push({ x: fx, y: fy, vx: rnd(-150, 150), vy: rnd(-150, 150), r: rnd(2, 4), life: rnd(0.2, 0.4), maxLife: 0.4, color: '#bdf5ff' });
  }
  export function updateWalls(dt) {
    let dirty = false;
    for (const w of game.walls) {
      const wallTile = w.kind === 'ice' ? TILE_ICEWALL : TILE_THIN;
      w.life -= dt;
      // Destroyed by something else (explosion broke earth wall, etc.) → drop entry, no revert.
      if (game.map[w.ty][w.tx] !== wallTile) { w.dead = true; dirty = true; continue; }
      // Ice walls melt when a fire zone touches them → steam.
      if (w.kind === 'ice') {
        const cx = w.tx * TILE + TILE / 2, cy = w.ty * TILE + TILE / 2;
        for (const fz of game.fireZones) {
          if (Math.hypot(fz.x - cx, fz.y - cy) < fz.r + 14) {
            game.map[w.ty][w.tx] = TILE_FLOOR; addSteamCloud(cx, cy, 26, 1.4); w.dead = true; dirty = true; break;
          }
        }
        if (w.dead) continue;
      }
      if (w.life <= 0) {
        if (game.map[w.ty][w.tx] === wallTile) game.map[w.ty][w.tx] = w.prev;
        w.dead = true; dirty = true;
      }
    }
    if (dirty) game.walls = game.walls.filter(w => !w.dead);
  }

  export function updateOil(dt) {
    let dirty = false;
    for (const o of game.oils) {
      o.life -= dt;
      if (game.map[o.ty][o.tx] !== TILE_OIL) { o.dead = true; dirty = true; continue; }
      const cx = o.tx * TILE + TILE / 2, cy = o.ty * TILE + TILE / 2;
      let ignite = false;
      for (const fz of game.fireZones) { if (Math.hypot(fz.x - cx, fz.y - cy) < fz.r + 12) { ignite = true; break; } }
      if (ignite) {
        game.map[o.ty][o.tx] = TILE_BURNT;
        addExplosion(cx, cy, 54 + game.stats.size * 8, 38, '油爆'); // chains to adjacent oil via the new fire zone
        o.dead = true; dirty = true; continue;
      }
      if (o.life <= 0) { if (game.map[o.ty][o.tx] === TILE_OIL) game.map[o.ty][o.tx] = o.prev; o.dead = true; dirty = true; }
    }
    if (dirty) game.oils = game.oils.filter(o => !o.dead);
  }

  export function updateBlackHoles(dt) {
    for (const bh of game.blackHoles) {
      bh.life -= dt;
      for (const e of game.enemies) {
        const dx = bh.x - e.x, dy = bh.y - e.y, d = Math.hypot(dx, dy);
        if (d < bh.r && d > 4) { const a = 2600 * (1 - d / bh.r) * dt; e.vx = (e.vx || 0) + dx / d * a; e.vy = (e.vy || 0) + dy / d * a; }
      }
      const pull = (arr) => { for (const c of arr) { const dx = bh.x - c.x, dy = bh.y - c.y, d = Math.hypot(dx, dy); if (d < bh.r && d > 4) { const s = Math.min(d, 130 * dt); c.x += dx / d * s; c.y += dy / d * s; } } };
      pull(game.poisonClouds); pull(game.fireZones); pull(game.steamClouds);
      if (bh.life <= 0 && !bh.exploded) { // collapse takes the build's element
        bh.exploded = true;
        addExplosion(bh.x, bh.y, bh.r * 0.9, 46, bh.storm ? '磁暴奇點' : '黑洞塌縮');
        applyElementalBurst(bh.x, bh.y, bh.r * 0.5);
        if (bh.storm) { // 磁暴: a chain-lightning rips through the clumped foes + an electric field
          addElectricZone(bh.x, bh.y, bh.r * 0.7, 0.9);
          let seed = null, sd = bh.r;
          for (const e of game.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - bh.x, e.y - bh.y); if (d < sd) { sd = d; seed = e; } }
          if (seed) chainLightningFrom(seed.x, seed.y, seed, 30 + game.stats.storm * 4);
          game.screenShake = Math.max(game.screenShake, 6);
        }
      }
    }
    game.blackHoles = game.blackHoles.filter(bh => bh.life > -0.05);
  }

  // ===== Interactive props (keystone) — a crate you can push / break / charge =====
  // Minimal set validated in training: 風掌 pushes it (ram), 土拳 breaks it (碎片),
  // 雷掌 charges it (zaps + becomes a mobile electric wall when pushed).
  export function spawnCrate(x, y) {
    game.props.push({ x: clamp(x, 40, W - 40), y: clamp(y, 40, H - 40), vx: 0, vy: 0, r: 17, hp: 60, maxHp: 60, charge: null, chargeTimer: 0, zapCd: 0, burn: 0, held: false, thrown: 0 });
  }
  // Hard-wall collision: shove an entity {x,y,r} out of any solid (non-held, non-thrown) crate.
  export function blockByProps(o) {
    for (const pr of game.props) {
      if (pr.dead || pr.held || pr.thrown > 0) continue;
      const dx = o.x - pr.x, dy = o.y - pr.y, dist = Math.hypot(dx, dy), min = o.r + pr.r;
      if (dist < min && dist > 0.0001) {
        const push = min - dist, ux = dx / dist, uy = dy / dist;
        const tx = o.x + ux * push, ty = o.y + uy * push;
        if (!circleHitsSolid(tx, o.y, o.r)) o.x = tx;
        if (!circleHitsSolid(o.x, ty, o.r)) o.y = ty;
      }
    }
  }
  // 風掌 撿取/齊射 — p.held 為陣列(木箱與小怪混裝)，上限 = 風掌星級。
  export function nearestLiftable(p) {           // nearest free crate in reach (also used by render's hint)
    let best = null, bd = 1e9; const reach = p.r + 17 + 30;
    for (const pr of game.props) {
      if (pr.dead || pr.held) continue;
      const d = Math.hypot(pr.x - p.x, pr.y - p.y);
      if (d < reach && d < bd) { bd = d; best = pr; }
    }
    return best;
  }
  function nearestGrabbableEnemy(p) {            // nearest grabbable foe in reach (slime/bug/imp, or stunned/chilled; never boss)
    let best = null, bd = p.r + 17 + 34;
    for (const e of game.enemies) {
      if (e.dead || e.held || e.type === 'boss') continue;
      const grabbable = e.type === 'slime' || e.type === 'bug' || e.type === 'imp' || e.stunTimer > 0 || e.chilled;
      if (!grabbable) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  export function tryGrab(p) {                    // grab nearest foe (preferred) → crate → (★3) pull a wall
    const it = nearestGrabbableEnemy(p) || nearestLiftable(p);
    if (it) {
      it.held = true; it.vx = 0; it.vy = 0; it.thrown = 0;
      p.held.push(it);
      addText(p.x, p.y - 46, it.type ? '抓起 ↑' : '舉起 ↑', '#dff3ff');
      addRing(p.x, p.y, 30, '#dff3ff', 0.25, 3);
      game.screenShake = Math.max(game.screenShake, 2);
      return true;
    }
    if ((game.stats.windpalmStar || 0) >= 3) return tryLiftWall(p); // ★3: terrain becomes ammo
    return false;
  }
  // ★3: pull the nearest thin/ice wall tile out of the ground as a throwable chunk.
  // Covers both player-built (土牆 TILE_THIN / 冰牆 TILE_ICEWALL) and arena-layout 薄牆 (TILE_THIN).
  // Permanent walls (TILE_WALL / borders) are off-limits — the safety line (else you'd breach the arena).
  export function nearestLiftableWallTile(p) {
    const reach = p.r + 17 + 30;
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    let best = null, bd = 1e9;
    for (let ty = pty - 2; ty <= pty + 2; ty++) for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
      if (tx < 1 || ty < 1 || tx >= COLS - 1 || ty >= ROWS - 1) continue;
      const t = game.map[ty][tx];
      if (t !== TILE_THIN && t !== TILE_ICEWALL) continue;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < reach && d < bd) { bd = d; best = { tx, ty, cx, cy, kind: t === TILE_ICEWALL ? 'ice' : 'earth' }; }
    }
    return best;
  }
  function tryLiftWall(p) {
    const w = nearestLiftableWallTile(p);
    if (!w) return false;
    game.map[w.ty][w.tx] = TILE_FLOOR;   // updateWalls drops any matching game.walls record next tick (no revert)
    const chunk = { x: w.cx, y: w.cy, vx: 0, vy: 0, r: 15, hp: 40, maxHp: 40, charge: null, chargeTimer: 0, zapCd: 0, burn: 0, held: true, thrown: 0, wall: w.kind };
    game.props.push(chunk);
    p.held.push(chunk);
    addText(p.x, p.y - 46, w.kind === 'ice' ? '拔起冰牆 ↑' : '拔起薄牆 ↑', w.kind === 'ice' ? '#bff4ff' : '#d1a06a');
    addRing(p.x, p.y, 30, w.kind === 'ice' ? '#bff4ff' : '#caa472', 0.25, 3);
    game.screenShake = Math.max(game.screenShake, 2);
    return true;
  }
  export function throwHeld(angle) {              // volley-throw everything held, fanned along the aim
    const p = game.player; const n = p.held.length; if (!n) return;
    p.held.forEach((it, i) => {
      const a = angle + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.20);
      it.held = false;
      if (it.type) { it.vx = Math.cos(a) * 720; it.vy = Math.sin(a) * 720; it.thrown = 0.6; it.stunTimer = Math.max(it.stunTimer || 0, 0.8); } // foe
      else { it.vx = Math.cos(a) * 640; it.vy = Math.sin(a) * 640; it.thrown = 0.5; } // crate
    });
    p.held = [];
    p.cooldown = Math.max(p.cooldown, 0.26);
    addText(p.x, p.y - 46, n > 1 ? `齊射 ×${n} →` : '投擲 →', '#eafaff');
    addRing(p.x + Math.cos(angle) * 20, p.y + Math.sin(angle) * 20, 26, '#eafaff', 0.22, 3);
    game.screenShake = Math.max(game.screenShake, 4);
    for (let i = 0; i < 10; i++) { const a = angle + rnd(-0.4, 0.4), s = rnd(120, 260); game.particles.push({ x: p.x + Math.cos(angle) * 16, y: p.y + Math.sin(angle) * 16, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rnd(2, 4), life: 0.3, maxLife: 0.3, color: '#dff3ff' }); }
  }
  export function pushProp(pr, fromX, fromY, force) {
    const a = Math.atan2(pr.y - fromY, pr.x - fromX);
    pr.vx = (pr.vx || 0) + Math.cos(a) * force; pr.vy = (pr.vy || 0) + Math.sin(a) * force;
  }
  export function shatterProp(pr, reason) {
    if (pr.dead) return;
    pr.dead = true; const cx = pr.x, cy = pr.y, charged = pr.charge === 'lightning';
    if (pr.held) {                                  // bursting in your hands: drop it (fire singes you)
      const hi = game.player.held.indexOf(pr); if (hi >= 0) game.player.held.splice(hi, 1);
      pr.held = false;
      if (reason === 'fire') damagePlayer(10, '燙手');
    }
    for (const e of game.enemies) {                  // fragments bite nearby enemies
      if (e.dead) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < 72 + e.r) {
        damageEnemy(e, 18, cx, cy, '碎片');
        const a = Math.atan2(e.y - cy, e.x - cx);
        e.vx = (e.vx || 0) + Math.cos(a) * 190; e.vy = (e.vy || 0) + Math.sin(a) * 190;
        if (charged) { e.stunTimer = Math.max(e.stunTimer || 0, 0.5); }
      }
    }
    const shardCol = reason === 'fire' ? '#ff8a3a' : (pr.wall === 'ice' ? '#bff4ff' : '#caa472');
    for (let i = 0; i < 16; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(120, 320); game.particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2, 5), life: rnd(0.3, 0.6), maxLife: 0.6, color: shardCol }); }
    addRing(cx, cy, 64, reason === 'fire' ? '#ff8a3a' : '#d8b888', 0.3, 4);
    if (reason === 'fire') addFireZone(cx, cy, 30, 1.0, true);
    if (charged) addElectricZone(cx, cy, 64, 0.6);
    game.screenShake = Math.max(game.screenShake, 4);
  }
  export function updateProps(dt) {
    if (!game.props.length) return;
    for (const pr of game.props) {
      if (pr.dead) continue;
      if (pr.thrown > 0) pr.thrown = Math.max(0, pr.thrown - dt);
      const sp = pr.held ? 0 : Math.hypot(pr.vx, pr.vy);
      if (sp > 1) {                                   // sliding: move, bounce off walls, ram enemies
        let nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
        if (pr.wall === 'earth' && sp > 120) breakThinWalls(nx, ny, pr.r); // 土碎塊砸穿薄牆(永久牆/邊界免疫)
        if (circleHitsSolid(nx, pr.y, pr.r)) { pr.vx *= -0.3; nx = pr.x; }
        if (circleHitsSolid(pr.x, ny, pr.r)) { pr.vy *= -0.3; ny = pr.y; }
        pr.x = clamp(nx, pr.r, W - pr.r); pr.y = clamp(ny, pr.r, H - pr.r);
        if (sp > 120) for (const e of game.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - pr.x, e.y - pr.y) < pr.r + e.r) {
            damageEnemy(e, 14 + sp * 0.03, pr.x, pr.y, '撞擊');
            const a = Math.atan2(e.y - pr.y, e.x - pr.x);
            e.vx = (e.vx || 0) + Math.cos(a) * sp * 0.55; e.vy = (e.vy || 0) + Math.sin(a) * sp * 0.55;
            pr.vx *= 0.6; pr.vy *= 0.6;
            if (pr.wall === 'ice') { e.slowTimer = Math.max(e.slowTimer || 0, 1.4); e.chilled = true; } // 冰碎塊命中減速
            if (pr.charge === 'lightning') { e.stunTimer = Math.max(e.stunTimer || 0, 0.5); chainLightningFrom(e.x, e.y, e, 12); game.lightningBolts.push({ x1: pr.x, y1: pr.y, x2: e.x, y2: e.y, life: 0.12, maxLife: 0.12 }); }
          }
        }
        const fr = Math.max(0, 1 - 3.6 * dt); pr.vx *= fr; pr.vy *= fr;
      } else { pr.vx = 0; pr.vy = 0; }
      // lightning charge: periodically zap the nearest enemy + electrify water it sits in
      if (pr.charge === 'lightning') {
        pr.chargeTimer -= dt; pr.zapCd -= dt;
        if (pr.zapCd <= 0) {
          pr.zapCd = 0.5; let best = null, bd = 86;
          for (const e of game.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - pr.x, e.y - pr.y); if (d < bd) { bd = d; best = e; } }
          if (best) { damageEnemy(best, 8, pr.x, pr.y, '充能'); best.stunTimer = Math.max(best.stunTimer || 0, 0.3); game.lightningBolts.push({ x1: pr.x, y1: pr.y, x2: best.x, y2: best.y, life: 0.12, maxLife: 0.12 }); }
          if (tileAtPixel(pr.x, pr.y) === TILE_WATER) addElectricZone(pr.x, pr.y, 44, 0.5);
        }
        if (pr.chargeTimer <= 0) pr.charge = null;
      }
      // fire: catching a fire zone ignites the crate; it burns down then bursts
      if (pr.charge !== 'lightning') {
        for (const fz of game.fireZones) { if (Math.hypot(fz.x - pr.x, fz.y - pr.y) < fz.r + pr.r) { pr.charge = 'fire'; break; } }
      }
      if (pr.charge === 'fire') {
        pr.burn += dt; pr.zapCd -= dt;
        if (pr.zapCd <= 0) { pr.zapCd = 0.1; for (let i = 0; i < 2; i++) game.particles.push({ x: pr.x + rnd(-8, 8), y: pr.y + rnd(-8, 8), vx: rnd(-20, 20), vy: rnd(-46, -12), r: rnd(2, 4), life: 0.4, maxLife: 0.4, color: '#ff8a3a' }); }
        if (pr.burn > 1.6) { shatterProp(pr, 'fire'); continue; }
      }
      for (const ex of game.explosions) { if (Math.hypot(ex.x - pr.x, ex.y - pr.y) < ex.r + pr.r) { shatterProp(pr, 'break'); break; } }
      if (!pr.dead && pr.hp <= 0) shatterProp(pr, 'break');
    }
    game.props = game.props.filter(p => !p.dead);
  }


  export function updateProjectiles(dt) {
    for (const lb of game.lightningBolts) lb.life -= dt;
    game.lightningBolts = game.lightningBolts.filter(lb => lb.life > 0);

    for (const fb of game.fireballs) {
      fb.life -= dt;
      fb.x += fb.vx * dt;
      fb.y += fb.vy * dt;
      fb.trailTick -= dt;
      if (fb.trail && fb.trailTick <= 0) {
        fb.trailTick = 0.09;
        leaveSpellTrail(fb);
      }

      let hit = false;
      const tile = tileAtPixel(fb.x, fb.y);
      if (circleHitsSolid(fb.x, fb.y, fb.r)) hit = true;
      if (!hit) hit = reactProjectileWithTerrain(fb, tile);
      if (!hit) hit = reactProjectileWithClouds(fb);
      if (!hit) {
        for (const e of game.enemies) {
          if (Math.hypot(fb.x - e.x, fb.y - e.y) < fb.r + e.r) {
            applySpellHit(fb, e);
            hit = true;
            break;
          }
        }
      }
      if (hit || fb.life <= 0) {
        fb.dead = true;
        finishSpellProjectile(fb);
      }
    }
    game.fireballs = game.fireballs.filter(fb => !fb.dead && fb.life > 0);

    for (const b of game.enemyProjectiles) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (circleHitsSolid(b.x, b.y, b.r)) b.dead = true;
      if (Math.hypot(b.x - game.player.x, b.y - game.player.y) < b.r + game.player.r) {
        b.dead = true;
        damagePlayer(b.damage, '火焰小鬼');
        addFireZone(b.x, b.y, 16, 1.2, false);
      }
    }
    game.enemyProjectiles = game.enemyProjectiles.filter(b => !b.dead && b.life > 0);
  }

  // Earth fusions inherit their partner's reactions via these lists, then add the
  // shared "heavy impact" kicker (isEarthKind) on top.

  export function leaveSpellTrail(fb) {
    const k = fb.kind;
    if (isFireKind(k)) addFireZone(fb.x, fb.y, 12 + game.stats.size * 2, 0.75, true);
    else if (isPoisonKind(k)) addPoisonCloud(fb.x, fb.y, 13 + game.stats.size * 2, 1.05);
    else if (k === 'steam') addSteamCloud(fb.x, fb.y, 16 + game.stats.size * 2, 0.85);
    else if (isIceKind(k)) addRing(fb.x, fb.y, 13, '#bff4ff', 0.12, 1.5);
    else if (isLightningKind(k) && Math.random() < 0.35) game.lightningBolts.push({ x1: fb.x - fb.vx * 0.018, y1: fb.y - fb.vy * 0.018, x2: fb.x, y2: fb.y, life: 0.08, maxLife: 0.08 });
  }

  export function reactProjectileWithTerrain(fb, tile) {
    if (isLightningKind(fb.kind) && tile === TILE_WATER) {
      addElectricZone(fb.x, fb.y, 62 + game.stats.storm * 26, 0.85 + game.stats.storm * 0.12);
      addText(fb.x, fb.y - 28, 'CONDUCT', '#9fe7ff');
      return true;
    }
    if (isIceKind(fb.kind) && tile === TILE_WATER) {
      freezeWaterAt(fb.x, fb.y, 52 + game.stats.iceRadius * 18);
      return true;
    }
    if ((fb.kind === 'steam' || isFireKind(fb.kind)) && tile === TILE_ICE) {
      addSteamCloud(fb.x, fb.y, 48 + game.stats.size * 8, 2.8);
      addText(fb.x, fb.y - 28, 'STEAM', '#d8f6ff');
      return true;
    }
    return false;
  }

  export function reactProjectileWithClouds(fb) {
    for (const cloud of game.poisonClouds) {
      if (cloud.life > 0 && Math.hypot(fb.x - cloud.x, fb.y - cloud.y) < cloud.r + fb.r) {
        if (isFireKind(fb.kind) || fb.kind === 'steam') {
          cloud.life = -1;
          game.chainBooms++;
          addExplosion(cloud.x, cloud.y, Math.max(70, cloud.r + fb.boomRadius * 0.55) + game.stats.poisonBoom * 18, 50 + game.stats.size * 8 + game.stats.poisonBoom * 12, '毒霧爆燃');
          addText(cloud.x, cloud.y - cloud.r, 'TOXIC BOOM!', '#ffeb82');
          if (game.stats.siphon > 0) healPlayer(4 + game.stats.siphon * 3);
          return true;
        }
        if (isLightningKind(fb.kind)) {
          addElectricZone(cloud.x, cloud.y, Math.max(50, cloud.r + 18), 0.65);
          addText(cloud.x, cloud.y - cloud.r, '電毒雲！', '#c9b6ff');
          return true;
        }
      }
    }
    for (const sc of game.steamClouds) {
      if (sc.life > 0 && Math.hypot(fb.x - sc.x, fb.y - sc.y) < sc.r + fb.r && isLightningKind(fb.kind)) {
        addElectricZone(sc.x, sc.y, sc.r + 12, 0.72);
        addText(sc.x, sc.y - sc.r, '電霧！', '#d8f6ff');
        return true;
      }
    }
    return false;
  }

  export function applySpellHit(fb, e) {
    damageEnemy(e, fb.damage, fb.x, fb.y, spellDisplayName(fb.kind));
    if (isIceKind(fb.kind)) chillEnemy(e, 1.1 + game.stats.iceSlow * 0.5, fb.x, fb.y);
    if (isLightningKind(fb.kind)) chainLightningFrom(fb.x, fb.y, e, 10 + game.stats.storm * 3);
    if (isPoisonKind(fb.kind)) addPoisonCloud(e.x, e.y, 26 + game.stats.size * 4, 3.6);
    if (fb.kind === 'steam') addSteamCloud(e.x, e.y, 48 + game.stats.size * 8, 3.0);
    if (fb.kind === 'toxic_boom') addExplosion(e.x, e.y, 52 + game.stats.poisonBoom * 14 + game.stats.size * 6, 28 + game.stats.poisonBoom * 7, '毒爆彈');
    if (fb.kind === 'plasma') addExplosion(e.x, e.y, 48 + game.stats.size * 8, 32 + game.stats.size * 6, '電漿爆炸');
    if (fb.kind === 'frost_shock') {
      addElectricZone(e.x, e.y, 44 + game.stats.storm * 12, 0.52);
      e.slowTimer = Math.max(e.slowTimer || 0, 1.0 + game.stats.iceSlow * 0.35);
    }
    if (isEarthKind(fb.kind) && fb.kind !== 'magnet') {  // heavy stone impact: bonus knockback
      const a = Math.atan2(e.y - fb.y, e.x - fb.x), kb = 220 + game.stats.size * 28;
      e.vx = (e.vx || 0) + Math.cos(a) * kb; e.vy = (e.vy || 0) + Math.sin(a) * kb;
    }
    if (fb.kind === 'frost_rock') { e.slowTimer = Math.max(e.slowTimer || 0, 1.6 + game.stats.iceSlow * 0.4); e.chilled = true; }
    if (fb.kind === 'magnet') {                          // magnetise: drag nearby foes into the blast, then it chains
      for (const o of game.enemies) {
        if (o.dead) continue;
        const d = Math.hypot(o.x - fb.x, o.y - fb.y);
        if (d > 4 && d < 160) { const f = 360 * (1 - d / 160), a2 = Math.atan2(fb.y - o.y, fb.x - o.x); o.vx = (o.vx || 0) + Math.cos(a2) * f; o.vy = (o.vy || 0) + Math.sin(a2) * f; o.stunTimer = Math.max(o.stunTimer || 0, 0.25); }
      }
      addRing(fb.x, fb.y, 160, '#b8a0ff', 0.32, 4); addText(fb.x, fb.y - 28, '磁暴吸引！', '#cdbcff');
    }
  }

  export function finishSpellProjectile(fb) {
    const k = fb.kind;
    if (isFireKind(k)) { igniteGrass(fb.x, fb.y, fb.r + 14 + game.stats.fireSpread * 4); addFireZone(fb.x, fb.y, 18 + game.stats.size * 2, 1.2, true); }
    if (isIceKind(k)) freezeWaterAt(fb.x, fb.y, 42 + game.stats.iceRadius * 14);
    if (isPoisonKind(k)) addPoisonCloud(fb.x, fb.y, 28 + game.stats.size * 5, 4.0, k === 'toxic_mire');
    if (k === 'steam') addSteamCloud(fb.x, fb.y, 52 + game.stats.size * 8, 3.0);
    if (isLightningKind(k) && tileAtPixel(fb.x, fb.y) === TILE_WATER) addElectricZone(fb.x, fb.y, 58 + game.stats.storm * 20, 0.8);
    if (isEarthKind(k)) {                                // stone shards: a small burst that bites + breaks thin walls
      for (let i = 0; i < 5; i++) { const a = rnd(0, 6.28), sp = rnd(120, 300); game.particles.push({ x: fb.x, y: fb.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2, 5), life: rnd(0.3, 0.6), maxLife: 0.6, color: '#caa472' }); }
      for (const e of game.enemies) { if (!e.dead && Math.hypot(e.x - fb.x, e.y - fb.y) < 48 + e.r) damageEnemy(e, 10 + game.stats.size * 2, fb.x, fb.y, '碎石'); }
      breakThinWalls(fb.x, fb.y, 40);
    }
    if (k === 'magma') { addFireZone(fb.x, fb.y, 34 + game.stats.size * 5, 2.6, true); igniteGrass(fb.x, fb.y, fb.r + 20); addText(fb.x, fb.y - 24, '岩漿！', '#ff9a4a'); }
    if (fb.explosive || fb.life <= 0) addExplosion(fb.x, fb.y, fb.boomRadius, 26 + game.stats.size * 7, spellDisplayName(k));
    else addRing(fb.x, fb.y, fb.r * 3.2, fb.color, 0.18, 2);
  }

  export function updateEnemies(dt) {
    const p = game.player;
    for (const e of game.enemies) {
      e.hurt = Math.max(0, e.hurt - dt);
      e.blockTextCd = Math.max(0, (e.blockTextCd || 0) - dt);
      e.slowTimer = Math.max(0, (e.slowTimer || 0) - dt);
      if (e.dummy) { e.vx = 0; e.vy = 0; continue; } // training dummy: stand still, no AI
      if (e.held) { e.vx = 0; e.vy = 0; continue; }  // carried by 風掌 — no AI while grabbed
      if (e.thrown > 0) {                            // flung by 風掌: a body-projectile that rams others
        e.thrown -= dt;
        moveEnemyWithCollision(e, dt);               // wall-slam (①) applies to thrown bodies too
        const sp = Math.hypot(e.vx, e.vy);
        for (const o of game.enemies) {
          if (o === e || o.dead || o.held) continue;
          if (Math.hypot(o.x - e.x, o.y - e.y) < e.r + o.r) {
            const dm = 12 + sp * 0.03;
            damageEnemy(o, dm, e.x, e.y, '飛人撞擊'); damageEnemy(e, dm * 0.5, e.x, e.y, '飛人撞擊');
            const a = Math.atan2(o.y - e.y, o.x - e.x); o.vx = (o.vx || 0) + Math.cos(a) * sp * 0.5; o.vy = (o.vy || 0) + Math.sin(a) * sp * 0.5;
            e.vx *= 0.5; e.vy *= 0.5;
          }
        }
        e.vx *= Math.pow(0.35, dt); e.vy *= Math.pow(0.35, dt);
        continue;
      }

      if (e.type === 'boss') {
        updateBoss(e, dt);
      } else if (e.type === 'charger') {
        updateCharger(e, dt);
      } else {
        const a = angleTo(e, p);
        let desiredX = Math.cos(a);
        let desiredY = Math.sin(a);

        if (e.type === 'imp') {
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          if (d < 210) { desiredX = -desiredX; desiredY = -desiredY; }
          if (d > 310) { desiredX = Math.cos(a); desiredY = Math.sin(a); }
          if (d >= 210 && d <= 310) { desiredX = 0; desiredY = 0; }
          e.shootCd -= dt;
          if (e.shootCd <= 0 && d < 430) {
            e.shootCd = rnd(1.2, 2.0);
            spawnEnemyBolt(e);
          }
        }

        const n = norm(desiredX, desiredY);
        const onIce = tileAtPixel(e.x, e.y) === TILE_ICE;
        const speedMul = e.slowTimer > 0 ? 0.48 : 1;
        e.vx += n.x * e.speed * speedMul * 7 * dt;
        e.vy += n.y * e.speed * speedMul * 7 * dt;
        e.vx *= Math.pow(onIce ? 0.18 : 0.001, dt);
        e.vy *= Math.pow(onIce ? 0.18 : 0.001, dt);
        if (onIce && Math.random() < 0.04) game.particles.push({ x: e.x, y: e.y + e.r * 0.5, vx: rnd(-35, 35), vy: rnd(-20, 25), r: rnd(1.5, 3), life: rnd(0.15, 0.32), maxLife: 0.32, color: '#d8fbff' });
        moveEnemyWithCollision(e, dt);
      }

      if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
        const source = e.type === 'bug' ? '毒蟲撞擊' : e.type === 'imp' ? '火焰小鬼撞擊' : e.type === 'charger' ? '盾甲衝撞' : e.type === 'boss' ? '元素哥布林撞擊' : '史萊姆撞擊';
        damagePlayer(e.type === 'charger' && e.state === 'charging' ? e.touch + 10 : e.touch, source);
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        e.vx += (e.x - p.x) / d * (e.type === 'charger' ? 260 : 190);
        e.vy += (e.y - p.y) / d * (e.type === 'charger' ? 260 : 190);
      }
    }
  }


  export function updateBoss(e, dt) {
    const p = game.player;
    e.hurt = Math.max(0, e.hurt - dt);
    e.slowTimer = Math.max(0, (e.slowTimer || 0) - dt);
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const a = angleTo(e, p);
    e.facing = turnToward(e.facing || a, a, 2.4 * dt);
    const phase = e.hp < e.maxHp * 0.45 ? 2 : 1;
    if (phase !== e.phase) {
      e.phase = phase;
      game.stats.bossPhase = phase;
      game.message = 'Boss 進入第二階段：元素失控！';
      game.messageTimer = 2.4;
      game.stats.bossPhaseTwo = true;
      game.bossAttackLabel = '第二階段：連續元素災難';
      game.bossAttackTimer = 3.0;
      game.bossPhaseBanner = { life: 2.2, maxLife: 2.2, text: 'PHASE 2', sub: '元素失控：預警更短、連招更多', color: '#ffdf7a' };
      addText(e.x, e.y - 54, 'PHASE 2', '#ffdf7a');
      addRing(e.x, e.y, 128, '#ffdf7a', 0.95, 6);
      game.screenShake = Math.max(game.screenShake, 12);
      for (let i = 0; i < 2; i++) spawnEnemyNear(i === 0 ? 'bug' : 'imp', e.x, e.y);
    }

    const away = d < 210 ? -1 : (d > 310 ? 1 : 0);
    const orbit = e.phase === 2 ? 0.55 : 0.35;
    let dx = Math.cos(a) * away + Math.cos(a + Math.PI / 2) * orbit;
    let dy = Math.sin(a) * away + Math.sin(a + Math.PI / 2) * orbit;
    const n = norm(dx, dy);
    const speedMul = e.slowTimer > 0 ? 0.55 : 1;
    e.vx += n.x * e.speed * speedMul * 5.2 * dt;
    e.vy += n.y * e.speed * speedMul * 5.2 * dt;
    e.vx *= Math.pow(0.006, dt);
    e.vy *= Math.pow(0.006, dt);
    moveEnemyWithCollision(e, dt);

    e.attackCd -= dt;
    e.summonCd -= dt;
    if (e.summonCd <= 0) {
      e.summonCd = e.phase === 2 ? rnd(5.0, 6.2) : rnd(6.8, 8.2);
      const choices = e.phase === 2 ? ['slime', 'bug', 'imp', 'charger'] : ['slime', 'bug', 'imp'];
      const count = e.phase === 2 ? 2 : 1;
      for (let i = 0; i < count; i++) spawnEnemyNear(choices[Math.floor(Math.random() * choices.length)], e.x, e.y);
      game.stats.bossSummons += count;
      addText(e.x, e.y - 48, '召喚小怪！', '#d7ff8c');
    }

    if (e.attackCd <= 0) {
      e.attackCd = e.phase === 2 ? rnd(1.15, 1.62) : rnd(1.65, 2.15);
      const targetX = clamp(p.x + rnd(-44, 44), 54, W - 54);
      const targetY = clamp(p.y + rnd(-44, 44), 54, H - 54);
      const roll = Math.random();
      if (e.phase === 1) {
        if (roll < 0.34) {
          game.bossAttackLabel = '毒瓶：離開紫色落點'; game.bossAttackTimer = 1.2;
          addBossWarning('poison', targetX, targetY, 46, 0.88, '#d998ff');
          addText(e.x, e.y - 44, '毒瓶預備', '#d998ff');
        } else if (roll < 0.62) {
          game.bossAttackLabel = '火圈：不要站在橘色圈內'; game.bossAttackTimer = 1.3;
          addBossWarning('fire', targetX, targetY, 48, 1.02, '#ffbd66');
          addText(e.x, e.y - 44, '火圈預備', '#ffbd66');
        } else {
          game.bossAttackLabel = '水雷連招：水池會被雷擊導電'; game.bossAttackTimer = 1.5;
          addWaterPoolAt(targetX, targetY, 48);
          addBossWarning('lightning', targetX, targetY, 62, 1.08, '#9fe7ff');
          addText(e.x, e.y - 44, '水雷連招', '#9fe7ff');
        }
      } else {
        if (roll < 0.26) {
          game.bossAttackLabel = '毒火連爆：紫圈後面接火圈'; game.bossAttackTimer = 1.4;
          addBossWarning('poison', targetX, targetY, 54, 0.70, '#d998ff');
          addBossWarning('fire', targetX + rnd(-26, 26), targetY + rnd(-26, 26), 50, 1.04, '#ffbd66');
        } else if (roll < 0.55) {
          game.bossAttackLabel = '大範圍導電：離開水池'; game.bossAttackTimer = 1.35;
          addWaterPoolAt(targetX, targetY, 58);
          addBossWarning('lightning', targetX, targetY, 76, 0.82, '#9fe7ff');
        } else if (roll < 0.78) {
          game.bossAttackLabel = '大火圈：橘圈會燃燒地板'; game.bossAttackTimer = 1.25;
          addBossWarning('fire', targetX, targetY, 66, 0.84, '#ffbd66');
        } else {
          game.bossAttackLabel = '電霧：蒸氣後接雷擊'; game.bossAttackTimer = 1.6;
          addBossWarning('steam', targetX, targetY, 58, 0.86, '#d8f6ff');
          addBossWarning('lightning', targetX, targetY, 64, 1.22, '#9fe7ff');
        }
      }
    }
  }

  export function updateCharger(e, dt) {
    const p = game.player;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const a = angleTo(e, p);
    const speedMul = e.slowTimer > 0 ? 0.55 : 1;
    const onIce = tileAtPixel(e.x, e.y) === TILE_ICE;
    if (onIce && e.state === 'charging') {
      game.stats.iceFalls++;
      stunCharger(e, '冰面滑倒！');
      recordDisaster('盾甲怪冰面滑倒', 0, 72);
      return;
    }

    if (e.state === 'pursue') {
      e.facing = turnToward(e.facing, a, 4.2 * dt);
      e.chargeCooldown -= dt;
      const n = norm(Math.cos(e.facing), Math.sin(e.facing));
      e.vx += n.x * e.speed * speedMul * 6.2 * dt;
      e.vy += n.y * e.speed * speedMul * 6.2 * dt;
      e.vx *= Math.pow(onIce ? 0.2 : 0.0015, dt);
      e.vy *= Math.pow(onIce ? 0.2 : 0.0015, dt);
      moveEnemyWithCollision(e, dt);
      if (e.chargeCooldown <= 0 && d > 95 && d < 340 && hasLineOfSight(e.x, e.y, p.x, p.y)) {
        e.state = 'windup';
        e.stateTimer = 0.72;
        e.vx *= 0.2;
        e.vy *= 0.2;
        e.facing = a;
        addText(e.x, e.y - 36, '蓄力！', '#ff8f6e');
      }
      return;
    }

    if (e.state === 'windup') {
      e.stateTimer -= dt;
      e.facing = turnToward(e.facing, a, 2.1 * dt);
      e.vx *= Math.pow(0.02, dt);
      e.vy *= Math.pow(0.02, dt);
      if (e.stateTimer <= 0) {
        e.state = 'charging';
        e.stateTimer = 0.58;
        const n = norm(Math.cos(e.facing), Math.sin(e.facing));
        e.vx = n.x * 520 * speedMul;
        e.vy = n.y * 520 * speedMul;
        game.screenShake = Math.max(game.screenShake, 3);
      }
      return;
    }

    if (e.state === 'charging') {
      e.stateTimer -= dt;
      const hitWall = moveEnemyWithCollision(e, dt, true);
      if (hitWall) {
        stunCharger(e, '撞牆暈眩！');
        breakThinWalls(e.x, e.y, 48);
      } else if (e.stateTimer <= 0) {
        e.state = 'recover';
        e.stateTimer = 0.34;
        e.vx *= 0.45;
        e.vy *= 0.45;
      }
      return;
    }

    if (e.state === 'recover') {
      e.stateTimer -= dt;
      e.vx *= Math.pow(0.01, dt);
      e.vy *= Math.pow(0.01, dt);
      moveEnemyWithCollision(e, dt);
      if (e.stateTimer <= 0) {
        e.state = 'pursue';
        e.chargeCooldown = rnd(1.0, 1.8);
      }
      return;
    }

    if (e.state === 'stunned') {
      e.stunTimer -= dt;
      e.vx *= Math.pow(0.04, dt);
      e.vy *= Math.pow(0.04, dt);
      moveEnemyWithCollision(e, dt);
      if (e.stunTimer <= 0) {
        e.state = 'pursue';
        e.chargeCooldown = rnd(1.1, 1.9);
      }
    }
  }

  export function moveEnemyWithCollision(e, dt, charging = false) {
    e.slamCd = Math.max(0, (e.slamCd || 0) - dt);
    const preSp = Math.hypot(e.vx, e.vy);
    const nx = e.x + e.vx * dt;
    const ny = e.y + e.vy * dt;
    let hit = false;
    if (!circleHitsSolid(nx, e.y, e.r)) e.x = nx; else { e.vx *= charging ? -0.15 : -0.25; hit = true; }
    if (!circleHitsSolid(e.x, ny, e.r)) e.y = ny; else { e.vy *= charging ? -0.15 : -0.25; hit = true; }
    blockByProps(e);                                // crates block enemies too
    // Wall-slam: an enemy flung into a solid (arena wall / built 土牆·冰牆) at speed takes
    // impact damage + a brief stun. Turns every knockback into an environment weapon —
    // wind/fist/dash/thrown-body slams, and pairs with walls you build via the secondary.
    if (hit && preSp > 230 && e.slamCd <= 0 && !e.dead) {
      damageEnemy(e, Math.min(60, 6 + (preSp - 230) * 0.10), e.x, e.y, '撞牆');
      e.stunTimer = Math.max(e.stunTimer || 0, 0.5);
      e.slamCd = 0.4;
      game.screenShake = Math.max(game.screenShake, 3);
      addText(e.x, e.y - 30, '撞牆!', '#ffd7a0');
      for (let i = 0; i < 8; i++) { const a = rnd(0, 6.28), s = rnd(80, 200); game.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rnd(2, 4), life: 0.3, maxLife: 0.3, color: '#ffe6c2' }); }
    }
    return hit;
  }

  export function stunCharger(e, text) {
    e.state = 'stunned';
    e.stunTimer = 1.15;
    e.vx *= -0.22;
    e.vy *= -0.22;
    game.stats.chargerStuns++;
    game.screenShake = Math.max(game.screenShake, 8);
    addText(e.x, e.y - 36, text, '#d7ff8c');
    for (let i = 0; i < 12; i++) {
      game.particles.push({
        x: e.x, y: e.y,
        vx: rnd(-160, 160), vy: rnd(-160, 160),
        r: rnd(2, 4), life: rnd(0.3, 0.65), maxLife: 0.65,
        color: '#ffd36d'
      });
    }
  }

  export function turnToward(current, target, maxStep) {
    const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + clamp(diff, -maxStep, maxStep);
  }

  export function hasLineOfSight(x1, y1, x2, y2) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 18);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      if (isSolidTile(tileAtPixel(x, y))) return false;
    }
    return true;
  }



  export function bossWarningLabel(type) {
    if (type === 'poison') return '毒瓶';
    if (type === 'lightning') return '雷擊';
    if (type === 'fire') return '火圈';
    if (type === 'steam') return '蒸氣';
    if (type === 'meteor') return '流星';
    return '危險';
  }

  export function addBossWarning(type, x, y, r, delay, color = '#ffdf7a') {
    game.bossWarnings.push({ type, x, y, r, life: delay, maxLife: delay, color, pulse: 0, label: bossWarningLabel(type) });
    game.stats.bossHazards++;
  }

  export function addWaterPoolAt(x, y, radius = 56) {
    let made = 0;
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx <= 0 || ty <= 0 || tx >= COLS - 1 || ty >= ROWS - 1) continue;
        const t = game.map[ty][tx];
        if (t === TILE_WALL || t === TILE_THIN) continue;
        const cx = tx * TILE + TILE / 2;
        const cy = ty * TILE + TILE / 2;
        if (Math.hypot(cx - x, cy - y) <= radius) { game.map[ty][tx] = TILE_WATER; made++; }
      }
    }
    addRing(x, y, radius, '#79d3ff', 0.42, 3);
    if (made > 0) addText(x, y - 28, '召喚水池', '#9fe7ff');
    return made;
  }

  export function updateBossWarnings(dt) {
    for (const w of game.bossWarnings) {
      w.life -= dt;
      w.pulse += dt * 8;
      if (w.life > 0) continue;
      w.dead = true;
      if (w.type === 'poison') {
        addPoisonCloud(w.x, w.y, w.r, 5.2);
        addText(w.x, w.y - w.r, '毒瓶！', '#d998ff');
        addRing(w.x, w.y, w.r, '#d998ff', 0.36, 3);
      } else if (w.type === 'lightning') {
        addElectricZone(w.x, w.y, w.r, 0.82);
        addText(w.x, w.y - w.r, '雷擊！', '#9fe7ff');
      } else if (w.type === 'fire') {
        addFireZone(w.x, w.y, w.r, 2.1, false);
        addText(w.x, w.y - w.r, '火圈！', '#ffbd66');
        game.screenShake = Math.max(game.screenShake, 4);
      } else if (w.type === 'steam') {
        addSteamCloud(w.x, w.y, w.r, 3.0);
        addText(w.x, w.y - w.r, '蒸氣！', '#d8f6ff');
      } else if (w.type === 'meteor') {
        addExplosion(w.x, w.y, w.r, 38 + game.stats.size * 6 + spellMastery() * 4, '流星');
        addFireZone(w.x, w.y, w.r * 0.6, 2.4, true); // lava pool
        addText(w.x, w.y - w.r, '流星！', '#ff7a3a');
        game.screenShake = Math.max(game.screenShake, 8);
      }
    }
    game.bossWarnings = game.bossWarnings.filter(w => !w.dead);
  }

  export function updateZones(dt) {
    for (const fz of game.fireZones) {
      fz.life -= dt;
      fz.tick -= dt;
      if (fz.tick <= 0) {
        fz.tick = 0.25;
        igniteGrass(fz.x, fz.y, fz.r + 4);
        if (Math.hypot(game.player.x - fz.x, game.player.y - fz.y) < game.player.r + fz.r) damagePlayer(fz.dps * 0.25, '火焰地板');
        for (const e of game.enemies) {
          if (Math.hypot(e.x - fz.x, e.y - fz.y) < e.r + fz.r) damageEnemy(e, fz.dps * 0.25, fz.x, fz.y, fz.friendly ? '友方火焰區' : 'Boss火圈');
        }
      }
    }
    game.fireZones = game.fireZones.filter(fz => fz.life > 0);

    for (const ez of game.electricZones) {
      ez.life -= dt;
      ez.pulse += dt * 18;
      ez.tick -= dt;
      if (ez.tick <= 0) {
        ez.tick = 0.18;
        if (Math.hypot(game.player.x - ez.x, game.player.y - ez.y) < game.player.r + ez.r) damagePlayer(10, '水池導電');
        for (const e of game.enemies) {
          if (Math.hypot(e.x - ez.x, e.y - ez.y) < e.r + ez.r) {
            damageEnemy(e, 16 + game.stats.storm * 4 + game.stats.shockStun * 3, ez.x, ez.y);
            if (game.stats.shockStun > 0 && e.type === 'charger' && e.state === 'charging') stunCharger(e, '雷擊麻痺！');
            e.vx *= 0.65; e.vy *= 0.65;
          }
        }
      }
    }
    game.electricZones = game.electricZones.filter(ez => ez.life > 0);

    for (const pc of game.poisonClouds) {
      pc.life -= dt;
      pc.pulse += dt * 4;
      if (Math.hypot(game.player.x - pc.x, game.player.y - pc.y) < game.player.r + pc.r) damagePlayer(pc.dps * dt, '毒霧');
      for (const e of game.enemies) {
        if (e.type !== 'bug' && Math.hypot(e.x - pc.x, e.y - pc.y) < e.r + pc.r) {
          damageEnemy(e, pc.dps * 0.35 * dt, pc.x, pc.y);
          if (pc.mire) e.slowTimer = Math.max(e.slowTimer || 0, 0.4); // 毒沼: bog them down
        }
      }
    }
    game.poisonClouds = game.poisonClouds.filter(pc => pc.life > 0);

    for (const sc of game.steamClouds) {
      sc.life -= dt;
      sc.pulse += dt * 3.4;
      sc.tick -= dt;
      if (sc.tick <= 0) {
        sc.tick = 0.22;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - sc.x, e.y - sc.y) < e.r + sc.r) {
            e.slowTimer = Math.max(e.slowTimer || 0, 0.35);
            e.vx *= 0.82; e.vy *= 0.82;
          }
        }
      }
    }
    game.steamClouds = game.steamClouds.filter(sc => sc.life > 0);

    for (const ex of game.explosions) ex.life -= dt;
    game.explosions = game.explosions.filter(ex => ex.life > 0);
  }

  export function updateParticles(dt) {
    for (const p of game.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.05, dt);
      p.vy *= Math.pow(0.05, dt);
    }
    game.particles = game.particles.filter(p => p.life > 0);
  }

  export function updateRings(dt) {
    for (const r of game.rings) r.life -= dt;
    game.rings = game.rings.filter(r => r.life > 0);
    for (const s of game.slams) s.life -= dt;
    game.slams = game.slams.filter(s => s.life > 0);
  }

  export function updateFloatingTexts(dt) {
    for (const t of game.floatingTexts) {
      t.life -= dt;
      t.y += t.vy * dt;
    }
    game.floatingTexts = game.floatingTexts.filter(t => t.life > 0);
  }
