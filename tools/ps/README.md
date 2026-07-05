# tools/ps/ — punch-studio 的拆檔模組

`punch-studio.html` 原本是 3800 行單檔;JS 主體依原始行序**純剪貼**拆到這裡
(古典 `<script src>`,**不是** ES modules)。所有檔案共享同一個全域作用域,
串接起來 = 原本的單一 `<script>`,語意零變化。

## 載入順序(= 相依順序,由 punch-studio.html 決定)

1. `pose-data.js` — 姿勢資料模型:POSE_KEYS 47 軸、presets、時間軸(SEQ)模型、滑桿定義
2. `rig.js` — Three.js 場景、DIM 角色比例、狀態存檔(undo/autosave/JSON IO)、素體建構、applyPose/lerp
3. `hitfeel.js` — 打擊感試打台 + 主渲染迴圈 `tick()`
4. `editor-ui.js` — 滑桿/時間軸/phase tabs UI、按鍵綁定、白模/鏡像、contact sheet、匯出匯入
5. `ref-solve.js` — 參考疊圖、關節對位 SOLVER(單視角/multi-view/AI 偵測)、scrub、FK 拖動
6. `parts.js` — 部位掛載系統(sockets.json→slot、GLB 掛載、預設人偶自動載入)
7. `game-bridge.js` — `window.__ps` 健檢 hook + 遊戲整合面板(招式庫/遊戲視角/impact 讀出)

SOCKETS_JSON(接縫規格)與 MediaPipe AI 偵測的 module script 仍留在 HTML 裡。

## ⚠ 唯一要遵守的規則(hoisting 是「每檔」為單位)

**頂層(載入期)執行的程式,只能呼叫「更早載入的檔案」定義的函式/變數。**
單檔時代靠 hoisting 可以前向呼叫,拆檔後跨檔前向呼叫會 ReferenceError。
事件回呼、RAF、setInterval、使用者操作觸發的函式不受限(執行時全部檔案都已載入);
真的需要載入期前向引用時,照 `rebuildCharacter()` 的寫法用
`if (typeof fn === 'function') fn()` 守衛。

改完跑 headless 回歸(13 部位自動掛載+套姿勢,`window.__ps`),
方法見 `docs/animation-workflow.md` §7。
