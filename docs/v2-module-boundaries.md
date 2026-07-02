# v2 模組邊界定義書（v2.js 拆分）

> 目的：v2（魔法事故報告 · 收容測試）進入長期打磨期（美術／手感／法術道具三線並行），
> 單檔 `js/v2.js` 已成維護瓶頸。本文件記錄拆分前的分析、目標模組邊界、與驗證協定。
> 方法論沿用單機版拆分的前例：[module-boundaries.md](module-boundaries.md)。

## 1. 拆分前現況（2026-07 分析）

| 檔案 | 行數 | 職責數 |
|---|---|---|
| `js/v2.js` | 1077 | **7+**：調參常數、地形、戰鬥模擬、道具、爆桶、AI、攝影機、報告生成、HUD 繪製、輸入、開機 |

具體症狀：
- 每加一個玩法功能要動 4~5 個不相鄰區塊（常數區＋resetFighter＋step 計時器＋HUD＋按鍵）。
- 符號級分析：**165 個頂層符號，15 個死碼（0 引用）**，另有一整區殘留系統（見 §2）。
- 大檔精準編輯的錨點風險隨行數上升。

## 2. 死碼清單（已在拆分前移除，git 歷史可找回）

| 類別 | 符號 | 來源時代 |
|---|---|---|
| 舊基礎動詞「陣風」 | `SHOVE_FORCE/RANGE/CONE/CD/MUL`、`AI_SHOVE_CD` | 陣風降為道具（spec F）前 |
| 搶獎盃 loop | `trophy`、`boss`、`holdMeter`、`holderPid`、`TROPHY_R`、`HOLD_WIN`、`BOSS_*`、`FAR`、`updateBoss`（已無人呼叫）、`dropTrophy`、`winRound`、`overAir` | spec D 浮島玩法，被收容測試（spec E/F）取代 |
| 浮島導航圖 | `nearestIslandCenter`、`wellOnIsland`、`islandIndexAt`、`bridgeBetween`、`bridgeFarEnd`、`nextWaypoint`、`islandFarthestFromBoss` | 舊 AI 過橋尋路；現行 AI 只追人/推艙 |
| 殘留計數器 | `inc.bossCatches/grabs/maxHold` | 搶獎盃時代的報告欄位 |

保留：`TERRAIN='isles'` 模式本體（地形/斷橋/墜落死法劇場/`aiSafeDir`）——仍可開關，是未來場地的素材庫。

## 3. 目標模組（拆分後）

| 模組 | 內容 | 匯入 |
|---|---|---|
| `v2-state.js` | **唯一的狀態與調參中心**：全部 tuning 常數、資料表（ITEM_INFO/STAGE_NAME/METHOD_*/COLORS/NAMES）、共享可變單例（`fighters`/`inc`/`pads`/`barrels`/`iceZones`/`containLog`/`roundWins`/`camRig`/`CAMB`）、可重賦值純量集中在 **`v2s` 物件**（stage/*Cur/matchOver/report/winnerPid/banner*/localFlash/fallReason*）、`resetFighter`/`reset*`/`applyStage`/`iceAt`/`inPod`/`dlog` | constants |
| `v2-terrain.js` | 地形與幾何：`TERRAIN`/`FREEFORM`/`WEIGHTY`/`KNOCK_*`、`ISLANDS`/`BRIDGES`、`onSolid`/`segDist`、`buildArena`/`buildFlatMap`/`buildFlatArena`、`bridgeAssist`/`aiSafeDir` | constants, state(game) |
| `v2-report.js` | 事故報告生成（Phase 1 的主要擴充點）：`generateReport`/`mostUsedItem`/`pickComment` | v2-state |
| `v2-combat.js` | 戰鬥動詞與移動：`readMove`/`camRel`/`moveFighter`/`slideKnock`/`hitsFighter`、`flinch`/`camKick`、`punch`(三連擊)/`stunFighter`/`doPushOff`、`startCarry`/`dropCarry`/`breakFree`、`containBy*`/`resolveContain`/`finalSeal`/`softReintegrate`/`endMatch`、`doAction`、`aiMove` | v2-state, v2-terrain, v2-report, sim(fx), state |
| `v2-items.js` | 道具與危險物：`updatePads`/`updateIce`/`useItem`/`castWind`/`castTeleport`/`castIce`、`explodeBarrel`/`updateBarrels` | v2-state, v2-combat, sim(fx) |
| `v2-hud.js` | 2D HUD 全部繪製：`hctx` 持有、`drawHud`/`drawContainHud`/`drawPips`/`drawItems`/`drawReport`、build tag | v2-state, render(project) |
| `v2.js`（膠水） | 輸入（鍵盤/滑鼠/poll*）、`step()` 主模擬編排、`frame()` 迴圈、`resetRound`/`restartMatch`/`toggleAI`、開機（地形選擇/CAM/render 旗標）、`__v2` debug hook、tune 面板載入 | 全部 |

### 模組 DAG（無環）

```
constants → utils → state(單機) ─┐
v2-state ──→ v2-terrain          │
    │  └──→ v2-report            │
    └──→ v2-combat ←─(terrain,report)
              └──→ v2-items
v2-state ──→ v2-hud ←─ render(project)
v2.js(膠水) ← 以上全部 + sim/render/audio
```

## 4. 不變式（拆分後必須維持）

1. **`v2s` 是唯一的可重賦值純量容器**：跨模組純量一律 `v2s.x`（物件原地改），模組頂層不再 export `let`。陣列/物件單例（fighters/inc/…）沿用「原地變異、永不重新賦值」（同 `state.js` 的 `game`）。
2. **調參常數只住 `v2-state.js`**：改手感數值永遠只開一個檔案（tune 面板與未來難度檔都吃這裡）。
3. **combat/items/report 不得 import render/hud**（保持模擬可 headless）；hud 只讀狀態不寫玩法狀態。
4. **`window.__v2` hook 的 API 不變**（headless 測試腳本依賴它）。
5. 單機檔案（sim.js/render.js/main.js）**零改動**——v2 拆分不觸碰單機 DAG。

## 5. 遷移與驗證協定

提交順序（每步獨立可回退）：
1. 本文件（分析報告）。
2. 死碼移除（§2 清單），行為零改變。
3. 模組拆分（§3），行為零改變，build tag 換 `mod-1` 供線上確認。

每步驗證：
- `node --check` 全部 `js/v2*.js`（ESM 複製為 `.mjs` 檢查）。
- headless 開機截圖（玩家可見、無 pageerror）。
- 戰鬥冒煙測試：三連擊段數/削血/終結技位移、格擋推開、實心碰撞、道具（風/傳/冰）、收容→軟重整→最終封存→報告生成。

## 6. 之後的擴充落點

- **美術**：`render.js`（brawler/場景）——不碰 v2 模組。
- **手感**：`v2-state.js` 調數值；新機制動 `v2-combat.js`。
- **法術道具**：`v2-items.js` 加 cast；常數/資料表進 `v2-state.js`；報告欄位進 `v2-report.js`＋`inc`。
- **報告擴充（Phase 1 本體）**：只動 `v2-report.js`。
