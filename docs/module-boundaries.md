# 模組邊界：index.html 拆分的依據

> 用途：把目前 ~4273 行的單檔 `index.html`（inline `<script>` IIFE）拆成多個 ES module 的**邊界定義書**。
> 目標：解決「太肥」維護性問題，同時把 **sim 核心抽成 headless**（= roadmap 的 B0，未來 BR / WASM 的地基），全程**零 build、仍是靜態頁**。
> 狀態：**結構重構完成** ✅。步驟 0→1→1.5→2→3→4→5 全做完:遊戲碼全在 `js/`（constants/utils/data/state/sim/render/main + camera-panel/training-panel），三份 HTML 是薄殼（index 56 行）。唯一剩下的是**選做的 3.5 intent adapter**（讓 sim 完全 headless;目前 sim 仍 import CAM/mouse/keys）。行號為早期快照（已漂移，僅供定位）。

---

## 0. 一句話

> sim / render 的邊界**天生就已經乾淨**（量化證明見 §2），拆分風險低。
> 唯一需要決策的接縫是「**輸入／相機 adapter**」——把它做好，`sim.js` 就變成真正的 headless 核心。

---

## 1. 現況：三層結構（行號快照）

```
58–276   基礎 + 資料   DOM refs, W/H/TILE, TILE_* enum, VIEW, helpers(rnd/clamp/dist/angleTo/norm),
                       輸入事件處理器(92–114, 956, 969), game 狀態物件(140), 資料表(arena/wave/upgradePool)
278–2650 ★ SIM        地圖, 法術(shoot/castIce/castLightning), 投射物, 區域(火/毒/電/蒸氣),
                       元素反應, 敵人/Boss/Charger, 玩家/衝刺/副攻/木箱, update(dt) 主迴圈,
                       FX 發射(addText / addRing / addSlam → push 進 game 陣列)
─────────────────────────── 2651 分隔線 ───────────────────────────
2655–3296 RENDER-3D    THREE 場景/相機/CAM/燈光/幾何/材質, mesh 建構(buildPlayer/Enemy),
                       actorMeshes Map, sync*, render3D, project(用 camera), updateMouseWorld(raycast)
3298–4258 RENDER-HUD   ctx 2D: draw / drawMap / actors+sprites / zones / ui / upgrade / title / end / 選單
4259      loop(now)    接線:update(dt) + render3D() + draw()
```

---

## 2. 量化證據：耦合幾乎為零

| 檢查 | 結果 | 意義 |
|---|---|---|
| sim 區(<2651)出現 `ctx.`（2D 繪圖）| **0 次** | sim 從不畫 HUD |
| sim 區出現 `THREE` / `scene.` / `camera.` / `renderer.` | **0 次** | sim 從不碰 3D |
| render 區(>2651)**寫入** `game.*` 狀態 | **0 次** | render 只讀，不污染狀態（僅讀 `game.state`/`stats`/`upgrades` 做條件繪圖）|
| sim 實體上掛 3D mesh handle（`e.mesh`）| **無** | mesh 存在 render 側的 `actorMeshes` Map（以 entity 為 key）；實體從 `game.enemies` 移除時 render 自行回收 mesh |

`game{}` 是一個**純狀態快照**：`state / time / score / kills / wave / screenShake / message / map / player /
fireballs / enemies / poisonClouds / fireZones / electricZones / explosions / walls / oils / blackHoles /
props / particles / rings / slams / floatingTexts / upgrades / stats / run / …`
——沒有任何 DOM 或 THREE 參照，等於一個**可序列化的 sim state**。

---

## 3. 唯一真正的接縫：輸入／相機 adapter ⭐

sim 全域只有**一處**漏到 render／設定層：

1. `updatePlayer`（行 1583）讀 `CAM.azimuth` → WASD 相對鏡頭旋轉移動基底。
2. 瞄準：`mouse.x/y`（**世界座標**）是 render 側 `updateMouseWorld`（行 3230）用 `camera` 對地面 **raycast** 算出來的；sim 讀這個世界座標來瞄準/施法。

兩者本質都是「**相機朝向影響移動基底與瞄準投影**」。在 headless（伺服器無相機）情境下，輸入本來就該以世界座標直接給 sim。

### 決策（提案）：`update(dt, intent)`

把 sim 進入點改成接收一個**世界座標的意圖結構**，而不是反向去抓 `keys` / `mouse` / `CAM`：

```
intent = {
  move:   { x, y },   // 已套用 CAM.azimuth 的世界座標移動向量
  aim:    { x, y },   // 已 raycast 到地面的世界座標準心
  fire, secondary, dash, throw, // 按鍵狀態（布林）
}
```

