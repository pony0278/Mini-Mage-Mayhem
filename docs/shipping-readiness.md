# 上架就緒缺口盤點（C）— BR 已確定為終點

> 用途：盤點「把單機丟上 Poki / CrazyGames」前要補的缺口，並在**BR 已確定為終點**的前提下，標記每項是「BR 也用得到」還是「BR 丟棄品」，避免把工花在 BR 用不到的東西上。
> 配套：路線取捨見 [roadmap.md](roadmap.md)；BR 架構見 [battle-royale-tech-stack-v1.md](battle-royale-tech-stack-v1.md)、[battle-royale-phase-plan-v1.md](battle-royale-phase-plan-v1.md)。
> 盤點時間點：單機 v0.8（3D 體素 + 固定 45° 攝影機；capstone/肉搏星級內容已收齊）。

---

## 0. 一句話（BR 確定後，C 的角色變了）

> 既然 BR 是**確定**的終點（不再是「靠 C 的數據決定要不要做」），C 就**不是 Go/No-Go 閘門**，而是三件事：
> **(1) 去風險**——先證明「核心循環本身夠黏」，否則蓋幾個月 netcode 也救不回一個不好玩的 loop；
> **(2) 養受眾 / 進帳**——上架期間累積玩家與分享；
> **(3) 共用資產**——`sim.js` 這顆模擬核是 BR 伺服器要跑的東西，現在打磨它＝在替 BR 鋪路。
>
> **結論：C 要「輕量上架」拿到循環黏著度訊號 + 一點受眾，不要把丟棄品（單機 3D 客戶端/平台 SDK）鍍金。** 真正該認真投資的是 **sim 的 headless 化（B0）**，那是 BR 的地基。

---

## 1. BR 相關性標記（看懂取捨的關鍵）

| 標記 | 意思 | 例 |
|---|---|---|
| 🔵 **核心/共用** | BR 伺服器或客戶端直接沿用，認真做 | sim 邏輯、平衡、循環黏著度 |
| 🟢 **客戶端可帶走** | 現在是單機客戶端的事，但同引擎演化成 BR 客戶端時多半能帶 | 音效、觸控輸入、i18n、載入畫面 |
| 🔴 **BR 丟棄品** | 只服務「單機上架」，BR 用不到 | Poki/CrazyGames SDK、單機波次/Boss meta、3D 美術鍍金 |

> 提醒（roadmap §2）：**目前的 3D 體素 + 攝影機 + 美術，對 BR 完全用不到**（BR 伺服器 headless）。所以「把單機畫面做更漂亮」對 BR = 0 進度。

---

## 2. 缺口清單（已對程式碼盤點，非憑空）

| # | 缺口 | 現況（實測） | 嚴重度 | 工 | BR 標記 | 為何 |
|---|---|---|---|---|---|---|
| 1 | **音效 / 音樂** | **完全沒有**（`js/`、HTML 零 `Audio`/`sound`） | 高 | 中 | 🟢 客戶端 | 命中/施法/死亡/UI 全靜音 → 手感與留存最大短板 |
| 2 | **手機 / 觸控操作** | **完全沒有**（只有 WASD+滑鼠+Space/E；零 touch/pointer 輸入） | 高 | 中–高 | 🟢 客戶端 | Poki/CG 流量**以手機為主**；沒觸控＝大半玩家進不去，留存數據也會被桌面偏誤 |
| 3 | **平台 SDK**（Poki 或 CrazyGames） | **沒有**（零 SDK script） | 高（上架必須）| 低–中 | 🔴 丟棄 | 廣告、gameplayStart/Stop、商業中斷暫停都靠它；上架硬需求 |
| 4 | **暫停 + 生命週期** | 有 `setPaused` 旗標但**無使用者暫停**、無 `visibilitychange`/`blur` 處理 | 中 | 低 | 🟢/🔴 | 切分頁不暫停；Poki 廣告中斷要能暫停 |
| 5 | **存檔 / 最高分** | **沒有** localStorage（`bestScore` 是敵人選取邏輯，非高分） | 中 | 低 | 🔴（但便宜）| 「破自己紀錄」是單機留存鉤子 |
| 6 | **i18n / 英文** | **全中文**（zh-Hant，標題/卡片/提示） | 中–高 | 中 | 🟢 客戶端 | 全球平台需英文才有觸及 → 留存數據才有代表性 |
| 7 | **新手引導 / 操作清晰** | 標題有列鍵位，但**無互動教學**、**手機完全沒提示** | 中 | 中 | 🟢/🔵 | 首局留下來與否的關鍵；尤其手機 |
| 8 | **載入畫面 / 體積** | `vendor/three.min.js` **594K 單檔阻塞載入**、無 spinner | 低–中 | 低 | 🟢 客戶端 | 首屏白畫面；BR 客戶端同樣吃 Three.js 重量 |
| 9 | **品牌 / 版本收尾** | 標題寫「v0.8 Art Style」佔位字 | 低 | 低 | 🔴 | 上架賣相 |
| 10 | **手感 juice（Path A）** | 已有 screenShake/粒子；可再加 | 低 | 中 | 🔴 | roadmap 明示**最低槓桿**，別當進度 |

