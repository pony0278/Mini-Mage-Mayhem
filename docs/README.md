# 設計與規劃文件

這個資料夾收錄 Mini Mage Mayhem 的設計與技術規劃文件。

## 🔀 v2 設計包（魔法事故報告 / 收容測試 — 現行方向）

> 再定位（規格 E）：核心＝**每局產生一份荒謬的「魔法事故報告」**（吸收原規格 C 為主軸）。
> 戰鬥是產生報告的引擎；護城河＝**輸了也好笑、好笑到想截圖分享**。
> 前身：單機 roguelike → 「玩家用環境互相送死」的短局 PvP（環境處決，規格 A–D 仍為素材引擎）。

| 文件 | 內容 |
|---|---|
| [v2-environmental-pvp.md](v2-environmental-pvp.md) | **主文件**：北極星、路線決定、複雜度搬軸、三層傷害、瓶頸地圖、紅燈、速查尺（先讀 §0.5）|
| [v2-spec-A-dumb-deaths.md](v2-spec-A-dumb-deaths.md) | **規格 A（最高優先）**：蠢死法 + 畫面糖果（空洞墜落/誇張擊飛/凸眼）狀態機 + 數值 + DoD |
| [v2-spec-B-ownership.md](v2-spec-B-ownership.md) | **規格 B（測試計畫）**：鋪設→累積→引爆的 ownership；旋鈕起始值 + A/B 測法 + kill-criteria |
| [v2-spec-C-share.md](v2-spec-C-share.md) | **規格 C（增長引擎）**：最大災難回顧 / 一鍵分享截圖卡（站在 A 鏡頭 + B 歸因上）|
| [v2-spec-elements.md](v2-spec-elements.md) | **元素/融合/取得**：融合搬到地板成環境反應；元素＝空間動詞；MVP 對稱固定 kit |
| [v2-element-floor-chemistry.md](v2-element-floor-chemistry.md) | **地板化學（元素反應藍圖）**：一格一狀態（取代非疊層）+ ~6 條招牌反應表（複用單機火燃油/雷導水/火引爆毒）+ 地板狀態機 + 兩個已答複合情境 + 場地洩漏掛鉤；**§9 元素×道具對照（7 元素投放原型 + 次數3/2/1 + 四項定案）／§10 元素站洩漏節奏（總開關拉桿啟動、四站錯開輪噴、雷站=原始電弧；**§10.4 操作定案：四角落點/兩層效果/收縮環預警/隨機不連續~10s/開關貼艙揍它 arm**）／§11 道具刷新搶點（稀疏分層·油風保底、MVP 固定刷新台→輸送帶升級）／§12 不穩定魔力廢料桶（取代爆桶：可推撿丟·受擊升壓·爆後種地板·元素充能決定爆種+升壓發光 telegraph）** |
| [v2-floor-state-architecture.md](v2-floor-state-architecture.md) | **地板狀態機架構/實作指引**：新開 `js/v2-floor.js`（守 v2 DAG、鏡射 `game.oils` 計時覆蓋模式、不抄 sim.js）+ v2 私有 `v2s.floor` 層 + `FLOOR_RX` 正交反應表 + 單一 `applyElement` choke point + `stepFloor`；接線改動清單 + 維護性風險 + 四刀落地切法（先純 sim 邏輯層 headless 驗、render 後接） |
| [v2-spec-D-arenas.md](v2-spec-D-arenas.md) | **規格 D（地圖 + loop）**：搶獎盃→Boss 甦醒→追逐；浮島四周墜落（render-only）；斷橋孤島落地 + 型錄 + 落地順序 |
| [v2-spec-E-incident-report.md](v2-spec-E-incident-report.md) | **規格 E（北極星再定位）**：魔法事故報告/收容測試；吸收 C 為核心；收容狀態機 + 報告 schema + 等級 + V0.8/0.9/1.0 路線；可重用零件對照 |
| [campaign.md](campaign.md) | **闖關化決策(2026-07-16 拍板,現行主線)**:3 關+廠長 boss+逃出下班——關卡表/boss 三段擊倒設計/台詞草稿/實作計畫/不做清單;戰鬥系統不動,闖關=外殼 |
| [game-split.md](game-split.md) | **遊戲分家決策(2026-07-15 拍板,最高優先)**:60 人實測裂在核心循環 → 拆 A(爽鬥,先做)/B(分類,凍結於 commit 4c92837);兩款定位表+A-v0 手術清單+開放問題 |
| [v2-core-charter.md](v2-core-charter.md) | **核心玩法憲章 v1.1 → 分家後=B 款(分類)的設計權威(凍結;B 可玩狀態=commit `4c92837`)**:分類競速=唯一勝利、事故能量閘、回收口干擾、下班結局。**不再約束 main(A 款爽鬥)開發**——分家決策見 [game-split.md](game-split.md) |
| [v2-sorting-ai-anger.md](v2-sorting-ai-anger.md) | **分類事故/AI 情緒(使用者撰寫)**:中央口需求制分類垃圾 → 分錯累積 AI 怒氣五階段 → 老闆抓狂把你當垃圾回收(給戰鬥一個因果);V0.8 已落地見文件頭。⚠ 暴走主線已被憲章 v1.1 取代,留作實作紀錄+喜劇素材庫 |
| [v2-onboarding-freeform-routes.md](v2-onboarding-freeform-routes.md) | **上手/自由路線+動態教學(使用者撰寫)**:兩路線(清運垃圾取工具 vs 直接速攻)、垃圾=資源(回收 or 武器)、動態教學隨行為切提示、首局示範者 AI、UI 三進度分開;已落地見文件頭 |
| [v2-recycle-performance-design.md](v2-recycle-performance-design.md) | **回收演出設計(使用者撰寫)**:收容後的招牌喜劇演出——玻璃罩/掙扎/掃描/荒謬分類/三階段收尾(彈回/事故/壓縮清運);V0.8 最小版已落地(見文件頭實作狀態)|
| [v2-spec-F-spells-items.md](v2-spec-F-spells-items.md) | **規格 F（法術系統再定義）**：撿即用道具取代升級樹；基礎動詞改「揮拳→擊暈→抓→搬→入倉」（陣風降為道具，取代 E §4）；道具 5 動詞框架 + 補給座/只拿1 + MVP 道具集（風/傳送/冰+爆桶）；**§2.5 回合模型：三階段收容升級（軟重整取代完全重置）**；報告吃道具故事 |
| [magic-incident-report-concept.md](magic-incident-report-concept.md) | **概念原文**：魔法事故報告完整願景（世界觀/角色/收容/報告/圖鑑/挑戰碼/命名）— spec E 的來源 |
| [magic-spell-item-concept.md](magic-spell-item-concept.md) | **概念原文**：法術與道具系統設計稿（撿即用/事故來源/道具表/五系終極/元素反應/事故能量）— spec F 的來源 |
| [magic-containment-3-stage-concept.md](magic-containment-3-stage-concept.md) | **概念原文**：三階段收容勝利規則（先收 3 次；每次收容＝同一場事故升級，不完全重置；軟重整/警戒階段/三幕報告）— spec F §2.5 的來源 |
| [v2-roadmap.md](v2-roadmap.md) | **進度路線圖**：核心已驗證好玩後的階段規劃（Phase 0 手感→1 加深事故→2 分享→3 美術→4 擴張）+ 驗收 + 出貨缺口 |
| [v2-module-boundaries.md](v2-module-boundaries.md) | **v2 模組邊界定義書**：v2.js 拆分的分析（死碼清單）、目標模組表 + DAG、不變式、驗證協定 |
| [render-module-boundaries.md](render-module-boundaries.md) | **render.js 模組邊界定義書**：渲染層拆分（core/world/actors/entities/hud + 門面）、跨區依賴分析、雙遊戲驗證協定 |
| [animation-workflow.md](animation-workflow.md) | **動作工作流**：PUNCH STUDIO 編排器（`tools/punch-studio.html`）→ JSON 匯出 → 貼 `brawler-clips.js`；impact 影格 ↔ `STRIKE_DELAY` 對齊規則、軸支援表、招式插槽 |
| [v2-item-cast-system.md](v2-item-cast-system.md) | **道具系統：次數 + 排程施放**（規劃）：道具改多次數消耗品 + 每道具專屬使用動畫（impact 幀觸發，鏡像揮拳）；`ITEM_SPEC` 正交欄位表（uses/clip/delay/whileDisabled/aim/kind，取代單一分類 enum）；骨架先出行為不變、動畫到位再逐列開 |
| [v2-combat-rhythm.md](v2-combat-rhythm.md) | **戰鬥節奏設計指引**:三層節奏(微/中/宏)+ 全部戰鬥時序拍子總表(audit 現值)+ 四鐵則(三拍結構/防守方一拍/同鍵不同時機/拍子承諾)+ 準拍格子(0.28/0.55/1.0/3s)+ 拍子咬合關係表 + 加新動詞 checklist——**加/改戰鬥動詞、填 ITEM_SPEC.delay、調時序常數前先讀** |
| [v2-carry-throw-system.md](v2-carry-throw-system.md) | **扛/丟系統維護分析（桶+人）**：「拿起→舉著定格→排程甩出」共用架構的單一真相——7 檔地圖、每 fighter 狀態機、**三時鐘同步鐵則**（人 `(release-hold)/60` ≠ 桶 `release/60`）、render 貼手（桶=child of g `updateHeldBarrel` / 人=syncActors 後處理 `positionCarried`+繞頭旋轉）、**病因庫**（含「抓起沒打橫＝持有狀態要持續驅動」）、headless 兩陷阱（rAF 節流跳 clip 時鐘 / 非本機自動掙脫）、調參速查、加新可扛物食譜 |
| [../assets/README.md](../assets/README.md) | **assets/ 素材倉庫**:建模管線的 GLB 原始檔（raw=整塊來源模型、parts=已切部位）；哪些檔案還需要跑規範匯出 |
| [part-authoring.md](part-authoring.md) | **部位建模規範**(給建模師):插頭與插座心智模型、原點/+Y/+Z 三規則、全部位接縫半徑與標準長度表、Blender 匯出清單、症狀對照 |

