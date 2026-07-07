# 手機觸控控制層(規劃;尚未實作)

v2 目前是**桌機/筆電**遊戲(WASD 鍵盤移動 + 滑鼠瞄準 + 滑鼠鍵/JKE/空白 動作)。
觸控裝置(手機/平板)現在**完全玩不了**(沒鍵盤/滑鼠)。這份是把 v2 手機化的規劃。
**目標:吃 CrazyGames/Poki 的手機流量。** 純新增輸入層,**不動模擬/玩法/多人**(sim 保持 headless)。

> 決策已定:**方向=橫向**;**瞄準=單搖桿「移動即面向」**(見下)。晚一點做,先做別的。

## 方向:橫向(landscape)
- 畫布 16:9、競技場寬、跟隨鏡頭寬幅 → 直向會裁掉半個場。
- 需要:①直向偵測 → 蓋「請轉橫」提示層;②對 portal 宣告 landscape(CrazyGames/Poki 的 manifest/SDK 有方向設定);③全螢幕下可 `screen.orientation.lock('landscape')`(不保證所有瀏覽器,故①的提示層是保底)。

## 瞄準:單搖桿「移動即面向」(已定案)
- 桌機是「移動(WASD)/瞄準(滑鼠)**解耦**」:本地玩家 `f.facing = atan2(mouse - f)`(`v2-combat.js` line 67)。
- 瞄準牽動:**揮拳方向、投擲方向**(投擲把對手丟進中央魔法陣=收容獲勝,是核心機制)、道具施放方向。
- 手機沒有第三隻手瞄準 → **facing 跟左搖桿方向**(就是 AI 現在的做法:面向移動方向)。
  1v1 繞打讀起來自然;**投擲瞄準 = 把搖桿推向魔法陣方向再按投擲**。
- 右拇指專心按鈕。

## 版面(橫向)
- **左下:虛擬搖桿** → 類比移動 + 面向(facing=搖桿角度)。
- **右下:按鈕群** → 揮拳(大顆,= `mouseLeft`:揮拳/扛人時拋擲)· 抓/放技能(= `mouseRight`)· 格擋(= `doGuard`)。道具可當第 4 顆或維持自動。
- 上方:沿用現有 HUD(血量/階段/報告)。

## 技術做法
- **偵測觸控**:`matchMedia('(pointer:coarse)')` / `'ontouchstart' in window` / `navigator.maxTouchPoints>0` → 只在觸控裝置顯示這層(桌機照舊鍵鼠,零影響)。
- **DOM overlay**(HTML/CSS 搖桿+按鈕)疊在 `#game` 畫布上,吃 pointer 事件(比在 canvas 做 hit-test 簡單、清晰、可 CSS 響應式)。
- **接線(小改,不動 sim 邏輯)**:
  - 移動:`v2-combat.js` 的 `moveFighter` 目前讀 `keys.has('w'..)`(line 31-32)。加一個**類比輸入向量**(來自搖桿),moveFighter 優先吃它、否則吃鍵盤。
  - 面向:local 玩家的 `facing` 改成「有觸控輸入 → 跟搖桿方向;否則 → 跟滑鼠」(line 67 分支)。
  - 按鈕:直接呼叫現有 `mouseLeft(f)` / `mouseRight(f)` / `doGuard(f)`(邊緣觸發,同 `pollContext`)。
- **方向提示層** + 響應式尺寸(用 `vmin`,適配各種螢幕)。

## 分階段(中大型功能)
- **A. 觸控偵測 + 橫向提示層**(直向蓋提示;偵測到觸控才顯示控制層)
- **B. 虛擬搖桿** → 類比移動向量 + facing(小改 moveFighter/facing 分支)
- **C. 動作按鈕**(揮拳/抓/格擋)→ 接 `mouseLeft`/`mouseRight`/`doGuard`
- **D. 投擲瞄準微調 + 響應式 + 實機試玩**(真手機或 DevTools device emulation)
每階段 headless 煙霧 + 真機/emulation 驗一輪。

## 動手時要再定的小決策
- 搖桿:**固定位置** vs **浮動**(拇指按哪冒哪)。浮動較舒服,固定較好教學。
- 按鈕數:道具當**第 4 顆** vs **自動施放**。
- 類比死區/靈敏度、按鈕大小(拇指可及區)。
- portal SDK 整合時,方向宣告 + 全螢幕請求放哪。

## 相關檔案(動手時會碰)
`js/v2.js`(輸入綁定/step)、`js/v2-combat.js`(moveFighter/facing line 31-32、67)、
`js/v2-hud.js`(HUD)、`v2.html`(overlay DOM + CSS)、可能新增 `js/v2-touch.js`(觸控層,比照 `v2-tuning.js` 的 opt-in 模組風格)。
