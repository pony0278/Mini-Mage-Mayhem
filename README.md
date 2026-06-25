# Mini Mage Mayhem

一款網頁版俯視角魔法 Roguelike 小品 — 用隨機法術組合與元素反應，把場地炸成一團混亂並活下來。

🎮 **線上試玩**：<https://pony0278.github.io/Mini-Mage-Mayhem/>

## 操作

| 操作 | 功能 |
|---|---|
| WASD | 移動（相對鏡頭） |
| 滑鼠 | 瞄準 |
| 左鍵 | 主法術 |
| Space / Shift | 閃避衝刺 |

## 玩法

- 四元素（火／冰／雷／毒）主法術，兩種元素會**融合**成新法術（蒸氣、毒爆、電漿…）。
- 元素反應改變戰場：火燒草地、火引爆毒霧、雷導通水池、冰凍水面、爆炸破薄牆。
- 每波結束三選一升級，Build 逐漸失控；最後挑戰「元素哥布林法師」Boss。

## 版本

目前為**單機 3D 體素版（v0.8）** — 固定 45° 跟隨攝影機、即時 3D 渲染（Three.js）。

- `index.html` — 遊戲本體（部署為網站首頁）
- `camera-sandbox.html` — 攝影機調整沙盒（滑桿即時調 FOV／角度／距離／環繞／取景／暫停）
- `training.html` — 法術測試場（即時切換元素／精通／副攻／肉搏 + 生成不死假人；按 T 收合面板）
- `vendor/three.min.js` — 內建的 Three.js（同源載入）

> 兩個沙盒由 `index.html` 重新生成（單一真相來源），不手動維護。

## 文件

設計與規劃見 [`docs/`](docs/)：

- [遊戲企劃 — 俯視角魔法 Roguelike 小品](docs/demo-concept.md)
- [魔法大逃殺 — 完整技術棧定案 v1](docs/battle-royale-tech-stack-v1.md)
- [魔法大逃殺 — 階段任務計畫 v1](docs/battle-royale-phase-plan-v1.md)

## 部署

GitHub Pages 由 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) 自動部署：推送到 `main` 即重新發佈網站首頁。
