# tools/ps/ — punch-studio 的拆檔模組

`punch-studio.html` 原本是 3800 行單檔;JS 主體依原始行序**純剪貼**拆到這裡
(古典 `<script src>`,**不是** ES modules)。所有檔案共享同一個全域作用域,
串接起來 = 原本的單一 `<script>`,語意零變化。

## 載入順序(= 相依順序,由 punch-studio.html 決定)

0. `sockets-data.js` — 接縫規格快照(`SOCKETS_JSON_RAW` 全域;sockets.json v0.5.5)。純資料、無相依,故最先載;`parts.js` 同步讀取
1. `pose-data.js` — 姿勢資料模型:POSE_KEYS 51 軸、presets、時間軸(SEQ)模型、滑桿定義
2. `rig.js` — Three.js 場景、DIM 角色比例、狀態存檔(undo/autosave/JSON IO)、素體建構、applyPose/lerp
3. `hitfeel.js` — 打擊感試打台 + 主渲染迴圈 `tick()`
4. `editor-ui.js` — 滑桿/時間軸/phase tabs UI、按鍵綁定、白模/鏡像、contact sheet、匯出匯入
5. `ref-solve.js` — 參考疊圖、關節對位 SOLVER(單視角/multi-view/AI 偵測)、scrub、FK 拖動
6. `parts.js` — 部位掛載系統(sockets.json→slot、GLB 掛載)
7. `avatar.js` — 基底角色(rigged avatar)模式:16 骨角色 GLB 世界差量重定向 + 開機自動載入調度(角色優先→Meshy 部位人偶退路)
8. `game-bridge.js` — `window.__ps` 健檢 hook + 遊戲整合面板(招式庫/遊戲視角/impact 讀出)

接縫規格已抽成 `sockets-data.js`(古典 script,`SOCKETS_JSON_RAW` 全域,同步載入=保留 file:// 直開);
MediaPipe AI 偵測的 module script 仍留在 HTML 裡。

## ⚠ 唯一要遵守的規則(hoisting 是「每檔」為單位)

**頂層(載入期)執行的程式,只能呼叫「更早載入的檔案」定義的函式/變數。**
單檔時代靠 hoisting 可以前向呼叫,拆檔後跨檔前向呼叫會 ReferenceError。
事件回呼、RAF、setInterval、使用者操作觸發的函式不受限(執行時全部檔案都已載入);
真的需要載入期前向引用時,照 `rebuildCharacter()` 的寫法用
`if (typeof fn === 'function') fn()` 守衛。

改完跑 headless 回歸(13 部位自動掛載+套姿勢,`window.__ps`),
方法見 `docs/animation-workflow.md` §7。

## 型別檢查(零建構,逐檔 opt-in)

`jsconfig.json` 開了型別檢查基礎設定,但 **`checkJs:false`**——**逐檔用檔頭 `// @ts-check`
才會被檢查**,一次只收一個檔案的型別債、不被既有碼淹沒。型別=純 JSDoc 註解,
**不編譯、程式碼照跑**(維護性,非建構步驟)。目前已標:`pose-data.js`(Pose/Phases/
TimelineKey/Snapshot 等資料形狀 typedef;VS Code / `tsc -p tools/ps/jsconfig.json` 即檢查)。
新標一個檔:檔頭加 `// @ts-check`,把 `tsc` 跑到零錯即可(型別債限縮在該檔)。

## ESM 轉換評估(已量化 + 實測 → 暫緩;未來重啟看這節即可)

把 ps/ 從「古典共享全域」轉成真正的 ES modules(顯式 import/export)——**評估過、動手實測過,決定暫緩**。
結論記在這,未來要重啟不用重推分析。

**量化(acorn + eslint-scope,精確)**
- 頂層宣告 351 個、需 export 114 個、跨檔相依 33 邊。**零撞名**(轉 export 不用改任何名字)。
- 樞紐:`rig.js`(最多人依賴)、`pose-data.js`。乾淨葉:`sockets-data`/`pose-data`(import 0);`game-bridge` 是純 sink(export 0)。
- 真實檔案級**循環**:`{rig, editor-ui, ref-solve, parts, avatar, hitfeel}` 互相 import(rig 反向呼叫功能模組:`rig→editor-ui:buildTimelineUI`、`rig→parts:detach/reattach`、`rig→avatar:updateAvatarPose`)。

**機械部分可行**:全轉 export/import 後 `tsc` 完全通過(相依都解析、沒漏 export)。**但一到瀏覽器就在載入期崩**:
`ReferenceError: Cannot access 'root' before initialization`(parts.js 的 `setSyntheticDummyVisible` 讀 rig 的 `root`)。
- 主因:ESM 遇循環時 **rig 最後才求值**(所有人 import rig,DFS 先跑完整叢集才輪到 rig body),
  而各模組的 boot 副作用(建 UI／掛部位／建沙包 IIFE)**在載入期就執行**、去讀 rig 尚未初始化的 const → TDZ 崩。
- 且 boot 副作用**交錯在各檔各處**(rig 39 處、editor-ui 38、ref-solve 27),**不是乾淨檔尾**,不能簡單包起來。

**要完成 A 一定得補一層「init 排序」**:各模組 boot 副作用搬進 `initX()`,由 `boot.js` 依古典順序呼叫
(所有 body 求值完、rig `root` 就緒後才 boot)。這**不是** cycle 拆除/callback 反轉(耦合不動,rig 照樣 import editor-ui),
是 script→module 轉換的標準必要步驟——但要逐一手術 ~20 個交錯語句,漏一個 rig-touching 呼叫就再崩,需 2~3 輪 headless 驗證。

**為何暫緩(觸發條件)**:ESM 買的是「相依顯式 + 消 hoisting footgun + `@ts-check` 好鋪」的**結構衛生,不是正確性**
(循環已證明 runtime-safe、功能正常);而 init 重排的真風險是**時序回歸**(undo 後 UI 沒刷新／parts reattach 壞／solver 死),
剛好落在 `__ps` 煙霧測**抓不到**的盲區。所以最划算的時機是**下次 punch-studio 較大功能改版時一起做**——
那時本來就要碰這些檔、也該補行為回歸測試,init 排序的成本被攤掉、風險被回歸網接住。屆時:
1. 先跑分析腳本重生相依圖(acorn 抽頂層宣告 + eslint-scope 抽 free vars → import/export 計畫);
2. 各模組 boot 副作用抽進 `export function initX()`,`boot.js` 依 `sockets→pose-data→rig→hitfeel→editor-ui→ref-solve→parts→avatar→game-bridge` 呼叫;
3. THREE 是 CDN 全域,module 內直接參照即可(不用 import);HTML 改成單一 `<script type="module" src="ps/boot.js">`;
4. 補行為回歸(rebuild 角色／undo-redo→UI 刷新／parts detach-reattach 往返／avatar 套姿勢／solver／timeline 編輯／播放),再逐輪驗到全綠。
