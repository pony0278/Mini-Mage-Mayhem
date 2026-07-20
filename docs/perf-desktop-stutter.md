# 桌機卡頓診斷(2026-07-20;症狀:初始移動卡頓+特定位置卡頓)

> 方法:headless 儀器化探針(scratchpad `stutter_probe2/3.mjs`,走 render-core `__gl` hook)——
> 每幀 shader 編譯事件 / draw calls / transmission 視錐普查 / GLTF parse 主執行緒計時 / heap 取樣 / 燈分佈。
> SwiftShader 絕對時間不可信,以下全部用**結構性訊號**(可移植到真 GPU)。

## 已排除(量測否定)

| 嫌疑 | 證據 |
|---|---|
| ~~建模檔案太大~~ | 全部資產很小:pod 820KB、avatar 396KB、three.js 596KB;52MB 的 `assets/parts` 是 repo-only 不會載入 |
| ~~GC 突刺~~ | 配置速率僅 ~0.6MB/s、12s 內 GC 只回收 2 次——每幀重建 props/markers 的垃圾量無害 |
| ~~移動中 shader 編譯~~ | 全場走訪 0 次編譯事件(31 個 programs 開機即暖;但見下:**首次接近玻璃**在真機仍可能觸發 transmission 變體編譯) |
| 陰影(半排除) | render-core 預設關,但 **lab 主題重開**(桌機 key 光 2048² PCFSoft)——固定成本非位置突刺,暫留(視覺錨);再要擠預算時的下一刀 |
| ~~牆面淡出 raycast~~ | 每幀 7 條射線對牆列表,成本固定不隨位置突刺 |

## 定罪(兩個症狀、三個根因)

### A. 初始移動卡頓 = 開機非同步資產在「你開始動的那一刻」落地

`recycling-pod.glb`(818KB)的 `GLTFLoader.parse` **同步佔用主執行緒 119ms**(SwiftShader 膨脹值;
真桌機估 30–60ms=掉 2–4 幀),fetch+parse 完成時間點≈開場後 1–2 秒——正好是玩家第一次推 WASD。
換裝瞬間又觸發該批材質的首次渲染(program 連結+貼圖上傳)再補一刀。avatar/手模小(2–6ms),無罪。

### B. 特定位置卡頓 = transmission 玻璃的「整景第二趟」+ draw calls 翻倍

桌機 FX 全開=**13 面 transmission 玻璃**。three.js 只要視錐內有任一面,就**把整個場景多渲一趟**
(transmission RT pass,18 盞點光的片段成本 ×2)。玻璃集中在四角元素站+艙區:

- 走訪普查:近身 transmission 數 pod=3、北牆=9、東北站=**10**——玻璃入鏡數隨位置 1→10 大幅波動
- draw calls 同步從 220 → 434
- 首次走近玻璃簇=transmission shader 變體首編譯(真機一次性卡頓,對應「走到某些位置**突然**卡」)

### C. 底噪:18 盞點光全場常駐

three.js forward 渲染**不做光源剔除**——18 盞點光寫死在每個 Standard 材質的 shader 裡,
每個像素每幀都算 18 盞(含 transmission pass 再算一次)。角落燈簇 4–6 盞/角。
這是整體幀成本的地板,墊高後 A/B 的突刺才會頂破 16.6ms 預算被感知。

## 修復(2026-07-20 使用者拍板前三項,build perf-1 已實施)

1. ✅ **開機預熱**(修 A):建場尾+pod GLB 換裝後各 `renderer.compile(scene, camera)` 一次——
   全部 shader 在載入期預編譯,首次入鏡零編譯。parse 的同步 block 仍在(r149 無 worker 路徑),
   但落在 intro 期間+不再疊加編譯=感知大減。
2. ✅ **玻璃 transmission 全平台退役**(修 B 主力):`M.glass` transmission 0.6→0——整景第二趟消失;
   風格化玻璃(透明+emissive)為既有手機外觀,已驗證讀得出。
3. ✅ **裝飾點光退役**(修 C):`decoLight` 恆 null(站身/邊緣 12 盞下場),四角元素底光 0.95→1.35、
   範圍 11→13 補償;全場點光 18→6。
4. (備選未做)桌機 dpr 夾 1.5(現 2)、lab 陰影降 1024/關——再要擠預算時的下一刀。

## 量測工具(重跑用)

- `render-core` 的 `window.__gl = { renderer, info() }` debug hook(本次新增,正式保留)
- scratchpad `stutter_probe2.mjs`(分區幀普查)/`stutter_probe3.mjs`(parse/heap/燈)
- 真機驗證:DevTools Performance 錄一段「開場即動」+「走向東北站」,對照上表定位
