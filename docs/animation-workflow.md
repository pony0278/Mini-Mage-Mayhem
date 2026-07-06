# 動作工作流(PUNCH STUDIO → 遊戲)

> 上游還有一站:第三方工具產的**整塊模型**先用 [`tools/mesh-part-extractor.html`](../tools/mesh-part-extractor.html)
> 圈選拆部位 → **「匯出規範 GLB」**(原點=接縫圓心/+Y=遠端/+Z=正面/命名=slot,對規格自動檢查)→
> PUNCH STUDIO 掛載。完整管線:**Extractor(切+規範化)→ PUNCH STUDIO(掛+編動作)→ 遊戲(JSON 接入)**。
> 部位建模約定與規格表見 [part-authoring.md](part-authoring.md)。
> 注意:給 PUNCH STUDIO 的部位一律走「匯出規範 GLB」,**不要**用「分檔匯出」(那會保留世界位置);
> **抽取前先用「模型方向(擺正)」面板把模型轉到面向 +Z、頭朝上**(規範匯出的正面寫死世界 +Z,
> 第三方模型常見 Z-up 或面向 -Z,不擺正則所有部位匯出後朝向全錯);規格檢查全面同比例偏離=尺度
> 問題(縮放係數=規格半徑÷實測半徑)。
> **對稱部位只切一側**:規範匯出勾「同時匯出鏡像側」→ 一刀產左右一對,接縫數學上完全一致
> (15 件只要圈 9 次)。貼圖會左右翻轉,有文字/徽章的部位取消勾選改手動雙側。

> v2 小人的招式動作**不寫程式**:在動作編排器裡編 → JSON 匯出 → 貼進 `js/brawler-clips.js` 的
> `CLIPS`。骨架與播放器已移植為同構(`js/actor-brawler.js`),編排器裡看到的姿勢=遊戲裡的姿勢。
> 唯一的耦合點是 **impact 影格 ↔ 傷害判定時刻**(§4)。

## 1. 工具

- **編排器本體**:[`tools/punch-studio.html`](../tools/punch-studio.html)(repo 內收藏版;開發工具,不隨遊戲部署)。
  **線上即開**:Vercel 正式網址的 `/tools/punch-studio`
  (它從 CDN 載 three r128 + Google Fonts,需要網路;與遊戲 vendored r149 無關、互不影響)。
  JS 主體拆檔在 [`tools/ps/`](../tools/ps/)——古典 script 共享全域、依 HTML 順序載入;
  改碼唯一規則(每檔 hoisting:載入期程式不得前向呼叫後面的檔案)見 `tools/ps/README.md`。
- 內建:47 軸姿勢 slider、自由時間軸(拖 key 調 timing)、per-limb LAG、打擊感試打台(hitstop/震動/沙包)、
  JSON 匯出/匯入、CANCEL 點 combo 串接、GLB 部位替換(整包 bundle 或分檔,按節點/檔名對應 15 slot)。
- **基底角色(rigged avatar,預設)**:punch-studio 開機自動掛載 `assets/rigs/base-avatar.glb`
  ——**未來所有角色的基座**。原理:素體照常被 47 軸驅動(隱藏),每幀把各關節「相對 T-pose
  的世界旋轉差量」轉寫到角色骨頭(`tools/ps/avatar.js`),蹲下/踩地/接觸鎖全部自動繼承。
  **角色基座慣例**(照做即可丟進「👤 載入角色 GLB」直接用):16 骨、命名含
  Root/Torso/Neck/Head/UpperArm/Forearm/Hand/Thigh/Shin(Calf)/Foot+L/R 字樣、rest=T-pose、
  面向 +Z、網格=骨頭的剛體子節點(不蒙皮;Bone 或空節點皆可)、比例任意(自動縮放;
  左右以世界 X 判定,不信名字)。
  **「腳踝跟隨」滑桿**(角色列):0=腳鎖死跟小腿、1=完全吃編排器腳踝壓平。高筒靴角色
  (靴身在 Shin 骨、鞋頭在 Foot 骨,接縫重疊小)腳踝轉太多會在接縫開口——建議 0.2~0.4
  (基底角色預設 0.35);短鞋+裸踝的角色可以拉高。偏好記進 localStorage。
  **「關節填充」開關**(角色列,預設開):剛體部位骨架的關節在大角度旋轉時會露出樞紐周圍
  的空殼(部件近端是平蓋、非以樞紐為圓心的球)。開啟後每個關節(肩/肘/腕/髖/膝/踝/頸)在
  樞紐處生一顆低模球——以樞紐為圓心 → 旋轉不變 → 永不露縫;半徑實測該部件近端橫截半徑、
  顏色取該部件近端頂點色、掛在骨頭 local 原點。對**任何**剛體角色免費生效,零重新建模。
  「球大小」全域滑桿定總體基準;「逐關節微調」可折疊面板有 13 個倍率滑桿(左右可不同,
  0=關掉該關節)疊在全域上,對付單一腫/縫關節。半徑與顏色只在 rest(T-pose)量一次快取
  (含骨頭世界縮放——live decompose 會隨姿勢漂移),拉滑桿不重掃幾何、pose 彎曲不影響。
  想要藝術品質更高的關節,可在建模端把部件近端做成以樞紐為圓心的半球(球關節帽)取代之。
- **退路人偶**:基底角色缺席時自動退回 `meshy-mannequin.glb`(13 部位掛載),再缺退內建素體。
  拿到新的 Meshy 分件模型時用 `tools/meshy-convert.mjs` 重產。
