# 模組邊界：index.html 拆分的依據

> 用途：把目前 ~4273 行的單檔 `index.html`（inline `<script>` IIFE）拆成多個 ES module 的**邊界定義書**。
> 目標：解決「太肥」維護性問題，同時把 **sim 核心抽成 headless**（= roadmap 的 B0，未來 BR / WASM 的地基），全程**零 build、仍是靜態頁**。
> 狀態：**分析完成、邊界提案、尚未動工**。行號為分析當下快照（會隨改動漂移，僅供定位）。

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

> 可選簡化：第一刀可先把 `render3d + hud` 合成單一 `render.js`，降低一次搬檔的面數；待穩定後再細分。

---

## 5. 拆分時要注意的坑（分析時就先標）

- **資料表裡藏行為**：`upgradePool[].apply`、`SECONDARY[].cast` 是 closure，會呼叫 sim 函式（`injectElement` / `buildWall` / `toast`）。→ **這些「帶行為的註冊表」留在 `sim.js`**；只有**純資料**（`ELEMENT_INFO` 顏色/名稱、`isXKind`、arena tile 樣板）進 `data.js`。
- **`project()`**：定義在行 84（基礎區）但用 `camera`、只被 render 呼叫 → 歸 **render3d**。
- **FX 是 producer/consumer**：sim 的 `addText/addRing/addSlam` 只 push 進 `game.floatingTexts/rings/slams`，render 再畫 → 乾淨接縫，**別動**。
- **render 可能有重複路徑**：同時存在 3D voxel mesh（`syncActors`/`buildEnemy`）**和** 2D sprite（`drawEnemySprite` 行 3616 / `drawPlayerSprite` 行 3757）。**拆分前先確認哪條是現役**，順手清掉死碼（這也是「太肥」的來源之一）。
- **ESM 不能跑 `file://`**：拆成 module 後，本地無頭測試要起 `python -m http.server`（部署到 GitHub Pages 是 HTTP，無影響）。三份檔（`index.html`/`camera-sandbox.html`/`training.html`）目前共用同一份遊戲 JS，拆分後要決定它們如何共享 module（見 §7）。

---

## 6. 建議的搬檔順序（漸進、每步可驗證）

1. **最安全先抽**：`constants.js` + `utils.js` + `data.js`（純資料/純函式，零行為依賴）。
2. **抽 render**：`render3d.js`（+ `hud.js`，或先合併成 `render.js`）。render 只讀 sim 狀態，搬完行為不變。
3. **抽 sim.js**：把 278–2650 整塊搬出；同時做 §3 的 `update(dt, intent)` 接縫，斷開 CAM/mouse。
4. **`input.js` + `main.js`**：輸入事件 → `intent`；`loop()` 接線。
5. 每步用無頭 Puppeteer（改走 `http.server`）截圖/讀狀態，確認**行為零變化**再進下一步。

---

## 7. 待拍板（動工前）

1. **模組邊界**是否如 §4？或第一刀先把 `render3d+hud` 合成 `render.js`？
2. **`update(dt, intent)` 接縫**和拆分一起做（建議），還是先純搬檔、之後再斷 CAM/mouse？
3. **三份 HTML 的共享**：`index.html` / `camera-sandbox.html`（CAM 滑桿）/ `training.html`（測試面板）目前各自內嵌同一份 JS。拆 module 後，建議三者都改成 `<script type="module" src="main.js">`，差異（滑桿/面板）做成各自的小掛載檔，**徹底消滅三份手動同步**（目前每次改動都要 replay 到三檔的痛點，拆分後自然消失）。
4. **死碼確認**：3D mesh 路徑 vs 2D sprite 路徑哪條現役（§5）。

> 本文件是拆分的單一依據。邊界一旦動工，請更新 §0 狀態與各模組的「已抽出 ✅」標記。
