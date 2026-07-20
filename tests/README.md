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
| `onboard.mjs`   | 上手開場框架(只驗易讀層):首局教學旗標(localStorage)、AI 對手開場即開(fight 純戰鬥)、開場字幕/鏡頭帶場計時、就位期 AI 靜止、首局打完記 localStorage |
| `perform.mjs`   | 回收演出 V0.8:收容→演出啟動(即時計分/罩/釘艙心/受保護)、演出中不二次收容、收尾才彈回+升階、第 2 次失控風味、第 3 次壓縮→matchOver+報告 |
| `jump.mjs`      | 跳躍+下壓拳 brawl-2:跑=預設(雙擊退役)、空白跳/Shift防、空中免地板化學+鎖滑中起跳解鎖、下壓命中削45穿防/落空硬直、空中挨拳拍落、跳越艙口不觸發失控收容 |
| `dash.mjs`      | 衝刺攻擊 feel-1:持續跑 ≥ DASH_RUN_T 出拳=衝刺(kind4 不入連段)、短移動=普通拳、命中削30+推、可擋+擋下開反擊窗、起手前衝、對已暈者=挑飛、揮空冷卻;clip 槽位 dash_punch/hit_flinch/walk_cycle 缺槽安全 |
| `hitfx.mjs`     | 漫畫打擊爆花 hitfx-1:命中推 game.bursts(鉤=小橘/挑飛=size46+集中線+白閃/打暈=琥珀/反擊=金/下壓=紅)、壽命到移除、揮空無爆花 |
| `combo.mjs`     | 連段系統 brawl-3:三連擊黏臉=一次暈不飛走、連段中純踉蹌不位移、對已暈者出拳=挑飛 launcher、風壓打空中=乾淨接送(WIND_CARRY_LOB 不墊穩定)、地面=吹翻滾墊穩定、全鏈挑飛→風壓→進艙記 wind |
| `brawl.mjs`     | 爽鬥核心(A 款 brawl-1;docs/game-split.md):開局系統全醒(桶/補給座/瓶/拉桿)+charter 純量殘留清除、穩定值歸零=擊暈(無能量閘)、終結技=PUNCH_LAUNCH_LOB 打飛、完美格擋=反暈、搬進艙=resolveContain 計分+containLog、endMatch=事故報告 |

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

7. ~~元素系統休眠~~(B 款憲章時期的旗;A 款爽鬥=系統預設全開,`?props=full` 已退役——別再給 URL 加旗)。
8. **AI 對手預設開**:會走位/出拳干擾判定——出拳/搬運類 case 開頭把 `fighters[1].ai=false` 並清掉
   `carryObj/carrying`(扛著東西不能出拳,punch 會靜默 no-op;判定測試直接呼叫 `resolveStrike`)。
9. **鍵盤 edge 測試要 down/等待/up**:rAF 節流下 `keyboard.press()` 的 down+up 常落在同一取樣幀,
   `keys.has()` 邊緣觸發(跳/格擋)整個吃不到——先 `keyboard.down()`,waitForFunction 等狀態成立再 `up()`。
10. **hitstop=節流放大鏡**(feel-3 後致命):hitstop 期間整個 sim 凍結,rAF 節流下每 0.1s 頓幀
   ≈ 數秒實時——前面案例累積的 hitstop 會把你的移動/計時等待窗整個吃光(waitForFunction 空轉超時)。
   對策:case 設定時 `game.hitstop = 0`;手動 `resolveStrike` 前把無關角色挪出拳距(命中=又生頓幀);
   斷言含 canGuard 一類複合條件時,把輸入旗標 dump 進回傳值(combo.mjs ⑦b 的 `why` 範式)。
11. **game.time 可能是負的(已修根因,教訓留檔)**:headless 的 rAF 時間戳偶爾倒退,舊主迴圈
   dt 沒下夾 → 負 dt 累積 → `game.time` 變負(獵獲值 −1.36s)。症狀=「同步不可能」:`useItem` 後
   同行寫入的 `_itemCastType` 讀得到、`_itemCastAt > 0` 卻 false(= 負 time + delay 仍 < 0);相對比較
   全正常所以其他案照過=只有「絕對時戳 > 0」類斷言偶發炸。根因已修(v2.js/main.js dt 下夾 0);
   排程施放案仍保留重試×3 當環境保險。**寫新斷言別假設 game.time ≥ 0 以外的絕對值性質。**

## Debug hooks(頁內 `window.*`)

`__v2`(game/fighters/barrels/bottles/stations/castX/punch/…)、`__lab`(labGroup/floorFx)、`__avatars`、`__hands`、`__touch`。