- 由 `input.js`（**允許**知道 CAM + 做 camera raycast）產生 `intent`。
- `sim.update(dt, intent)` 從此**不碰 DOM、不碰相機** → 真正 headless = roadmap **B0**。
- 同一份已驗證的 JS 未來可直接當 BR 伺服器邏輯核心 / 編 WASM，**不用重寫**。

> 這是拆分裡**唯一需要動腦的決策**，其餘都是機械搬檔。**建議和拆分一起做**（越晚做越痛）。

---

## 4. 模組 DAG（依賴單向，不可成環）

```
constants.js ─┐
utils.js ─────┼─→ data.js ─→ sim.js ─→ ┌─ render3d.js ─┐
              │   (純資料/分類器)  (★核心) │   input.js ───┼─→ main.js (boot + loop)
              └─────────────────────────→ └─ hud.js ──────┘
```

| 模組 | 內容 | 依賴 |
|---|---|---|
| `constants.js` | `W/H/TILE`、`TILE_*` enum、`VIEW` | 無 |
| `utils.js` | `rnd/clamp/dist/angleTo/norm/circleRectOverlap/colorHex` | 無 |
| `data.js` | **純**資料：`ELEMENT_INFO`(顏色/名稱)、arena tile 樣板、`waveEvents`、`isFireKind`…等分類器、`fusionKind`、label/desc | constants |
| `sim.js` ★ | `game` 狀態 + 全部 update/法術/敵人/區域/反應/玩家/衝刺/副攻/木箱邏輯、FX 發射、**帶行為的註冊表**(`upgradePool`/`SECONDARY`) | constants, utils, data |
| `render3d.js` | THREE 場景/相機/`CAM`/燈光/幾何/材質、mesh 建構、`actorMeshes`、`sync*`、`render3D`、`project`、`updateMouseWorld` | constants, utils；**唯讀** sim 狀態 |
| `hud.js` | ctx 2D：`draw/map/actors/sprites/zones/ui/upgrade/title/end/選單/reticle/banner` | constants, utils, data；唯讀 sim；用 render3d 的 `project` |
| `input.js` | DOM key/mouse 事件 → 產生世界座標 `intent`（套 CAM.azimuth + cursor→world raycast）| constants；需要 render3d 的 camera/raycast |
| `main.js` | boot：初始化 renderer、接 input、`loop()`：`intent → sim.update(dt,intent) → render3D() → draw()` | 全部 |

**鐵律：`sim.js` 不准 import `render3d` / `hud` / `input` / `main`。** 這條不變式就是「sim 永遠可抽成 headless」的保證。今天的 CAM/mouse 耦合違反了它 —— 用 §3 的 `intent` 接縫修掉。

> **已拍板（§7-1）**：第一刀把 `render3d + hud` 合成**單一 `render.js`**，降低一次搬檔的面數；待穩定後（rule of three）再細分回 `render3d.js` / `hud.js`。

---

## 5. 拆分時要注意的坑（分析時就先標）

- **資料表裡藏行為**：`upgradePool[].apply`、`SECONDARY[].cast` 是 closure，會呼叫 sim 函式（`injectElement` / `buildWall` / `toast`）。→ **這些「帶行為的註冊表」留在 `sim.js`**；只有**純資料**（`ELEMENT_INFO` 顏色/名稱、`isXKind`、arena tile 樣板）進 `data.js`。
- **`project()`**：定義在行 84（基礎區）但用 `camera`、只被 render 呼叫 → 歸 **render3d**。
- **FX 是 producer/consumer**：sim 的 `addText/addRing/addSlam` 只 push 進 `game.floatingTexts/rings/slams`，render 再畫 → 乾淨接縫，**別動**。
- **render 可能有重複路徑**：同時存在 3D voxel mesh（`syncActors`/`buildEnemy`）**和** 2D sprite（`drawEnemySprite` 行 3616 / `drawPlayerSprite` 行 3757）。**拆分前先確認哪條是現役**，順手清掉死碼（這也是「太肥」的來源之一）。
- **ESM 不能跑 `file://`**：拆成 module 後，本地無頭測試要起 `python -m http.server`（部署到 GitHub Pages 是 HTTP，無影響）。三份檔（`index.html`/`camera-sandbox.html`/`training.html`）目前共用同一份遊戲 JS，拆分後要決定它們如何共享 module（見 §7）。

---

## 6. 搬檔順序（已拍板，漸進、每步可驗證）