> 落地優先序（規格 E）：**V0.8 事故報告雛形（最高 CP，先驗「想不想截圖」）→ V0.9 收容測試原型 → V1.0 社群挑戰版**。
> 規格 A（蠢死法演出）/B（事故因果）/D（地圖引擎）餵報告；元素 spec 貫穿。單機版（下表）為**零件捐贈庫**（`recordDisaster`/`makeRunStory` 直接餵報告生成）。

> **可玩原型**：[`v2.html`](../v2.html) — 2 人熱座（藍 WASD＋F／紅 方向鍵＋`/`），唯一動詞是「陣風把對手轟進中央空洞」。複用 v1 的美術＋45° 攝影機＋空洞墜落死法劇場（凸眼／縮小旋轉沉坑），自帶迷你 loop，不動單機 `index.html`。這是 A 的「笑出聲」測試載具：找 3–4 人輪流把彼此轟下去。

---

## 單機 v1 / 通用設計文件

| 文件 | 內容 | 對應階段 |
|---|---|---|
| [game-overview.md](game-overview.md) | **遊戲介紹總覽**（對外介紹用）— 賣點/流程/操作/元素與融合全表/近戰流派/副攻/升級/畢業大絕/敵人Boss/場地/反應/技術 | 📣 介紹 |
| [roadmap.md](roadmap.md) | 路線決策記錄 — 打磨單機 / 上架 / 做 BR 的三條路 (A/B/C) 取捨與建議 | 🧭 待決策 |
| [shipping-readiness.md](shipping-readiness.md) | 上架就緒缺口盤點（C）— BR 已確定為終點下的取捨；音效/觸控/SDK/i18n 缺口 + 排序 + B0 橋接 | 🚢 C 動工依據 |
| [melee-combo-reference.md](melee-combo-reference.md) | 近戰流派 combo 設計參考（土拳/雷手刀/風掌）— 3段普攻+重擊、動畫、MVP 順序、現況對照 | 🥊 近戰依據 |
| [polish-phase-plan.md](polish-phase-plan.md) | 打磨階段計畫（C-lite 之後）— 打擊感 / 付費點 / 自訂模型 / Boss 肢體破壞 / B0 地基,逐階段任務 | 🛠️ 打磨依據 |
| [design-vision.md](design-vision.md) | 法術與環境互動的設計願景 — 北極星 + 現況標記（已實作/keystone/岔路）| ⭐ 願景 |
| [content-backlog.md](content-backlog.md) | 內容待辦 — 在「按鍵極簡（手機友善）」下要加的法術/環境互動、副攻插槽、複合組合、分批 | 📝 規劃中 |
| [capstones.md](capstones.md) | 畢業組合（capstones）— build 投資到位解鎖的被動大絕（流星降臨等）；框架 + 全菜單 + Tier-0 | 📝 規劃中 |
| [spells-and-upgrades.md](spells-and-upgrades.md) | 法術與升級總覽 — 目前所有元素/融合/主攻模式/衝刺/副攻/精通/升級的狀態一覽 | 📖 參考 |
| [module-boundaries.md](module-boundaries.md) | index.html 拆分的邊界定義書 — sim/render 耦合分析、模組 DAG、輸入 adapter 接縫、搬檔順序 | 🔧 重構依據 |
| [demo-concept.md](demo-concept.md) | 單機俯視角魔法 Roguelike 小品企劃 — MVP 規格、法術／修飾符／元素反應／敵人／Boss／美術方向 | ✅ 已實作（單機 v0.8） |
| [battle-royale-tech-stack-v1.md](battle-royale-tech-stack-v1.md) | 若往「即時多人大逃殺 (BR)」發展的完整技術棧定案 — Rust sim 核、dedicated server、Nakama meta、傳輸、場地同步 | ⏳ 未來（探針通過後） |
| [battle-royale-phase-plan-v1.md](battle-royale-phase-plan-v1.md) | BR 的階段任務計畫 — 探針一(netcode) → 探針二(PvP 好不好玩) → GATE → 正式棧 | ⏳ 未來 |
| [mobile-touch.md](mobile-touch.md) | v2 手機觸控控制層規劃 — 橫向 + 單搖桿(移動=面向)+ 右拇指按鈕;吃 portal 手機流量。決策已定、分階段 A–D | 📝 規劃中(晚點做) |

## 現況

- **單機 demo 已完成並上線**：3D 體素風 + 固定 45° 跟隨攝影機，含四元素融合、元素反應、敵人波次、元素哥布林法師 Boss。
- 線上試玩：<https://pony0278.github.io/Mini-Mage-Mayhem/>

## 路線決策（一句話）

是否往 BR 前進，取決於先用最小成本驗掉兩個會殺死專案的未知：**(1) 混亂場地在延遲下同步得了嗎、(2) 人對人的魔法混亂對打是爽還是惱**。兩根探針都過，才投入以月計的正式 BR 棧（見階段任務計畫）。
