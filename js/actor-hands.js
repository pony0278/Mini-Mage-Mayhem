// actor-hands.js — 載入使用者的手部 GLB(assets/rigs/chibi-hands.glb):
// 握拳(grip=HandGrip)/張開(open=Hand)兩態、左右各一。actor-brawler 在「扛人/丟人」時
// 把手腕的方塊拳套換成這些手模;其餘狀態維持拳套。純 render 層(不 import sim)。
// 頂點色保留(不染隊伍色,依玩家指定)。需 vendor/GLTFLoader.js(全域 THREE.GLTFLoader)。
const HANDS_URL = 'assets/rigs/chibi-hands.glb';
let state = 0;                 // 0=未載 1=載入中 2=就緒 3=失敗
const meshes = {};             // 'grip.L' | 'grip.R' | 'open.L' | 'open.R' → THREE.Mesh(原始,clone 給用)

export function handsReady() { return state === 2; }

// GLTFLoader 會把節點名的點去掉:geo_Hand.L.002→geo_HandL、grip_socket.L→grip_socketL
const MESH_MAP = { geo_HandL: ['open', 'L'], geo_HandR: ['open', 'R'], geo_HandGripL: ['grip', 'L'], geo_HandGripR: ['grip', 'R'] };

export function preloadHands() {
  if (state !== 0) return;
  state = 1;
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { state = 3; console.warn('[hands] GLTFLoader 未載入'); return; }
  fetch(HANDS_URL).then(r => r.arrayBuffer())
    .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
    .then(gltf => {
      const sc = gltf.scene; sc.updateWorldMatrix(true, true);
      // 抓 grip_socket 世界位置:把手模的手腕接點對齊到原點,掛上 wr 時 grip/open 才會一致
      const sock = {};
      sc.traverse(o => {
        if (o.name === 'grip_socketL') sock.L = o.getWorldPosition(new THREE.Vector3());
        else if (o.name === 'grip_socketR') sock.R = o.getWorldPosition(new THREE.Vector3());
      });
      sc.traverse(o => {
        if (!o.isMesh || !MESH_MAP[o.name]) return;
        const [kind, side] = MESH_MAP[o.name];
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);                    // 烘焙節點變換 → body 座標
        const s = sock[side] || new THREE.Vector3();
        geo.translate(-s.x, -s.y, -s.z);                    // socket → 原點
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 }); // 頂點色原色,不染隊伍
        meshes[`${kind}.${side}`] = new THREE.Mesh(geo, mat);
      });
      state = Object.keys(meshes).length === 4 ? 2 : 3;
      if (state !== 2) console.warn('[hands] 網格不齊,只找到', Object.keys(meshes));
      if (typeof window !== 'undefined') window.__hands = { ready: handsReady, keys: () => Object.keys(meshes), state: () => state };
    })
    .catch(e => { state = 3; console.warn('[hands] 載入失敗', e); });
}

// kind:'grip'|'open', side:'L'|'R' → 一份可掛載的 clone(socket 在原點,body 單位)
export function getHandMesh(kind, side) {
  const m = meshes[`${kind}.${side}`];
  return m ? new THREE.Mesh(m.geometry, m.material) : null;
}
