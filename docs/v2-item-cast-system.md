# v2 道具系統:次數 + 排程施放(設計/規劃)

> 狀態:**骨架已實作(全 `delay:0` = 行為不變,只多了次數)**;動畫階段待 avatar 手指骨架後,
> 在 PUNCH STUDIO 排 clip → 填 `ITEM_SPEC` 的 clip+delay 逐列開。
> 相關:規格 F（[v2-spec-F-spells-items.md](v2-spec-F-spells-items.md)，撿即用道具 5 動詞）、
> 動作工作流（[animation-workflow.md](animation-workflow.md)，clip↔impact 對齊）。

## 目標

把道具從「單次、瞬間生效、無動作」升級成:
1. **多次數消耗品**(不同道具不同次數;風壓 3、冰霜 1、傳送 1)。
2. **每個道具有專屬使用動畫**(玩家在 PUNCH STUDIO 排),效果**在 impact 幀觸發**——與揮拳同一套 clip+impact 範式。
3. **分類用「正交欄位」而非單一 category enum**(見下),全部收在一張 `ITEM_SPEC` 表。

> 依賴:道具動畫要為 **avatar**(正式角色)編,排在 avatar 手指骨架之後(見對話)。
> 骨架本身是純 sim,可先做,不用等 avatar。

## 現況(調查結論)

- 道具存成單一字串 `f.item`(型別),用完即 `f.item = null`。讀 `f.item` 的地方共 7 處
  (pickup / useItem / HUD / 觸控情境標籤 / `__v2` hook),**全部當型別字串用**。
- `useItem(f)`(`v2-items.js`)**當幀瞬間**呼叫 `castWind/castIce/castTeleport`,無動畫、無 impact 延遲。
- **被抓/暈只有傳送能用**是**寫死**的:`if ((grabbed||stunned||fumble) && f.item !== 'teleport') return;`。

**要照抄的「拳」範式**(`v2-combat.js punch()` / `v2.js step()`):
- `punch()` 設 `punchFx=now`(動畫時鐘)、`punchKind`(選 clip)、`_strikeAt=now+STRIKE_DELAY[stage]`(impact 時刻)、`_strikeKind/_strikeDir`。
- `step()`:`if (f._strikeAt && game.time>=f._strikeAt) resolveStrike(f)` → impact 幀才判定命中;被打斷(暈/被抓)則 `resolveStrike` 內 return 取消。
- 動畫:`actor-brawler` 用 `CLIPS[PUNCH_CLIPS[punchKind]]` 從 `now-punchFx` 播;`STRIKE_DELAY` = impact 幀 ÷ 60。

## 設計

### 1. 資料模型:`f.item` 留字串 + 加 `f.itemUses`(最省侵入)

不改成物件(那要動 7 處讀取)。`f.item` 仍是型別字串;新增 `f.itemUses`(剩餘次數)。
既有讀取全部照舊,只有 HUD 多顯示次數。`resetFighter` 清 `f.itemUses=0`。

### 2. `ITEM_SPEC` 表(單一真相來源;分類=正交欄位)

**不做單一 category enum**——「瞬發/投擲/裝備」落在**不同軸**(時機/效果原型/次數),
一個道具可能同時具備多個屬性。改成一張表、每個屬性一欄、一列一道具、加道具=加一列:

```js
// v2-state.js
export const ITEM_SPEC = {
  //          次數  施放動畫        impact(s) 被抓/暈可用      瞄準        種類(純標籤)
  wind:     { uses: 3, clip: 'item_wind', delay: 0.25, whileDisabled: false, aim: 'facing', kind: 'blast'    },
  ice:      { uses: 1, clip: 'item_ice',  delay: 0.25, whileDisabled: false, aim: 'facing', kind: 'hazard'   },
  teleport: { uses: 1, clip: null,        delay: 0,    whileDisabled: true,  aim: 'self',   kind: 'mobility' },
};
```

欄位語意:
- **`uses`**:撿取時 `f.itemUses = ITEM_SPEC[type].uses`。
- **`clip` / `delay`**:施放動畫 clip 名 + impact 延遲(秒)。`clip:null` 或 `delay<=0` = **瞬發**(無動畫,直接生效)→ 傳送走這條。`delay` = 動畫 impact 幀 ÷ 60(同 `STRIKE_DELAY`)。
- **`whileDisabled`**:被抓/暈/踉蹌時可否使用。**直接取代寫死的 `!=='teleport'`**——加這張表反而清掉硬編碼。
- **`aim`**:`facing`/`self`/`target`。目前只當說明;未來接瞄準線 / 投擲道具(`aim:'target'`)用。
- **`kind`**:**純標籤**(blast/hazard/mobility…),給 HUD 分組 / AI 判斷 / 文件用。**機制由上面的旗標驅動,不是靠 kind。**