### 額外（不是 C 缺口，但 BR 確定後最該認真的「橋」）
| B0 | **sim headless 化** | `sim.js` 已不 import render/input（DAG 乾淨），但**仍讀 `CAM`/`mouse`/`keys`**（CLAUDE.md 標的「intent adapter step 3.5」未做）；RNG 用 `Math.random()` 非種子化 | — | 中 | 🔵 **核心** | BR 伺服器要跑的就是這顆；`step(state, inputs, dt)`、種子化 RNG、無 DOM。**這才是 BR 真正的第一步（B 階段計畫的 B0）** |

---

## 3. 建議排序（BR 已確定 → C 輕量、B0 認真）

### 階段 C-lite：用最小成本拿「循環黏著度訊號 + 一點受眾」
目標不是完美單機，是**證明 loop 夠黏**（黏不住的話先修 loop，別進 BR）。挑**共用/驗證價值高**的先做，丟棄品做到「能上架」即可：

1. **音效（#1）** 🟢 — 命中/施法/融合/升級/死亡/UI 一組；最便宜的手感躍升。
2. **觸控操作（#2）** 🟢 — 虛擬搖桿移動 + 拖曳瞄準/點擊施法 + 副攻/閃避/E 按鈕。沒這個，留存數據不可信。
3. **英文 i18n（#6）** 🟢 — 至少 EN/ZH 切換；字串集中化（BR 客戶端也要）。
4. **平台 SDK（#3）+ 暫停/生命週期（#4）** 🔴/🟢 — **只挑一個平台**（建議 Poki，此類遊戲常見）；接 gameplayStart/Stop + 廣告 + 暫停。丟棄品，做到能上架就停。
5. **最高分 + 載入畫面（#5、#8）** — 便宜的留存鉤子與首屏。
6. **品牌收尾（#9）** — 改掉佔位字。
7. **跳過/最小**：第二平台、深度教學、美術鍍金（#10）。

### 階段 B0：與 C 並行或緊接（BR 地基，認真投資）
8. **`sim.js` 收尾 headless**：補 intent adapter（移除 `CAM`/`mouse`/`keys` 直讀，改吃傳入的 `inputs`）、`step(state, inputs, dt)` 純函數化、**種子化 RNG**（取代 `Math.random()`）、確保無 DOM。→ 之後就能接 BR 階段計畫的**探針一（netcode 同步）**與**探針二（PvP 好不好玩）**。

> 一句話：**C 用來確認「這 loop 值得做成 BR」並養一點受眾，所以輕量；B0 用來真的開始做 BR，所以認真。** 別把單機 3D 客戶端鍍金——它是 BR 丟棄品。

---

## 4. 決策（已定）

