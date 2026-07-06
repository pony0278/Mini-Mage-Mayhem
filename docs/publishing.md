# 投稿網頁平台(CrazyGames / Poki)+ 防扒策略

主線 v2 的目標是**純網頁平台**(CrazyGames / Poki 這類廣告分潤 + 手機流量的入口)。
技術棧選型與「怕代碼被整包帶走」的防禦,結論記在這裡。

## 為什麼留 JS,不轉 Godot/WASM

瀏覽器遊戲幾乎 100% 是 JS——瀏覽器只認 JavaScript。針對這兩個平台,Godot→WASM
是**淨負分**:引擎光 WASM 就數十 MB(首載慢、跳出率高)、多執行緒要 COOP/COEP
header(平台 iframe 內嵌常卡)、手機 web 是 Godot 弱項(而 Poki 一半是手機)。
我們現在的 vanilla JS + Three.js(零 build)恰好是平台最愛的形態。

Godot 的價值在**原生多平台**(Steam/手機 App),不在 web。只有「確定也要上原生」
才值得考慮,而且那會報廢整條 JS 內容管線(punch-studio/extractor/clip 格式)。
純網頁優先 → 留 JS。多人主線(`sim.js` 保持 headless)未來也走 Node 權威伺服器,
比 Godot 雙棧更輕。

## 威脅模型:分清兩種「被抄」

| 威脅 | 可防性 | 對策 |
|---|---|---|
| **A. 整包扒走 re-host 賺廣告**(真威脅) | **高** | 平台 SDK 網域鎖(盜站吃不到廣告分潤)+ 平台 DMCA 下架 |
| **B. 讀碼抄機制** | 幾乎不用擔心 | 玩法光玩就抄得走,藏碼擋不住;混淆只擋「懶得動腦的 rip-and-reskin」 |

⚠️ **別自己寫「只准我的網域跑」的硬鎖**:CrazyGames/Poki 是把你的檔案下載到
**它們自己的 CDN** host,硬鎖會連平台上的正版一起打死。網域驗證交給平台 SDK 做。

## 發佈流程(不動開發)

投稿是「打包一份 build 上傳給平台」,不是連我們的 Vercel。所以混淆版是**獨立產物**:

- **開發照舊**:`js/` 原始 ES modules、直接改、hard-refresh,零 build。
- **投稿時**:`cd build && npm run build` → 產 `dist/`(bundle + 混淆),那份才上傳。

工具與邊界見 [`build/README.md`](../build/README.md)。天花板:混淆擋自動化 rip,
不擋鐵了心的逆向;配平台網域鎖 = 逆向成功也變不出錢,防禦到此成立。

## 待辦(投稿前)

- [ ] 決定投 **CrazyGames** 還是 **Poki**(兩家 SDK 不同)→ 整合對應 SDK(廣告/網域鎖/分潤)
- [ ] 標題畫面 / 新手教學 / 觸控操作(手機流量)
- [ ] 用 `dist/` 本地實測一輪完整對局再上傳
