# punch-studio 維護手冊(Claude Code 用)

> 目的:**不用歷遍全部檔案就能安全修改**。改東西前先查這裡的「檔案地圖 + 跨檔契約 + 食譜」;
> 只讀你要動的那個檔的相關區段。載入順序/hoisting 規則/ESM 評估在 `README.md`(這裡不重複)。

## 這是什麼

`tools/punch-studio.html` = 姿勢/keyframe 編排器(免建構、CDN three **r128**+GLTFLoader,古典 script 共享全域)。
產出三種 JSON 餵遊戲:**動作 clip**(貼 `js/brawler-clips.js`,impact 幀÷60 = `STRIKE_DELAY`/`ITEM_SPEC.delay`)、
**裝備對位**(`EQUIP_CAL`)、**手勢**(`HAND_POSES`)。遊戲端消費者:`js/actor-brawler.js`/`actor-avatar.js`/`actor-hands.js`。

## 檔案地圖(誰負責什麼、關鍵符號)

| 檔 | 行數± | 職責 | 關鍵全域/函式 |
|---|---|---|---|
| `sockets-data.js` | 純資料 | 接縫規格 sockets.json 快照 | `SOCKETS_JSON_RAW` |
| `pose-data.js` | 450 | 姿勢資料模型 | `POSE_KEYS`(51 軸)、`PRESETS`、`ZERO_POSE`/`GOOFY_IDLE`、`REF_FPS=60`、timeline 修復/命名(`normalizeTimelineInPlace`、`uniqueKeyName`…) |
| `rig.js` | 490 | 場景+素體+狀態機 | 相機(`placeCam`,拖曳/滾輪 handler)、`DIM`(素體比例)、**素體節點:`root/pelvis/spine/headPivot/armL/armR/legL/legR`**(arm={sh,el,wr,fist})、`buildCharacter/rebuildCharacter`、**`applyPose(p)`/`lerpPose`**、undo/autosave(`pushHistory`/`STORAGE_KEY`)、`exportJson/importJson`、`getPlayPose` |
| `hitfeel.js` | 100 | 沙包試打 + **主渲染迴圈 `tick()`** | `triggerHit`、`tick`(每幀:播放/scrub/沙包/渲染) |
| `editor-ui.js` | 860 | 全部編輯 UI | 滑桿(`bindPoseSliders/refreshSliders`)、timeline(`buildTimelineUI/setActiveKey/addKey/delKey/moveKey`)、phase tabs、`buildPropPanel`(比例面板;角色模式鎖定)、白模/鏡像/T-pose、contact sheet、`showExport/importGd`、`resize` |
| `parts.js` | 690 | 部位/裝備/rigged 手掛載 | `PART_SLOT_DEFS`(sockets.json→slot;fallback 硬編)、`PS_RIG_TARGET`(slot→素體節點)、`PART_MODELS/PART_CONFIG`、**`attachPart(slot,obj)`**(掛假人+套 cfg)、`applyPartConfig`、`setSyntheticDummyVisible`、bundle/單檔載入(`collectBundleParts`,靠名字對 slot)、**裝備:`loadEquipFile`(任意 GLB→選定 slot)**、**rigged 手:`mountRiggedHands`(avatar 手骨優先/假人 fallback)+ `HAND_RIG`/`applyHandPose`/`HAND_POSE_PRESETS`(open/grip/fist)/`exportHandPoses`**、`buildPartSlotUI`(綁全部部位/手勢 UI)、hook **`window.__psEquip`** |
| `avatar.js` | 350 | 基底角色(正式 chibi 人物) | **`AVATAR`**(`{wrap,S,by,order,fillers}`;`by[key]={bone,meshes,…}` key 如 `hand_l`)、`loadAvatarBuffer`(16 骨字樣辨識、左右靠世界 X)、**`updateAvatarPose`**(素體→角色世界差量重定向,每幀)、關節填充(`buildJointFillers`/`setJointFill*`,UI 是本檔 IIFE 動態插進部位面板)、`clearAvatar`、**開機自動載入**(`../assets/rigs/base-avatar.glb` 優先→meshy 人偶) |
| `game-bridge.js` | 200 | 遊戲整合 + 健檢 | **`window.__ps`**(parts/avatar/applyPose/SEQ/avatarBoneWorld…)、招式庫(`LIB_KEY` 具名槽)、🎮 遊戲視角(fov32/俯44°)、impact 秒數讀出、`comboPreview` |

