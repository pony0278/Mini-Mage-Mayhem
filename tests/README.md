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

## Headless 陷阱(踩過的;寫新套件先讀,`js/CLAUDE.md` §測試 有完整版)

1. **rAF 節流**:headless 下 `requestAnimationFrame` 只走實時的 4~36%。等時間**一律輪詢 `__v2.game.time`**,
   別用 `setTimeout` 當遊戲時鐘;引信/冷卻類邏輯**直接呼叫**(如 `__v2.explodeBarrel(b)`)別等它自然到。
   套件裡的 `advance(sec)` helper 就是 game.time 輪詢。
2. **本機玩家 `fighters[0]` 的 facing 每幀吃滑鼠重算**(桌機瞄準)→ 施放者測試**一律用 `fighters[1]`**,
   或每 tick 重新釘 facing。
3. **POD 在 (480,320) r46**:凍住/高速的角色進艙半徑=失控收容→整場 reset,污染測試。
   測冰凍/擊飛時把角色擺**南邊空地**(如 y=540)避開。
4. **hitstop 0.12s** 會凍住 per-fighter step 迴圈 → `advance` 要給足(≥0.3s)跨過。
5. **server 從 repo root 起**:套件用 `import('./js/v2-floor.js')` 由瀏覽器對 server 根解析,從 `tests/` 起會 404。
6. **狀態污染**:上一個 case 留下的升壓桶引信到點會爆、`stampElement` 留的地板會殘留 → 新 case 先 `resetFloor()` /
   關掉別的桶 / 把無關角色挪遠(`x=60,y=60`)。

## Debug hooks(頁內 `window.*`)

`__v2`(game/fighters/barrels/bottles/stations/castX/punch/…)、`__lab`(labGroup/floorFx)、`__avatars`、`__hands`、`__touch`。