1. **平台 → CrazyGames**：上架更自助/快、對多人友善（之後 BR 可同家），SDK/受眾可延續。
2. **C 範圍 → 數據可信 MVP**：SDK+生命週期 **+ 觸控 + 音效 + 英文**；砍掉最高分/載入美化/中英切換 UI/品牌鍍金（純 polish，延後不影響第一份數據可信度）。
3. **C 與 B0 順序 → 並行，輸入接縫先做**：先抽 B0 的輸入接縫（BR＋觸控共用同一條縫，避免觸控做兩遍），觸控餵縫、音效並行，上架拿數據；B0 剩餘（種子化 RNG、`step()` 純化）在等數據期間補完。
4. **i18n → 字串表（EN 預設 + ZH 保留，不做切換 UI）**：字串集中到 `strings.js`（`{en, zh}`、`T(key)`），預設英文，中文留著（BR 客戶端可重用；之後加切換鈕 trivial）。

## 5. 動工計畫（依決策展開）

> 一句話：**輸入接縫先打通（BR 地基＋乾淨觸控的共同前提），再往上疊觸控/音效/英文/SDK，上架 CrazyGames 拿留存數據。**

- [x] **W1 · B0 輸入接縫（intent adapter）✅** 🔵 BR 核心 —— `sim.js` 改吃中性 `game.input`（`{moveX, moveY, aimX, aimY, firing, secondaryFiring, dash, grab}`），**已移除所有 `keys`/`mouse`/`CAM` 直讀**（state import 也砍掉）；客戶端 `main.js` 的 `buildInput()` 算好相機相對移動與滑鼠→世界瞄準後寫入。端到端驗證移動/瞄準/開火/衝刺行為不變、零 error。
- [x] **W2 · 觸控操作 ✅** 🟢 —— `js/touch.js`：左半屏動態搖桿（移動）+ 右半屏動態搖桿（瞄準＋自動開火）+ 固定按鈕（閃避/副攻/E）。原生 touch 多點、只在遊玩時接管、選單交給合成 click。全部只是「另一種方式產生 `game.input`」。端到端驗證移動/瞄準開火/衝刺鈕/點擊開始/升級選卡，零 error；桌面不受影響（`touch.enabled` 觸碰後才開）。
- [x] **W3 · 音效 ✅** 🟢 —— `js/audio.js`：WebAudio **程序合成**（無音檔→零載入、不碰 egress）。14 種音效：shoot/melee/hit/enemyDie/explosion/fusion/upgrade/hurt/dash/grab/throw/secondary/waveclear/gameover。sim **headless**：推事件名進 `game.sfx`，客戶端每幀抽出來播（同名每幀上限 3 防爆音）；首次手勢 unlock、`M` 靜音。驗證 14 種合成全不 throw、事件正確 emit+drain、零 error。
- [x] **W4 · 英文字串表 ✅** 🟢 —— `js/strings.js`（gettext 風格：中文字串即 key，`T()` 預設 EN、`lang='zh'` 原樣回傳）。render 的 UI literals 改英文、動態內容包 `T()`；sim 僅在組合字串（死亡訊息/戰報/卡名星級/最大災難）處用 `T()` 組譯。涵蓋標題/HUD/操作/升級卡名+敘述/法術說明/精通/副攻/戰鬥浮字/toast/Boss 旗標/傷害來源/死亡訊息/結算統計。**所有使用者文字皆英文**；剩餘僅程式碼註解片段（不顯示）。截圖驗證 title/HUD/upgrade/end/星級卡/死亡訊息全英文、零 error。
- [x] **W5 · CrazyGames SDK + 生命週期 ✅** 🔴 —— `js/platform.js`：防禦式 adapter，**動態載入 SDK,載不到就 no-op**(本地/github.io 照跑)。`init`/`loadingStop`、依狀態轉換 `gameplayStart`/`gameplayStop`、重開時 `requestAd('midgame')`(暫停+降音,adFinished/error/逾時都會恢復,絕不卡死)、`visibilitychange` 切背景暫停+降音+停 gameplay。`audio.setAudioDucked` 獨立於使用者靜音。驗證:無 SDK 優雅降級(零 error)；stub SDK 下生命週期呼叫順序正確。**註:實際送審前需對 CrazyGames QA 要求微調**(SDK 載入方式、廣告政策、banner/rewarded)。
- [ ] **W6 · 上架 + 收數據**；之後 **B0 收尾**（種子化 RNG、`step()` 純化）→ 接 BR 探針一/二。

> 本文件是 C 的缺口依據與動工計畫。完成一項就勾一項並更新狀態。
