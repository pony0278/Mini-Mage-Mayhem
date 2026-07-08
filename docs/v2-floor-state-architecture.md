# v2 地板狀態機 — 架構與實作指引

> 狀態:**架構定案、尚未實作**。這是 [v2-element-floor-chemistry.md](v2-element-floor-chemistry.md)(設計)的**工程落地藍圖**。
> 一句話:新開 `js/v2-floor.js`(守 v2 DAG,不碰 sim.js),地板化學狀態放 **v2 私有一層**,
> 所有元素注入走**單一 `applyElement` choke point**。

---

## 0. 定案(2026-07 討論)

| 決定 | 選擇 | 理由 |
|---|---|---|
| 放哪 | **② 新開 `js/v2-floor.js`,鏡射既有模式(不抄 sim.js 的碼)** | 守 `v2-module-boundaries.md`「v2 never touches the single-player DAG」;隔離、headless 可測 |
| 狀態存哪 | **(2b) v2 私有一層 `v2s.floor`**;`game.map` 只管靜態結構(牆/虛空/地板) | v2 用 `render-lab` 自烤地板、不吃 render-world tile 貼圖 → 2a「複用貼圖」好處對 v2 不存在;不動共用 `constants.js`;靜態結構 vs 動態化學乾淨分離;好 headless dump |

---

## 1. 現況(程式碼事實,實作前先懂)

- **v2 地板現在是靜態的**:`v2-terrain.js buildFlatArena()` 鋪全 `TILE_FLOOR` + 四邊牆,沒用 tile 變化、沒有反應。
- **單機 `sim.js`(3416 行)有反應原語但鎖死**:油爆/燒草/融冰耦合 `game.oils`/`game.fireZones`/`addExplosion`/`game.stats`(升級)/boss。**不能直接呼叫**(會拖單機 DAG 進 v2)。
- **要鏡射的既有模式(看,別抄)**:`game.oils`/`game.walls` = 「計時 tile 覆蓋清單」,每格 `{tx,ty,prev,life,maxLife}`;`updateOil(dt)`(`sim.js:2532`)每幀遞減 `life`、檢查反應、到期 revert 回 `prev`。
  **這個 ttl+衰退+revert 正是地板狀態機要的**;而「一格一狀態」= 每格單值、不疊層 → 完美吻合。
- **可參考的讀地板點**:單機 `onIce`(`sim.js:1810`)= `tileAtPixel(p.x,p.y)===TILE_ICE` 改移動手感。v2 的「踩冰滑/踩電水硬直/站火裡 tick」比照這種讀法。

---

## 2. 模組:`js/v2-floor.js`

DAG 位置:`constants`/`utils` → `state` → **`v2-state`** → **`v2-floor`** → `v2-combat`/`v2-items`/`v2.js`。
**import 只准**:`constants`、`utils`、`state`(game)、`v2-state`(v2s + 常數)。**禁止** import `sim.js`、render、input。

### 2.1 狀態模型(v2 私有層)

```js
// 狀態集(§3 設計):字串或小 int 皆可。用字串較好讀、好 debug。
export const FL = { CLEAN:'clean', OIL:'oil', WATER:'water', ICE:'ice',
                    POISON:'poison', FIRE:'fire', CHARGED:'charged_water' };

// v2s.floor:ROWS×COLS,每格一個 cell。cell 只在非 clean 時才配物件(省記憶體/GC)。
// cell = { st, ttl, max, warn }  // 狀態 / 剩餘壽命 / 初始壽命(算閃爍用) / 是否進入預警
// charged_water 特例:電荷是疊在 water 上的暫態 → cell 另存 waterTtl(水的底料時鐘,充電不刷新它)
```

**「充電不刷新水時鐘」鐵則(§3.1)的實作**:`charged` cell 帶兩個計時器——
`ttl`=電荷 4s(到期 → 退回 `water`,並把 `ttl` 設回 `waterTtl` 的**剩餘值**),`waterTtl`=水的 10s(**充電時不重置**)。