0. ✅ **先刪死碼**（§7-4，commit `9773c85`）：移除舊版 2D top-down 渲染器（§8 全部 12 函式 + `onGround` + `VIEW`/`TH` + 舊 ortho 註解），~501 行/檔。三檔同步、語法 OK、0 殘留引用、in-game 渲染無誤。**行為零變化**（原本就無人呼叫）。
1. ✅ **最安全先抽**：`js/constants.js`（W/H/TILE/tile-enum）+ `js/utils.js`（rnd/clamp/dist/angleTo/norm/circleRectOverlap）+ `js/data.js`（ELEMENT_INFO/arenaTemplates/fusionKind/isX­Kind）。三檔 `<script>` 改 `type="module"` + `import`，移除內聯定義。HTTP 載入零錯誤、in-game 渲染無誤。**首次引入 ESM**：本地測試改走 `python -m http.server`；deploy workflow 加 copy `js/`（Pages 目前走分支直出，`js/` 已在 root，無破壞）。
1.5. ✅ **抽 `state.js`**（§7-5，render 的前置）：`export const game / keys / mouse`（三個跨界共享的可變單例；已驗證只原地 mutate、從不重新賦值 → live-binding 安全）。`state.js` 只 import `constants`（mouse 初值用 W/H）。三檔加 `import { game, keys, mouse }`、移除內聯定義;HTTP 載入零錯誤、training 可玩、渲染不變。
2. ✅ **抽 `sim.js`**（依賴掃描後**提前**——見 §7-2 修訂）：`waveEvents`/`upgradePool`/`DASH_FX`/`SECONDARY` + 全部模擬函式搬出，共 **2568 行** → `js/sim.js`。`import` from constants/utils/data/state（game/keys/mouse/CAM）；**over-export** 所有頂層函式 + 4 個 const（未來 render/input 直接 import）。三檔 HTML 砍到 ~1270–1390 行（各少 ~2560 行）。
   - ✅ **2a**：`CAM → state.js`（解 render↔sim 環）。
   - ✅ **2b-prep**：把 sim 唯一的 render 呼叫 `updateMouseWorld()` 從 `update()` 移到 `loop()`（render-owned;camera-sandbox 用 pause-preserving 形式）→ sim 對 render 零呼叫。
   - ✅ **2b**：兩段（waveEvents→island 前、shoot→divider 前）line-slice 抽出，**中間的 input island（click/menu-keydown 兩個 handler）留在內聯**。三檔 sim 區已驗證 byte-identical。內聯 import sim 用到的符號（index/camera 16 個;training 21 個——測試面板多用 upgradePool/openUpgrade/spawnCrate/syncSpell/injectElement）。
   - 驗證：sim.js + 三內聯模組語法 OK;HTTP 載入三檔零錯誤;training `state=playing`、sim time 前進(0.04→0.34)、in-game 渲染無誤。
3. ✅ **抽 `render.js`**（§7-1，單一檔 1146 行）：3D（THREE 場景/相機/燈光/幾何/材質/mesh/sync*）+ HUD（draw/ui/upgrade/title/end/banner）+ relocate `project`。`import` 10 個 sim presentation 函式 + `SECONDARY`（from sim.js）+ game/mouse/CAM（state）+ constants/utils/data;自己 grab DOM（canvas/hud/screenCtx/ctx）。`export` draw/updateMouseWorld/camera/mouseScreen/project（內聯 loop + 面板用）。
   - **camera-sandbox 特例**：其 render = index render + 相機面板 IIFE + 1 行 live-fov。render.js 取 index 版 **+ 補那行 live-fov**（對 index/training 是 no-op，因 CAM.fov 不變）→ 三檔共用同一 render.js;**相機面板 IIFE 當 island 留在 camera-sandbox 內聯**（只依賴 CAM + DOM）。
   - 三檔內聯砍到 **index 143 行 / training 265 / camera-sandbox 224**（原 ~4273）。驗證:語法全過;HTTP 三檔零錯誤;training 可玩;camera-sandbox 面板可調(fov 滑桿→CAM→render 即時生效)、渲染無誤。
3.5. **（獨立）intent adapter**：把 sim 讀 mouse/CAM/keys 改成 `update(dt, intent)`，sim 變真 headless（roadmap B0）；`CAM` 從 state.js 移回 render.js。專心做 + 驗手感。
4. ✅ **`main.js`**（含輸入處理 + loop + boot;input 暫不獨立成 input.js——rule of three，glue 很小）：`export setPaused`（camera-sandbox pause hook）、`window.__game` debug hook。
5. ✅ **三份 HTML 收斂**（§7-3）：三檔都載 `js/main.js`；`camera-panel.js`（相機滑桿,import CAM+setPaused）、`training-panel.js`（測試面板,import game+sim helpers）做成各自的 add-on。**三檔內聯歸零**（index 56 行 / camera-sandbox 85 / training 91，全是 HTML+`<script src>`）。手動同步痛點消滅:改遊戲只動 `js/`。
6. 每步用無頭 Puppeteer（改走 `python -m http.server`）截圖/讀狀態，確認**行為零變化**再進下一步。