HTML 靜態面板:timeline/播放/顯示開關/preset/**15 PARTS 面板**(含裝備鈕、rigged 手鈕、校準滑桿、手勢列)。
**動態插入的 UI**:avatar 載入鈕+腳踝跟隨+**關節填充(球大小/逐關節微調)**= `avatar.js` 檔尾 IIFE 插在 `#partsStatus` 上方;遊戲整合面板 = `game-bridge.js`。

## 跨檔契約(改壞會連鎖的)

- **素體節點**(rig 定義,parts/avatar/hitfeel 讀):`root/pelvis/spine/headPivot/armL{sh,el,wr,fist}/armR/legL{hp,kn,ankle}/legR`。
  `rebuildCharacter` 會重建它們 → 先 `detachPunchPartsForRebuild()` 後 `reattachPunchPartsAfterRebuild()`(parts 提供,rig 呼叫)。
- **`applyPose(p)`**(rig):唯一姿勢入口;每次套姿勢後 avatar 的 `updateAvatarPose()` 把素體世界差量轉到角色骨。
  新增姿勢軸 = 動 `POSE_KEYS`(pose-data)+ `applyPose` 消費(rig)+ 滑桿定義(editor-ui)三處。
- **`tick()`**(hitfeel)= 唯一 rAF 迴圈:播放進度(`playT`×`REF_FPS`)、scrub、渲染。要每幀跑的東西掛這裡(或它呼叫的函式)。
- **`PART_MODELS[slot]` 的 parent 不固定**:一般部位=假人節點(`PS_RIG_TARGET`);rigged 手在 avatar 模式=**avatar 手骨**。
  遍歷假人 mesh 判斷「是不是部位」用 `isInsidePartObject(o)`(靠 userData 標記),別用 parent 鏈猜。
- **`setSyntheticDummyVisible`**(parts)被 attachPart/clearParts/avatar 呼叫;內含「rigged 手掛載期間抑制假人拳頭盒」邏輯。
- **移除功能 checklist**(ref-solve 的教訓):HTML 元素/按鈕 + CSS 區塊 + script 標籤 + **其他檔的 guard 呼叫**
  (grep 該檔全部頂層符號名到其他檔)+ README/本手冊更新 + headless 回歸(0 pageerror + 拖曳/滾輪實測)。

## 陷阱(踩過的)

1. **per-file hoisting**(README 規則):載入期程式碼只能呼叫更早載入的檔;跨檔前向引用用 `typeof fn==='function'` 守衛。
2. **GLTFLoader 名稱淨化**:`Hand.L`→`HandL`、`geo_Hand.L.002`→`geo_HandL`(點會被吃掉)。找節點用淨化後的名字。
3. **`window.__ps` 屬於 game-bridge**(整個物件重新賦值,最後載入)——別的檔要加 hook 用**自己的命名空間**(如 `__psEquip`)。
4. **hand slot 出廠 cfg 不是 identity**(rx:180,socket-local 慣例)——判斷「使用者沒調過」要比對 `partDefaultConfig(slot)`,不能比零。
5. **同 rig 的資產掛骨頭要歸零旋轉**(骨頭已帶 rest 旋轉,再疊=轉兩次);跨 rig(假人)才保留 rest 旋轉+手動校準。
6. **three 版本**:studio 用 r128(CDN),遊戲 vendored r149——API 有差(如 sRGB 常數),程式碼不能直接互抄。
7. localStorage keys:`PUNCH_STUDIO_AUTOSAVE_V2`(姿勢/timeline)、`PUNCH_STUDIO_PART_KIT_CFG_V3_SOCKETLOCAL_MOUNT`(部位對位)、
   `PUNCH_STUDIO_PART_KIT_HIDE_DUMMY_V2_14PARTS_AXISFIX`、`PUNCH_STUDIO_CLIP_LIB_V1`(招式庫)、`PS_JOINT_FILL*`、`PS_ANKLE_FOLLOW`、`PS_SHOW_*`、`PUNCH_HITFEEL`。
   改資料形狀=換 key 版本號,別原地變形。

## 常見任務食譜

- **加姿勢軸**:pose-data `POSE_KEYS` → rig `applyPose` 消費 → editor-ui 滑桿群(`buildPoseGroups` 的分組表)。
- **加部位/裝備 slot**:sockets-data `equipment_mounts` 加 mount + parts `PS_RIG_TARGET`/`PS_SLOT_LABEL`/`PART_SLOT_DEFS_FALLBACK` 各加一行(參考 `headgear`)。
- **裝備載入**:UI 走 `#partsEquip`(掛「選定 slot」);程式走 `__psEquip.loadEquipBuffer(ab, slot)`。
- **rigged 手**:`#handsBuiltin` 一鍵載 `assets/rigs/chibi-hands-rigged.glb`;手勢=`HAND_POSE_PRESETS` 起始值+滑桿;骨=Hand→Fingers→FingerMid→FingerTips(+Thumb),彎曲軸=骨局部 X、負=往掌心。
- **headless 測**(CDN 被 egress 擋):puppeteer `setRequestInterception` 把 r128 兩支 CDN 餵本地
  `npm i three-128@npm:three@0.128.0` 的檔案(`build/three.min.js` + `examples/js/loaders/GLTFLoader.js`,**記得 `access-control-allow-origin:*`**);
  SwiftShader flags 照根 CLAUDE.md;hook 用 `__ps`/`__psEquip`;斷言 0 pageerror + 實際滑鼠拖曳/滾輪。
- **驗收一個改動**:`node --check` 各改過的檔(古典 script 直接查)→ headless 開頁 0 錯誤 → 動到掛載/姿勢就截圖眼看。

## 匯出 → 遊戲對照

| studio 匯出 | 遊戲端落點 | 對齊規則 |
|---|---|---|
| 動作 clip JSON | `js/brawler-clips.js` CLIPS | impact 幀÷60 = `v2-state.js STRIKE_DELAY` / `ITEM_SPEC.delay` |
| 對位 JSON(`#partExportCfg`)| 裝備 `EQUIP_CAL`(遊戲掛載器用)| slot 同名;scale/位移/旋轉照搬 |
| 手勢 JSON(`#handPoseExport`)| `HAND_POSES`(actor 手勢插值用)| 骨局部 X 角度(度),負=握 |