### 2.2 反應表 `FLOOR_RX`(正交,加反應=加一列)

```js
// (現狀態, 注入元素) → { next, event? }
//   next:  轉場後的新狀態(FL.*)
//   event: 一次性事件(如 'poison_burst');無則純轉狀態
// 查不到的配對 → 走 substrate 取代 / no-op(見 applyElement)
export const FLOOR_RX = {
  // R1 火燃油/草 → 火海(沿油擴散在 stepFloor 做)
  [`${FL.OIL}|fire`]:      { next: FL.FIRE },
  // R2 雷+水 → 電水
  [`${FL.WATER}|lightning`]:{ next: FL.CHARGED },
  // R3 火↔毒 → 毒爆 + 清空
  [`${FL.POISON}|fire`]:   { next: FL.CLEAN, event: 'poison_burst' },
  [`${FL.FIRE}|poison`]:   { next: FL.CLEAN, event: 'poison_burst' },
  // R4 冰+火 → 熄成水
  [`${FL.FIRE}|ice`]:      { next: FL.WATER },
  // R5 冰+油/水 → 冰面
  [`${FL.OIL}|ice`]:       { next: FL.ICE },
  [`${FL.WATER}|ice`]:     { next: FL.ICE },
  // R6 風 = 不改地板(在 v2-combat 推人/吹雲,不進本表)
};
// 底料(可當新 substrate 覆蓋舊的):oil/water/ice/poison 落在 clean 或互相取代。
const SUBSTRATE = new Set([FL.OIL, FL.WATER, FL.ICE, FL.POISON]);
```

起始壽命(§3.1,常數放 v2-state 好調):`oil/water ~10s`、`poison/ice ~8s`、`fire/charged ~4s`。

### 2.3 單一注入入口 `applyElement`(道具 + 元素站都走這裡)

```js
export function applyElement(tx, ty, element, opts) {
  if (!walkable(tx, ty)) return;            // 只在地板格(game.map 非牆/虛空)
  const cur = stateAt(tx, ty);              // clean 若無 cell
  const rx = FLOOR_RX[`${cur}|${element}`];
  if (rx) { setState(tx, ty, rx.next); if (rx.event) fireEvent(rx.event, tx, ty); return; }
  // 無招牌反應:底料元素 → 取代;否則 no-op
  const asSub = ELEM_TO_STATE[element];     // fire→FIRE, oil→OIL, water→WATER, ice→ICE, poison→POISON
  if (asSub && SUBSTRATE.has(asSub)) setState(tx, ty, asSub);
  // lightning 打乾地、風 → no-op(風在 combat 處理)
}
```

> **choke point 的價值**:道具命中(§`resolveItemCast`→routes here)和元素站噴發(一次 `applyElement` 一片)**共用同一條反應邏輯**,永遠一致、只有一處要維護、一個地方測。

### 2.4 每幀 `stepFloor(dt)`

```js
export function stepFloor(dt) {
  // 1) 火沿油滾動:每個 FIRE cell,把相鄰 OIL cell 點燃(applyElement(nx,ny,'fire'))
  //    → 火像波浪滾過油田(§3.1)。用「本幀點燃清單」避免同幀連鎖爆走。
  // 2) 衰退:每個非 clean cell,ttl -= dt;進入最後 ~1s → warn=true(渲染閃爍)
  //    ttl<=0:CHARGED → 退回 WATER(ttl=waterTtl 剩餘);其餘 → CLEAN
  // 3) charged 另跑 waterTtl -= dt(充電不重置它);waterTtl<=0 → 整格 CLEAN
}
```

在 `v2.js step()` 呼叫,**接在道具 impact 派發之後**(`resolveItemCast` 已注入元素),移動之前(讓滑/硬直讀到最新狀態)。

### 2.5 一次性事件 `poison_burst`

不是狀態,是轉場時放一次的 AoE(§2 R3):對範圍內 fighter 觸發 combat 的擊飛/傷害,清空該格。實作時呼叫 v2-combat 暴露的一支 `burstAt(x,y,r)`(或發個 `v2s` 佇列讓 combat 消化,避免 floor→combat 反向依賴)。

