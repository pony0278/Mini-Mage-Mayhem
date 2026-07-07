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
