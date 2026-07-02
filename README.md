# Mini Mage Mayhem

一款網頁版俯視角魔法遊戲專案,包含兩個可玩模式:

- **魔法事故報告 · 收容測試(v2,現行開發主線)** — 1v1 收容對決:三連擊打暈對手 → 抓起來 → 拖進(或拋進)中央收容艙;道具、爆桶與環境意外交織,每局結束產生一份荒謬的「魔法事故報告」。
- **單機魔法 Roguelike(v1)** — 四元素融合法術+元素反應,打波次活到 Boss。

🎮 **線上試玩**:
- v2 收容測試:<https://pony0278.github.io/Mini-Mage-Mayhem/v2>
- 單機 v1:<https://pony0278.github.io/Mini-Mage-Mayhem/>

## v2 收容測試 — 操作

| 操作 | 功能 |
|---|---|
| WASD | 移動(相對鏡頭) |
| 滑鼠 | 瞄準 |
| 左鍵 | 三連擊(左鉤→右鉤→終結直拳;**扛人時=朝滑鼠方向拋擲**) |
| 右鍵 | 抓被打暈的對手/放道具技能;搬運中=輕放 |
| 空白鍵 | 格擋推開(被打中的短窗內按,可打斷對手連段) |
| A/D 連打 | 被抓時掙脫 |
| B | 開關 AI 對手(預設關,紅方是練習假人) |
| L | 減閃爍(光敏無障礙;記住偏好) |
| R / C | 報告畫面:再戰/複製分享文字 |

先封存 3 次獲勝;每次收容=同一場事故升級(黃色警戒→全面失控)。

## 單機 v1 — 操作與玩法

WASD 移動、滑鼠瞄準、左鍵主法術、Space/Shift 衝刺。
四元素(火/冰/雷/毒)主法術,兩種元素**融合**成新法術(蒸氣、毒爆、電漿…);
元素反應改變戰場(火燒草地/雷導通水池/爆炸破薄牆);每波三選一升級,最後挑戰 Boss。

## 專案結構

即時 3D 渲染(Three.js 體素風,固定 45° 跟隨攝影機),**無框架、無打包**——遊戲程式是
`js/` 下的原生 ES modules,HTML 檔只是薄殼:

- `index.html` — 單機 v1(站點首頁)
- `v2.html` — v2 收容測試
- `camera-sandbox.html` / `training.html` — 攝影機沙盒/法術測試場(開發用)
- `js/` — 全部遊戲程式(模組邊界見 `docs/module-boundaries.md`、`docs/v2-module-boundaries.md`、`docs/render-module-boundaries.md`)
- `vendor/three.min.js` — 內建 Three.js(同源載入)
- `tools/punch-studio.html` — 動作編排器(開發工具):v2 小人的招式在這裡編,JSON 匯出貼進 `js/brawler-clips.js`(流程見 [`docs/animation-workflow.md`](docs/animation-workflow.md))

## 文件

設計與規劃文件的總索引:[`docs/README.md`](docs/README.md)
(v2 設計包/事故報告規格/路線圖/模組邊界/動作工作流)

## 部署

GitHub Pages 直接服務 `main` 分支根目錄——推送到 `main` 即更新線上版本。
`.nojekyll` 必須存在(否則 `js/`、`vendor/` 會被 Jekyll 排除導致 404)。
畫面右下角的 build tag 可確認拿到新版(必要時硬重新整理)。