---

## 3. 接線(改動點清單)

| 檔案 | 改動 | 量 |
|---|---|---|
| `js/v2-floor.js`(新) | 狀態模型 + `FLOOR_RX` + `applyElement` + `stepFloor` + 事件 | ~150–200 行,純 sim |
| `js/v2-state.js` | `v2s.floor` 格 + `resetFighter`/reset 清空 + 壽命常數 | 小 |
| `js/v2.js` | `step()` 呼叫 `stepFloor(dt)`(道具 impact 之後) | 幾行 |
| `js/v2-items.js` | `castItem`/`resolveItemCast` 的 wind/ice/…→ 改呼 `applyElement`(取代目前直接 castX) | 小 |
| `js/v2-combat.js` | 讀地板點:踩 ICE→滑、踩 CHARGED→硬直、站 FIRE→tick;暴露 `burstAt` | ~30–50 行 |
| `js/render-lab.js` | **動態 tile 危險渲染**(出現/衰退/閃爍) | **中(可先粗色塊)** |

---

## 4. 維護性風險(實作時盯著)

1. **絕不 reach 進 sim.js**。~6 反應在 v2 重寫(原語簡單)。這是**為守邊界刻意重複**——文件已接受(v2 有自己的 combat/terrain)。反例:`import {...} from './sim.js'` = 破 DAG,禁止。
2. **render-lab 動態 tile 是最大的非 sim 工**。現在 render-lab 烤**靜態**地板;化學狀態會出現→衰退→閃爍。單機 `render-entities` 只有**圓 zone**(`game.fireZones`)不是格子 → v2 要自寫 tile-grid 覆蓋渲染。**邏輯便宜、視覺才是 lift**;先粗色塊 MVP、之後打磨(先簡後美,一貫)。
3. **floor ↔ combat 不可循環依賴**。`v2-floor` 不 import `v2-combat`(DAG 是 floor→combat)。毒爆等要 combat 出力的事件,用 **v2s 佇列**(floor push、combat step 消化)或 combat 傳 callback 進來,別反向 import。
4. **step 順序**:`stepFloor` 要在道具 impact 派發**之後**(元素已注入)、fighter 移動判定**之前**(滑/硬直讀到最新格)。

---

## 5. 落地切法(先邏輯、後渲染;不擋建模)

1. **第一刀 · 純 sim 邏輯層**(現可做,不需美術):`v2-floor.js`(狀態+RX+applyElement+stepFloor)+ `v2s.floor` + `__v2`/`__lab` hook dump 一個 headless 測(注入 oil→fire 驗火海滾動、water→lightning 驗電水→衰退退水、poison+fire 驗毒爆清空、冰+油驗冰面)。**行為全在資料層可驗,render 還沒接也能證明對。**
2. **第二刀 · combat 讀地板**:滑/硬直/火 tick + `burstAt`。接上「踩上去有反應」。
3. **第三刀 · 道具/元素站接入**:`resolveItemCast`→`applyElement`;元素站噴發一片 `applyElement`。此時**油+火+風**最小連段能在 sim 層跑通。
4. **第四刀 · render-lab 動態 tile**:先粗色塊(fire 橘/ice 白/poison 紫/charged 藍白/oil 深),衰退淡出 + 最後 1s 閃爍。之後換精緻粒子/符文。

> 第 1 刀完成 = 地基打好,你可同步在 punch-studio 建模(§9.2 第一批 油/火/風),互不擋。

---

*配套:[v2-element-floor-chemistry.md](v2-element-floor-chemistry.md)(設計:狀態機/反應/壽命/元素道具)、*
*[v2-module-boundaries.md](v2-module-boundaries.md)(v2 DAG 與不變式)、*
*[v2-item-cast-system.md](v2-item-cast-system.md)(道具施放骨架 → `applyElement` 的呼叫端)。*
