# render.js 模組邊界定義書（渲染層拆分）

> 目的：`js/render.js`（1680 行）是單機＋v2 共用的渲染層，混了 3D 核心/場地/角色/特效/2D HUD
> 五種職責。進入美術打磨期前拆分。方法論同 [v2-module-boundaries.md](v2-module-boundaries.md)：
> 分析 → 報告 → 拆分（行為零改變）。

## 1. 拆分前現況（符號級跨區依賴分析）

| 區段 | 行數範圍 | 內容 |
|---|---|---|
| 核心 | ~17-108, 1043-1055 | renderer/scene/camera/燈光/幾何與材質快取/`project`/滑鼠 raycast |
| 場地 | ~110-528 | 地板烘焙/富材質/浮島+吊橋/海/牆體/穿牆淡出/裝飾 |
| 角色 | ~529-791 | 單機巫師 + 敵人體素(slime/bug/imp/charger/boss/brawler) + 程序動畫 |
| 實體特效 | ~792-1041 | 箱子/投射物/地面法陣/爆炸/粒子/地面標記 |
| render3D | ~1057-1080 | 每幀編排 + 攝影機定位/震屏/鏡頭踹 |
| 2D HUD(單機) | ~1082-1680 | `draw()` + 血條/準星/橫幅/升級卡/標題/結算/觸控 |

**風險（相對 v2 拆分）**：這層被兩個遊戲共用——單機（index.html/main.js）與 v2 全家；
分析發現的跨區誤報（`rim`/`disc`/`canvas` 區域變數同名）已逐一人工確認。

## 2. 目標模組（門面模式：`render.js` 保留為門面，**所有引用方 import 零改動**）

| 模組 | 內容 | 匯入 |
|---|---|---|
| `render-core.js` | renderer/`gl3dOk`/scene/camera/燈光、`ART` 調色盤、幾何+材質快取（`makeBox`/`matLambert`/`colorHex`…）、`project`/`mouseScreen`/`updateMouseWorld`、共用顯示旗標（`actorShadow`/`vividFx`/`groundMarkers`＋setter）；**`VIEW_W/VIEW_H` 視圖尺寸**（由 HTML 殼的 canvas 屬性決定，與世界尺寸 W/H 解耦：v2=960×540 (16:9)、單機=960×640） | constants, utils, state |
| `render-world.js` | 地板紋理烘焙（含富材質）、格子浮島+海、自由浮島+吊橋、牆體+穿牆淡出、裝飾；`islandMode`/`freeIslands`（export let，唯一寫入點在本檔） | core, constants, state |
| `render-actors.js` | 巫師+全部敵人體素建模、`updateActor` 程序動畫、`syncActors`/`refreshActors`；brawler 委派給 `actor-brawler.js` | core, world(freeIslands), state, data, sim(dashElement), actor-brawler |
| `actor-brawler.js` | v2 小人專屬：`BRAWLER_SPEC` 建模規格表＋`ANIM` 動作參數表＋組裝/姿勢狀態機——**改模型/動作＝改表** | core, state |
| `render-entities.js` | 箱子/投射物/法陣/爆炸環/粒子/地面標記的每幀重建（`syncProps`/`syncProjectiles`/`syncZones`） | core, state, utils |
| `render-hud.js` | 單機 2D HUD 全部（`draw()`/`drawPanicFaces`/標題/升級/結算/觸控）；持有 hud ctx | core, render.js(render3D), sim/data/strings/touch |
| `render-lab.js` | **v2 實驗室場景**（復刻 arcane containment 原型）：ACES/sRGB/陰影管線 profile、emissive 雙貼圖地板、魔法陣、力場邊界（發光矮緣+角落光球+能量管；高牆已拆，無穿牆淡出）、`LAB_LAYOUT` 帶區裝飾編排表（改佈局=改表）、魔塵；`FX_LOW`（?fx=low）關陰影/裝飾點光/transmission；`setLabFlicker`（減閃爍：凍結脈動光時鐘） | core, state |
| `render.js`（門面） | `render3D()` 每幀編排＋攝影機定位＋`camFollow`；**re-export 全部公開 API**（project/draw/set* 等） | 以上全部 |

### DAG（無環；hud→render.js 的 `render3D` 引用是函式呼叫期解析，ESM 安全）

```
constants/utils/state/data/sim ─┐
render-core ──→ render-world    │
    │      └──→ render-actors ←─┘(sim: dashElement)
    └─────────→ render-entities
render.js(門面) ← core/world/actors/entities/hud;re-export 公開 API
render-hud ←──── core + render.js(render3D)
```

## 3. 公開 API（拆分後由門面 re-export,引用方零改動）

`main.js`: draw, updateMouseWorld, mouseScreen ｜ `camera-panel.js`: setCamFollow ｜
`v2-hud.js`: project ｜ `v2-tuning.js`: setFloorParams, getFloorParams, refreshActors ｜
`v2.js`: render3D, drawPanicFaces, setIslandMode, setIslandShapes, setWallFade, setFloorParams,
setActorShadow, setVividFx, setGroundMarkers, setRichFloor, updateMouseWorld, mouseScreen

## 4. 不變式

1. **門面不變**：外部永遠只 `from './render.js'` import；子模組是內部實作，外部不得直接引用（v2/單機皆然）。
2. **共用顯示旗標只住 core**（actorShadow/vividFx/groundMarkers）；`islandMode`/`freeIslands` 只在 world 內寫入。
3. 渲染子模組**不 import v2-\***（渲染層服務兩個遊戲,不知道 v2 的存在;v2 專屬視覺一律走旗標/參數）。
4. `sim → render` 方向禁止不變（sim 保持 headless）。

## 5. 驗證協定

拆分用 Python 切片腳本搬運原始碼（保字節、不重打字），僅新增 import/export 標頭。每步：
- 靜態：全模組 `node --check`＋識別字掃描（每個使用的識別字必須是本地宣告/已 import/JS 全域）。
- **雙遊戲** headless 冒煙：v2（開機/戰鬥/收容/報告）＋單機（標題→開局→移動射擊數秒,無 pageerror）。

## 6. 之後的擴充落點

- **人物建模/動作**：v2 小人＝`actor-brawler.js`（`BRAWLER_SPEC` 比例表 + `ANIM` 動作參數表,改模型=改數據）；單機巫師/其他敵人＝`render-actors.js`。
- **場地視覺**：v2 實驗室＝`render-lab.js`（佈置改 `LAB_LAYOUT` 表）；單機/浮島＝`render-world.js`。
- **新特效**：`render-entities.js`。
- **單機 HUD/選單**：`render-hud.js`。
