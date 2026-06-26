# 設計與規劃文件

這個資料夾收錄 Mini Mage Mayhem 的設計與技術規劃文件。

| 文件 | 內容 | 對應階段 |
|---|---|---|
| [roadmap.md](roadmap.md) | 路線決策記錄 — 打磨單機 / 上架 / 做 BR 的三條路 (A/B/C) 取捨與建議 | 🧭 待決策 |
| [shipping-readiness.md](shipping-readiness.md) | 上架就緒缺口盤點（C）— BR 已確定為終點下的取捨；音效/觸控/SDK/i18n 缺口 + 排序 + B0 橋接 | 🚢 C 動工依據 |
| [design-vision.md](design-vision.md) | 法術與環境互動的設計願景 — 北極星 + 現況標記（已實作/keystone/岔路）| ⭐ 願景 |
| [content-backlog.md](content-backlog.md) | 內容待辦 — 在「按鍵極簡（手機友善）」下要加的法術/環境互動、副攻插槽、複合組合、分批 | 📝 規劃中 |
| [capstones.md](capstones.md) | 畢業組合（capstones）— build 投資到位解鎖的被動大絕（流星降臨等）；框架 + 全菜單 + Tier-0 | 📝 規劃中 |
| [spells-and-upgrades.md](spells-and-upgrades.md) | 法術與升級總覽 — 目前所有元素/融合/主攻模式/衝刺/副攻/精通/升級的狀態一覽 | 📖 參考 |
| [module-boundaries.md](module-boundaries.md) | index.html 拆分的邊界定義書 — sim/render 耦合分析、模組 DAG、輸入 adapter 接縫、搬檔順序 | 🔧 重構依據 |
| [demo-concept.md](demo-concept.md) | 單機俯視角魔法 Roguelike 小品企劃 — MVP 規格、法術／修飾符／元素反應／敵人／Boss／美術方向 | ✅ 已實作（單機 v0.8） |
| [battle-royale-tech-stack-v1.md](battle-royale-tech-stack-v1.md) | 若往「即時多人大逃殺 (BR)」發展的完整技術棧定案 — Rust sim 核、dedicated server、Nakama meta、傳輸、場地同步 | ⏳ 未來（探針通過後） |
| [battle-royale-phase-plan-v1.md](battle-royale-phase-plan-v1.md) | BR 的階段任務計畫 — 探針一(netcode) → 探針二(PvP 好不好玩) → GATE → 正式棧 | ⏳ 未來 |

## 現況

- **單機 demo 已完成並上線**：3D 體素風 + 固定 45° 跟隨攝影機，含四元素融合、元素反應、敵人波次、元素哥布林法師 Boss。
- 線上試玩：<https://pony0278.github.io/Mini-Mage-Mayhem/>

## 路線決策（一句話）

是否往 BR 前進，取決於先用最小成本驗掉兩個會殺死專案的未知：**(1) 混亂場地在延遲下同步得了嗎、(2) 人對人的魔法混亂對打是爽還是惱**。兩根探針都過，才投入以月計的正式 BR 棧（見階段任務計畫）。
