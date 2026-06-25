// Pure data + pure classifiers. No game state, no DOM, no behavior closures.
// (Behavior-bearing registries like upgradePool / SECONDARY stay in the sim.)

// element / fusion -> display colors + names (used by render + HUD + spell setup)
export const ELEMENT_INFO = {
  neutral: { name: '中性', color: '#f4e7ff', core: '#ffffff' },
  fire: { name: '火', color: '#ff9d4d', core: '#fff0a3' },
  ice: { name: '冰', color: '#9feeff', core: '#ffffff' },
  lightning: { name: '雷', color: '#8fe8ff', core: '#eaffff' },
  poison: { name: '毒', color: '#c07aff', core: '#f0c8ff' },
  steam: { name: '蒸氣', color: '#d8f6ff', core: '#ffffff' },
  toxic_boom: { name: '毒爆', color: '#d998ff', core: '#fff0a3' },
  plasma: { name: '電漿', color: '#ffcf6f', core: '#eaffff' },
  frost_shock: { name: '電霜', color: '#bff4ff', core: '#ffffff' },
  toxic_shock: { name: '電毒', color: '#b794ff', core: '#eaffff' },
  venom_frost: { name: '毒冰', color: '#b7ffd2', core: '#ffffff' },
  earth: { name: '土', color: '#c79a5b', core: '#ffe1a8' },
  magma: { name: '熔岩', color: '#ff7a3a', core: '#ffe08a' },
  frost_rock: { name: '凍岩', color: '#a9d8e6', core: '#ffffff' },
  magnet: { name: '磁暴', color: '#b8a0ff', core: '#eaffff' },
  toxic_mire: { name: '毒沼', color: '#9fae5a', core: '#e6ffa8' }
};

// arena flavor templates (id / name / desc)
export const arenaTemplates = [
  { id: 'garden', name: '失控溫室', desc: '草地很多，火焰會快速形成大片火場。' },
  { id: 'toxic', name: '煉金毒液地窖', desc: '毒霧與毒蟲更多，火元素很容易引發連鎖爆炸。' },
  { id: 'temple', name: '淹水魔法聖壇', desc: '水池很多，雷鏈很強；冰元素也能把水面凍成滑冰場。' },
  { id: 'maze', name: '崩壞訓練場', desc: '薄牆很多，爆炸與衝鋒可以改變戰場路線。' }
];

// element set -> spell kind (fusion table). Pure.
export function fusionKind(elements) {
  const s = new Set(elements);
  if (s.size === 0) return 'neutral';
  if (s.size === 1) return [...s][0];
  if (s.has('fire') && s.has('ice')) return 'steam';
  if (s.has('fire') && s.has('poison')) return 'toxic_boom';
  if (s.has('fire') && s.has('lightning')) return 'plasma';
  if (s.has('lightning') && s.has('ice')) return 'frost_shock';
  if (s.has('lightning') && s.has('poison')) return 'toxic_shock';
  if (s.has('ice') && s.has('poison')) return 'venom_frost';
  if (s.has('earth') && s.has('fire')) return 'magma';
  if (s.has('earth') && s.has('ice')) return 'frost_rock';
  if (s.has('earth') && s.has('lightning')) return 'magnet';
  if (s.has('earth') && s.has('poison')) return 'toxic_mire';
  return [...s].join('_');
}

// spell-kind element-family classifiers (pure). Drive reactions/kickers.
export function isFireKind(kind) { return ['fire','toxic_boom','plasma','magma'].includes(kind); }
export function isIceKind(kind) { return ['ice','frost_shock','venom_frost','frost_rock'].includes(kind); }
export function isLightningKind(kind) { return ['lightning','plasma','frost_shock','toxic_shock','magnet'].includes(kind); }
export function isPoisonKind(kind) { return ['poison','toxic_boom','toxic_shock','venom_frost','toxic_mire'].includes(kind); }
export function isEarthKind(kind) { return ['earth','magma','frost_rock','magnet','toxic_mire'].includes(kind); }