---

## 7. 決策記錄（已拍板）

1. **模組粒度**：✅ 第一刀 `render3d + hud` 合成**單一 `render.js`**；日後嫌大再細分（rule of three）。
2. **`update(dt, intent)` 接縫**：🔄 **修訂（依賴掃描後）**。原訂「跟 sim 一起做」。掃描發現 **render → sim 有 9 處呼叫**（HUD：upgradeName/upgradeDesc/isMastery/isSecMastery/previewSpellState/spellDescription/currentFlowName/makeRunStory/dashElement/nearestLiftable）→ **sim 必須在 render 之前抽**（順序對調）。而 sim 對 render 的耦合只有 **`CAM.azimuth` 1 行**（+ 讀 mouse/keys，mouse/keys 已在 state.js）。為降風險：**先把 `CAM` 暫放 `state.js` 解環、立刻抽出 sim.js**；intent adapter **延後成獨立步驟 3.5**（headless 純化）再專心做。
3. **三份 HTML 共享**：✅ `index` / `camera-sandbox` / `training` 都改 `<script type="module" src="main.js">`；CAM 滑桿、測試面板做成各自的 add-on 模組。**消滅「改一次 replay 到三檔」的手動同步**（`training.html` 已用 `window.__game`，接縫現成；需另外 expose `CAM` + 少量 hook）。
4. **死碼**：✅ 已查證 —— 舊版 2D top-down 渲染器**無人呼叫**（證據與清單見 §8），**開工前先刪**，不把死重量搬進模組。
5. **狀態存取介面**：✅ **`state.js` 匯出 `game`（+ `keys`/`mouse`），各模組 live-binding `import`**，不走參數注入。理由：單機只有一個 game 實例;`game` 已驗證只原地 mutate、從不重新賦值，import 綁定永遠指向最新狀態;render 函式零簽名改動。連帶：**新增步驟 1.5（先抽 `state.js`）**作為 render 的前置（render3D 讀 game、updateMouseWorld 寫 mouse，無法在它們還內聯時被抽出）。BR 不受擋：伺服器端若要多實例，`sim.js` 函式可改吃 state 參數，客戶端維持單例。

> 本文件是拆分的單一依據。邊界一旦動工，請更新 §0 狀態與各模組的「已抽出 ✅」標記。

---

## 8. 死碼清單（已查證無人呼叫 → 步驟 0 先刪）

`draw()` 的真實呼叫鏈：`render3D()`（3D 世界，內含 `syncWalls/syncProps/syncActors/syncProjectiles/syncZones`）→ HUD 疊圖 `drawEnemyBars / drawCrateHints / drawFloatingTexts / drawReticle / drawUi / drawFusionBanner / drawBossPhaseBanner` + 選單。角色是**真 3D 體素 mesh**（`buildEnemy`/`buildPlayer`）。

以下為 3D 化之前遺留的 2D top-down 渲染器，**引用次數 = 1（只有定義）或只被彼此呼叫**，現役路徑完全不碰：

| 函式 | 引用次數 | 說明 |
|---|---|---|
| `drawActors` | 1 | 根死碼（只有定義，無人呼叫）|
| `drawMap` | 1 | 死（2D 地圖繪製，已被 `drawGroundTexture`/3D 取代）|
| `drawZones`（2D）| 1 | 死（現役是 3D `syncZones`）|
| `drawProjectiles`（2D）| 1 | 死（現役是 3D `syncProjectiles`）|
| `drawEnemySprite` / `drawPlayerSprite` | 2 | 只被死的 `drawActors` 呼叫 |
| `drawActorBar` / `actorHeight` | 3 / 2 | 只被上面那群死碼呼叫 |

- **注意**：這些函式與現役函式**交錯排列**，要逐函式刪、不是整塊砍。
- **連帶確認**：`onGround`（引用 9）、`TH` 常數、`VIEW.depth` 等共用 helper —— 刪完上面那群後重新確認是否變死碼，一併處理。
- 刪除後 `hud.js` 的範圍會乾淨很多（只剩 bars / floating-text / reticle / ui / 選單 / banner）。
