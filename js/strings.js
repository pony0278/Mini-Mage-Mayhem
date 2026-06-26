// i18n (client). gettext-style: the Chinese source string IS the key — display sites wrap dynamic
// content in T(), and render's own UI literals are authored in English. Default 'en'; lang='zh'
// returns the key unchanged (so the original Chinese is "kept"). BR's client reuses this table.
// Unmapped strings pass through untranslated (graceful — they just show their source text).
export let lang = 'en';
export function setLang(l) { lang = l; }

const EN = {
  // elements / fusion kinds (ELEMENT_INFO names)
  '中性': 'Neutral', '火': 'Fire', '冰': 'Ice', '雷': 'Lightning', '毒': 'Poison',
  '蒸氣': 'Steam', '毒爆': 'Toxic Blast', '電漿': 'Plasma', '電霜': 'Frostvolt', '電毒': 'Venomvolt',
  '毒冰': 'Venomfrost', '土': 'Earth', '熔岩': 'Magma', '凍岩': 'Frostrock', '磁暴': 'Magnetstorm', '毒沼': 'Toxic Mire',
  // spell display names (spellDisplayName)
  '魔法飛彈': 'Magic Missile', '火球': 'Fireball', '冰箭': 'Ice Shard', '雷彈': 'Lightning Bolt', '毒彈': 'Poison Bolt',
  '蒸氣彈': 'Steam Bomb', '毒爆彈': 'Toxic Bomb', '電漿彈': 'Plasma Bolt', '電霜彈': 'Frostvolt Bolt', '電毒彈': 'Venomvolt Bolt',
  '毒冰刺': 'Venomfrost Spike', '巨石': 'Boulder', '熔岩彈': 'Magma Bolt', '磁暴彈': 'Magnetstorm Bolt', '毒沼彈': 'Mire Bolt',
  '融合飛彈': 'Fusion Bolt', '普通魔法飛彈': 'Plain Magic Missile',
  // flow names (currentFlowName)
  '蒸氣控場流': 'Steam Control', '火毒爆燃流': 'Fire-Poison Detonation', '電漿破壞流': 'Plasma Destruction',
  '電霜控場流': 'Frostvolt Control', '電毒雲流': 'Venom Cloud', '毒冰緩速流': 'Venomfrost Slow',
  '火焰燃燒流': 'Fire Burn', '冰面控場流': 'Ice Control', '雷池清場流': 'Lightning Pool', '毒霧消耗流': 'Poison Attrition',
  '危險混沌流': 'Reckless Chaos', '中性飛彈流': 'Neutral Bolt',
  // arenas (name + desc)
  '失控溫室': 'Overgrown Greenhouse', '煉金毒液地窖': 'Alchemy Venom Cellar', '淹水魔法聖壇': 'Flooded Sanctum', '崩壞訓練場': 'Crumbling Arena',
  '草地很多，火焰會快速形成大片火場。': 'Lots of grass — fire spreads into huge blazes fast.',
  '毒霧與毒蟲更多，火元素很容易引發連鎖爆炸。': 'More poison clouds and bugs; fire easily triggers chain explosions.',
  '水池很多，雷鏈很強；冰元素也能把水面凍成滑冰場。': 'Lots of water — lightning chains hard; ice freezes pools into slippery rinks.',
  '薄牆很多，爆炸與衝鋒可以改變戰場路線。': 'Lots of thin walls — explosions and charges reshape the battlefield.',
  // secondaries
  '冰牆': 'Ice Wall', '土牆': 'Earth Wall', '潑油': 'Oil Slick', '黑洞': 'Black Hole',
  // upgrade chips / tags (render TAGCOLOR keys)
  '元素': 'Element', '改造': 'Mod', '副攻': 'Secondary', '通用': 'Generic', '畢業': 'Capstone',
  // misc
  '未知': 'Unknown', '未選場': 'No Arena', '元素哥布林法師': 'Elemental Goblin Mage'
};

export function T(s) { if (lang === 'zh' || s == null) return s; return (s in EN) ? EN[s] : s; }