- **「遊戲整合」面板**(repo 版加掛):
  - **招式庫**——具名槽存/載/刪(localStorage),編一整套招式不互相覆蓋;「全部匯出」產生
    `{clips:{招式名:snapshot}}` 一份 JSON,整份交給遊戲端接入。
  - **🎮 遊戲視角**——一鍵切到遊戲取景(fov32/俯角44°/看角色背面)驗動作在實戰鏡頭下的可讀性。
  - **impact 秒數讀出**——`frame÷60` 即時顯示,就是遊戲 `STRIKE_DELAY` 要填的值。

## 2. 工作流(五步)

1. 編排器裡編動作(建議從內建 preset 出發改)
2. 「JSON」匯出 → 複製整份 snapshot
3. 貼進 `js/brawler-clips.js` 對應的 `CLIPS` entry:`prepClip({ ...貼這裡... })`
   (或直接把 JSON 貼給 Claude 並說明是哪個招式)
4. 若 **impact key 的 frame 位置變了** → 同步改 `js/v2-state.js` 的 `STRIKE_DELAY`(§4)
5. 重新整理 v2.html 驗證(或跑 headless 姿勢截圖)

## 3. 資料格式(編排器 JSON snapshot)

```
{ seq:   [{ name, frame, ease, impact, cancel }...],   // 時間軸(frame @60fps;seq[0]=idle,frame 0)
  phases:{ name: { 47 軸姿勢... } },                    // 每個 key 的姿勢
  lags:  { aL, aR, lL, lR } }                           // per-limb 跟隨延遲(0..1;impact 段自動歸零)
```
- 每個 key = 一段「前一 key → 此 key」的過渡;`ease` = `in`/`out`/`lin`。
- 播放完最後一個 key 後,自動用 `seq[0].frames` 的時長收回 idle(戰鬥站姿)。
- `poseKeys`/`dim`/`version` 等其餘欄位遊戲端忽略(DIM 角色比例由遊戲的 `BRAWLER_SPEC` 決定)。

## 4. ⚠ impact 影格 ↔ STRIKE_DELAY 對齊(唯一要記的規則)

傷害判定在**模擬層**(`v2-combat.js`):點擊=起手,`STRIKE_DELAY[段數]` 秒後才判定命中;
動作在**渲染層**播 clip。兩邊靠「約定」對齊,不靠 import(sim 保持 headless):

```
STRIKE_DELAY[段] ≈ clip impact key 的 frame ÷ 60
```
- 現值(使用者自編三連擊):`rhook` 0.283(@17f)、`lhook` 0.333(@20f)、`overhand` 0.383(@23f)。
- 你把 impact key 拖到別的 frame → `js/v2-state.js` 的 `STRIKE_DELAY` 跟著改,否則「看到打中」和「實際掉血」會脫節。
- 起手中被打暈/被抓/被推開踉蹌 → 打擊取消(格擋推開=真反制),這由模擬層守衛,動作資料不用管。

## 5. 招式插槽(現有 CLIPS)

| CLIPS key | 遊戲觸發 | 狀態 |
|---|---|---|
| `rhook` | 三連擊第 1 段(右鉤拳) | ✅ 使用者 PUNCH STUDIO 定稿(impact @17f=0.283s) |
| `lhook` | 三連擊第 2 段(左鉤拳) | ✅ 使用者定稿(impact @20f=0.333s) |
| `overhand` | 三連擊第 3 段(過頂重擊=終結技);**投擲暫借用** | ✅ 使用者定稿(impact @23f=0.383s);投擲仍待專屬過肩摔 clip |

新招式=新 entry + 在 `actor-brawler.js` 的 `PUNCH_CLIPS` / 狀態機掛上觸發。

## 6. 軸支援表(47 軸在遊戲端的落地)

| 軸 | 遊戲端 |
|---|---|
| `root_x/y`(根旋轉)、`root_py/pz`(升降/前移)、`sq`(擠壓)、`body_scale`、`squat` | ✅ 全支援(位移軸 ×25px/編排器單位) |
| `spine_x/y`、`pelvis_y`、`head_x/y/pz` | ✅ |
| 肩 `sx/sy/sz`、肘 `ex`、腕 `wx/wy`、`aX_idle`、`aX_scale`(命中放大:前臂+拳,繞肘) | ✅ box+avatar 皆生效 |
| 髖 `hx/hy/hz`、膝 `kx`、`lX_idle`、`lX_scale`(命中放大:小腿+腳,繞膝) | ✅ box+avatar 皆生效 |
| `aX_stretch`/`lX_stretch`(整肢從肩/髖等比伸展;遠鏡頭伸手更明顯,1=原長) | ✅ box+avatar 皆生效(踩地自動補償腿長) |
| `lX_contact`(接觸鎖) | ✅ 吃進自動踩地(2=該腿不當地面錨點) |
| 踝 `ax`、腳尖 `ty` | ❌ 忽略(遊戲小人沒有腳掌;編動作時不用調) |

## 7. 驗證協定

- 快看:本地 `python3 -m http.server 8099` → `v2.html?fx=low` 實際出拳。
- headless 姿勢截圖:scratchpad 的 `animclose.mjs` 模式(拉近鏡頭,分別截 anti/impact/stun)。
- 判定時序:`anim.mjs` 模式(按下不掉血 → impact 掉血;起手被暈=取消)。
- 改了 clip 後至少跑三連擊回歸(`combo.mjs` 模式;注意 SwiftShader ≈4 倍慢動作,等待要抓 impact 之後)。
