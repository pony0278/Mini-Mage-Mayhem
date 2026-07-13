# v2 headless 回歸套件

`js/` 遊戲本體維持**零 build/test/lint**;真正要「看到」行為對不對,靠這裡的 puppeteer + SwiftShader
headless 套件驗收。測試依賴(puppeteer)隔離在本資料夾(比照 `build/`,repo 內唯一另一個 npm 角落),
`tests/node_modules` 已 gitignore。

## 跑

```bash
cd tests
npm i            # 裝 puppeteer + 下載 chromium 到 ~/.cache/puppeteer(僅第一次)
npm test         # = node run-all.mjs:自動起 server → 逐套件跑 → 匯總
```

單跑一支(debug 時)——**server 一定從 repo root 起**:

```bash
python3 -m http.server 8099      # 在 repo 根目錄(不是 tests/!)
cd tests && node bottles.mjs     # 各套件自帶 pass/fail 斷言 + process.exit(fail?1:0)
```

## 套件對照(對應各系統;新系統落地時 `run-all.mjs` 的 SUITES 加一行)

| 套件 | 蓋的系統 |
|---|---|
| `bottles.mjs`   | 投擲瓶=場上物件:撿丟(桶瓶共用管線)、落地/撞牆/撞人/拳打/爆炸波及碎裂、風吹擊飛落地碎、走動頂開 |
| `wind.mjs`      | 風壓手套:排程施法、距離/角度衰減、近中心翻滾 vs 邊緣吹歪、反彈飛行瓶、吹桶升壓、穿防、無自反噬 |
| `oilfire.mjs`   | 油瓶=油膜不凍人;噴火帽=短扇形**不留地形火**(只點油)、著火 DoT 續燒、油+火 R1 火海、起手預告扇形 |
| `pickup.mjs`    | 手動撿道具(C 案):不自動撿、被暈掉地上帶剩餘次數、地上可搶、傳送(逃脫類)不掉、TTL 消失 |
| `ice_slide.mjs` | 冰面鎖滑:帶動量直線滑、撞牆停+暈、滑進艙=收容、靜止站上=小心走 |
| `mobilefx.mjs`  | 手機自動降級:觸控+行動 UA → FX_LOW 自動開(點光剝除/無 transmission)+ dpr 夾 1.5;桌機完整;`?fx=full` 覆蓋 |
| `onboard.mjs`   | 上手開場框架(只驗易讀層):首局教學旗標(localStorage)、AI 同事開場即開(demo 取代不會動假人)、開場字幕/鏡頭帶場計時、就位期 AI 靜止、首局打完記 localStorage |
| `perform.mjs`   | 回收口演出(憲章 v1.1):中途進艙=捕捉演出(罩/釘艙心/不得分)、拒收吐回北管道+落地保護+比賽繼續、演出中不二次捕捉、讀法 B(鐘響時輸家在艙→轉 perform #3 封艙壓縮→matchOver+報告) |
| `charter.mjs`   | 核心憲章 v1.1(分類競速=唯一勝利):12 元素序列/四型供料/元素系統休眠、分對=前進+充能+計分、分錯=拒收彈回輕罰、進度獨立(§6.1)、完成組=下班進度+能量 bonus、免費拳=踉蹌不暈+被打方充能、能量滿第三拳=擊暈+清條、中途進艙=吐回不結束、3 組=下班獲勝、限時歸零=完成多者勝、AI 讀自己序列 |

## Headless 陷阱(踩過的;寫新套件先讀,`js/CLAUDE.md` §測試 有完整版)

0. **收容=2.1~3.6s 演出(V0.8 起)**:任何 case 讓「暈眩/高速/拋飛」角色出現在 POD 半徑內都會開演出——敗方被**釘在艙心到演出結束**(位置每幀覆蓋、invuln 99),污染後續 case(wind ⑧ 事故:②的牆暈殘留+瞬移進艙)。**部署角色前清 stunned/frozen、座標避開 (480,320)±46**;真要測收容,等 `!state().perform` 再繼續。
1. **rAF 節流**:headless 下 `requestAnimationFrame` 只走實時的 4~36%。等時間**一律輪詢 `__v2.game.time`**,
   別用 `setTimeout` 當遊戲時鐘;引信/冷卻類邏輯**直接呼叫**(如 `__v2.explodeBarrel(b)`)別等它自然到。
   套件裡的 `advance(sec)` helper 就是 game.time 輪詢。
2. **本機玩家 `fighters[0]` 的 facing 每幀吃滑鼠重算**(桌機瞄準)→ 施放者測試**一律用 `fighters[1]`**,
   或每 tick 重新釘 facing。
3. **POD 在 (480,320) r46**:凍住/高速的角色進艙半徑=捕捉(拒收吐回演出 ~2.5s,受害者被釘艙心+受保護)
   →污染測試。測冰凍/擊飛時把角色擺**南邊空地**(如 y=540)避開。**反過來要測「滑進艙=捕捉」**:冰帶必須 `stampElement` **蓋過艙心**
   (非只到艙邊)——鎖滑貫穿入艙才在艙半徑內仍 >`slideContainCur` 門檻;停在艙前=洩速到門檻下=永不收容,
   `waitFor` 空轉到 game-time 逾時→在單一長 `page.evaluate` 內會爆 puppeteer protocolTimeout(整支掛死)。
4. **hitstop 0.12s** 會凍住 per-fighter step 迴圈 → `advance` 要給足(≥0.3s)跨過。
5. **server 從 repo root 起**:套件用 `import('./js/v2-floor.js')` 由瀏覽器對 server 根解析,從 `tests/` 起會 404。
6. **狀態污染**:上一個 case 留下的升壓桶引信到點會爆、`stampElement` 留的地板會殘留 → 新 case 先 `resetFloor()` /
   關掉別的桶 / 把無關角色挪遠(`x=60,y=60`)。

7. **元素系統休眠(憲章 §15)**:桶/補給座/拉桿預設不生成——吃它們的套件(detonate/switches/pickup/wind/bottles)
   URL 要帶 **`?props=full`**。charter.mjs 反而驗「休眠生效」,別給它加旗。
8. **AI 同事預設開**:會搶瓶/搬瓶——出拳/搬運類 case 開頭把 `fighters[1].ai=false` 並清掉
   `carryObj/carrying`(扛著東西不能出拳,punch 會靜默 no-op)。

## Debug hooks(頁內 `window.*`)

`__v2`(game/fighters/barrels/bottles/stations/castX/punch/…)、`__lab`(labGroup/floorFx)、`__avatars`、`__hands`、`__touch`。