> 未來要做**投擲道具**:新增一列 `aim:'target'` + 一支丟投射物的 castX,**排程骨架不用改**。

### 3. 排程施放(瞬發 → impact,鏡像拳)

新增 fighter 欄位:`_itemCastAt`/`_itemCastType`(impact),`itemFx`/`itemClip`(動畫,**獨立於 punch 頻道** — 兩者互斥,punch 程式完全不動),`itemCastCd`(施法承諾/冷卻)。

```
useItem(f):
  ...守衛(state/carrying;whileDisabled 取代 !=='teleport')...
  若 itemCastCd>0 或已在施法 → return
  const spec = ITEM_SPEC[f.item]
  扣次數:if (--f.itemUses <= 0) f.item = null        // 起手即扣,不退還
  inc.itemUses[type]++
  若 !spec.clip || spec.delay<=0 → castItem(type,f)  // 瞬發(傳送)直接發、無動畫
  否則 → 排程:itemFx=now; itemClip=spec.clip; _itemCastAt=now+spec.delay; _itemCastType=type; itemCastCd=spec.delay+RECOVER

resolveItemCast(f):   // step 在 impact 幀呼叫
  const type=f._itemCastType; f._itemCastAt=0
  若 f.stunned||f.carriedBy||f.state!=='alive' → return   // 施法中被打斷 → 取消(次數已扣,不退)
  castItem(type,f)

castItem(type,f): wind→castWind / ice→castIce / teleport→castTeleport
```

`step()` 加一行對稱的(緊接 `_strikeAt` 那行):
```
if (f._itemCastAt && game.time>=f._itemCastAt) resolveItemCast(f);
```
並像 `punchCd` 那樣每幀衰減 `f.itemCastCd`。

### 4. 動畫頻道(actor-brawler)

`updateBrawler` 加一段:`itemFx` 有效且 `now-itemFx < CLIPS[itemClip].dur` → 播道具 clip
(優先於拳/待機)。**punch 頻道原封不動**;道具與拳互斥,無衝突。

### 5. HUD(v2-hud)

`持有:風壓手套 ×3(右鍵 / E 使用)`;頭頂道具球旁標次數。觸控情境標籤沿用(`f.item` 仍是字串)。

## 已拍板的設計決策

1. **次數**:風壓 3、冰霜 1、傳送 1。
2. **施法被打斷**:impact 前被打暈/被抓 → **取消施放**;**次數不退還**(有風險張力)。
3. **施法承諾**:短承諾、**可被打斷**、施法中**不能同時揮拳**;**傳送 `delay:0` 瞬發**不受此限。
4. **分類**:不做 category enum,用 `ITEM_SPEC` 正交欄位;`whileDisabled` 取代 `!=='teleport'` 硬編碼。

## 落地策略:骨架先出、行為零改變

`ITEM_SPEC` 一開始全填 `clip:null / delay:0` → **所有道具仍瞬發**(跟現在一模一樣),只是多了「次數」。
等 studio 動畫做好,**逐列**填 `clip` 名 + `delay` (=impact 幀 ÷ 60),那個道具才切成「有動畫、impact 才發」。
風險極低、可漸進上線。

## 動到的檔案

| 檔案 | 改動 |
|---|---|
| `v2-state.js` | `ITEM_SPEC` 表、`f.itemUses`(resetFighter 清)、`RECOVER` 常數 |
| `v2-items.js` | `useItem` 改排程、新增 `resolveItemCast` + `castItem`、pickup 設 `itemUses`、`whileDisabled` 讀表 |
| `v2.js` | `step()` 加 `_itemCastAt` 派發 + `itemCastCd` 衰減;HUD 標籤;`__v2` hook |
| `v2-hud.js` | 持有顯示次數 |
| `actor-brawler.js` | 道具 clip 播放頻道(itemFx/itemClip) |
| `brawler-clips.js` | (**動畫階段**)新增 `item_wind`/`item_ice` clip;`ITEM_SPEC` 填 delay |

**純加法**,拳 / 碰撞 / 現有玩法不動;骨架階段行為不變。

## 待辦(依序)

1. **骨架**(現可做,純 sim):資料模型 + `ITEM_SPEC`(全 `delay:0`)+ 排程派發 + HUD 次數 + brawler 頻道。行為不變。
2. **動畫**(等 avatar 手指骨架):PUNCH STUDIO 排 `item_wind`/`item_ice` → 貼 `brawler-clips.js` → `ITEM_SPEC` 填 clip+delay。
3. **逐列開**:每支動畫對齊 impact 幀後,把該道具從瞬發切成排程。
4. **未來**:投擲道具(`aim:'target'` + 投射物 castX);瞄準線;AI 依 `kind` 選用。
