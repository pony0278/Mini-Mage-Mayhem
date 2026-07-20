# assets/ — 建模資產(GLB 原始檔)

建模素材倉庫 + 部署資產(`rigs/`、`scene/` 是遊戲執行時 fetch 的;`raw/`、`parts/` 純建模來源,
這裡放的是 `tools/mesh-part-extractor.html` + `tools/punch-studio.html` 的輸入/中繼檔)。
管線說明:[`docs/animation-workflow.md`](../docs/animation-workflow.md)、
[`docs/part-authoring.md`](../docs/part-authoring.md)。

## 資料夾

- **`rigs/`** — **基座角色**(骨架版 GLB):16 骨、rest=T-pose、網格為骨頭的剛體子節點。
  `base-avatar.glb` 是 punch-studio 開機自動掛載的預設角色(**未來所有角色的基底**);
  慣例與原理見 `docs/animation-workflow.md` §1。
- **`scene/`** — **場景 GLB**(遊戲執行時載入,同 rigs/ 屬部署資產):v2 場景件,
  render-lab 開局 fetch(`recycling-pod.glb`=中央回收艙底座;`throw-in-sign.glb`=四方向
  「THROW IN!」地面指示牌——**2026-07-19 已下場**(使用者反饋太突兀,render-lab 不再載入;
  檔案留庫備用);`frost-bottle.glb`+`frost-bottle-tex.jpg`=**冰霜瓶 GLB**(item-1;render-core
  `loadFrostBottleGlb` 載一次、三狀態 clone=握持/地面/飛行,油瓶留方塊);
  `oil-bottle.glb`+`oil-bottle-tex.jpg`=**油瓶 GLB**(紅色 OIL 桶造型;bottles elem='oil',冰瓶的姊妹;518KB)、
  `barrel.glb`+`barrel-tex.jpg`=**爆桶 GLB**(紫色魔能桶 Violet Arcane Vessel;game.barrels 爆炸桶;158KB 超精簡;
  item-2 **已接入**:render-core `loadBarrelGlb`/`barrelClone`/`barrelReady`,三狀態同冰瓶,充能/引信靠疊加 makeGlowSphere 光暈表達
  =充火橘/充電藍/引信 fuse 閃紅,不換貼圖);油瓶 2026-07-20 **已入庫尚未接入**。
  **貼圖必外部化(踩過的坑)**:
  GLTFLoader 的內嵌 JPEG 在 SwiftShader(headless 測試/低端機)下上傳成**全黑**,外部 TextureLoader 就正常
  →入庫時把貼圖抽成 `*-tex.jpg`、GLB 去圖只留幾何,loader 端 TextureLoader 載回指派(`flipY=false`/sRGB)。
  **去圖別 prune(踩過)**:gltf-transform `prune()` 見「沒貼圖引用」會把 UV(TEXCOORD_0)一併砍掉→遊戲裡貼圖無 UV 對應=渲成素色;
  去圖只 `setBaseColorTexture(null)`+`tex.dispose()`,不 prune(保 UV)。
  **Meshy 道具入庫四步(冰瓶/油桶實證)**:①`NodeIO.read`(解 Draco)②`doc.createExtension(KHRDraco…).dispose()`
  (★卸 Draco 擴充,否則 `write` 又壓回=油桶漏這步的坑)③抽貼圖成 `*-tex.jpg`+`setBaseColorTexture(null)`/`tex.dispose()`
  去圖(**不 prune** 保 UV)④選配 `quantize`(KHR_mesh_quantization,r149 原生支援;油桶 794→518KB 省 35%,無可見失真)。
  **入庫規範**:離線先
  `gltf-transform copy`(解 Draco——遊戲的 GLTFLoader 沒配 DRACOLoader,壓縮檔直接載會炸;
  未壓縮的小件如指示牌可省這步,直接 `optimize`)→ `simplify`(場景件抓 ~2-4 萬 tris)
  → `quantize` 瘦身;遊戲端零解碼成本。
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
