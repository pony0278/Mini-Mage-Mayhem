# assets/ — 建模資產(GLB 原始檔)

角色建模管線的**素材倉庫**(不是遊戲執行時載入的東西——遊戲本體是體素小人,
這裡放的是 `tools/mesh-part-extractor.html` + `tools/punch-studio.html` 的輸入/中繼檔)。
管線說明:[`docs/animation-workflow.md`](../docs/animation-workflow.md)、
[`docs/part-authoring.md`](../docs/part-authoring.md)。

## 資料夾

- **`rigs/`** — **基座角色**(骨架版 GLB):16 骨、rest=T-pose、網格為骨頭的剛體子節點。
  `base-avatar.glb` 是 punch-studio 開機自動掛載的預設角色(**未來所有角色的基底**);
  慣例與原理見 `docs/animation-workflow.md` §1。
- **`raw/`** — 第三方工具產的**整塊模型**,還沒切過。丟進
  `tools/mesh-part-extractor.html` 圈選拆部位的起點。
- **`parts/`** — 已切出的**單一部位**。⚠ 目前這裡的檔案是**分檔匯出**
  (保留世界座標,原點沒對齊接縫),還不能直接進 PUNCH STUDIO 掛載——
  要重新載入抽取器,對每個部位跑一次「**匯出規範 GLB**」(選對 slot,
  原點才會移到接縫圓心+軸向對齊),才是掛載用的最終檔。

## 現有檔案

| 檔案 | 狀態 |
|---|---|
| `rigs/base-avatar.glb` | **基座角色**(16 骨+剛體部位,使用者精修版)——punch-studio 預設掛載 |
| `raw/model.glb` | 整塊來源模型(Blender 匯出) |
| `raw/meshy-figure-source.glb` | Meshy AI 產的分件角色(13 部位,KHR 量化)——`tools/meshy-mannequin.glb` 的來源;重產跑 `tools/meshy-convert.mjs` |
| `parts/head.glb` | 已切出,待規範匯出 |
| `parts/hand_l.glb` / `parts/hand_r.glb` | 已切出,待規範匯出 |
| `parts/front_arm.glb` | 已切出,**待規範匯出時需確認**:命名沒有 `_l`/`_r`,PUNCH STUDIO 的 slot 自動判斷認不出左右——規範匯出面板手動選對 `upper_arm_l`/`upper_arm_r`(或 `forearm_l/r`,依實際是上臂還是前臂)即可,不影響幾何本身。

## 儲存方式的取捨(給以後的自己看)

這些檔案目前用**一般 git commit**(未用 Git LFS)存進 repo——最簡單、零額外設定,
現況(~72MB)沒問題。**如果之後這些素材頻繁重新匯出/迭代**,每次修改都會讓
`.git` 歷史累積一份新的完整檔案(binary diff 沒有增量),repo 會越滾越大。
到那個規模再考慮 Git LFS(需要 `git lfs install` + 額外設定,私有 repo 的 LFS
額度另計);現在不用先做。
