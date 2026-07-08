// punch-studio — sockets-data:接縫規格快照(sockets.json v0.5.5)。
// 從 punch-studio.html 的內嵌 <script type="application/json"> 抽出(HTML shell 瘦身 −585 行)。
// 古典 script:宣告一個共享全域 SOCKETS_JSON_RAW,parts.js 的 readSocketsJson() 同步讀取。
// 保持「同步載入」語意(不用 fetch)→ 零 async 改動、file:// 仍可直接開。載入順序在 parts.js 之前。
// 這是 punch-studio 私有快照(唯一真相);改接縫規格改這裡。
const SOCKETS_JSON_RAW =
{
 "schema": "tactics5x5.sockets",
 "version": "0.5.5",
 "_about": "Single source of truth for the modular character. v0.3: seam_table radii RESET from real skeleton-mesh joint cross-sections (the skeleton mesh is the final playable character); proc-hand auto-rescales to the new wrist seam via the v4 generator. socket_to_bone (13 sockets) + rest_length + load_bearing as in v0.2. collar/neck pending neckPivot.",
 "_targets_rig": "skeleton-skeleton (Blender). .L = char +X (anatomical left), .R = char -X.",
 "conventions": {
  "units": "world",
  "author_space": {
   "proximal_seam_at": "origin",
   "bone_axis": "+Y",
   "front": "+Z",
   "_note": "Every part is modelled in its own socket-local space using THIS convention, regardless of the runtime bone orientation."
  },
  "runtime_front": "-Y",
  "_rig_space": "rig armature is Z-up (Blender); character faces -Y. socket_to_bone below is expressed in BONE-LOCAL space so it survives animation.",
  "mount_model": {
   "part_to_socket": "identity",
   "socket_to_bone": "FILLED in v0.2 (was null). Bone-local rotation that maps author space (+Y bone axis / +Z front) onto each bone's rest frame, absorbing the bone roll. Translation = bone head (part proximal seam sits there), so mount offset -> 0. Stored per-socket as sockets[].socket_to_bone.rot_euler_deg.",
   "scale": "parts authored at world scale -> object scale 1.0 -> mount.scale = 1.0. The legacy 0.24 is retired (it was pipeline residue, same as the -175 roll)."
  },
  "length_model": {
   "_note": "Segment length is a SEPARATE axis from joint radius. Radius interchange = seam_table; length integrity = this.",
   "rest_length": "per-socket default span of the child_part = rig bone length (canonicalized, see _rig_audit). Author the part to this and it is drop-in.",
   "part_length_override": "OPTIONAL part field. Omit = use socket.rest_length. If present AND socket.load_bearing == true, assembly re-seats the child socket (and its sub-chain) to this length. If the socket is terminal (load_bearing == false), length is purely cosmetic mesh extent and re-seats nothing (giant fists/feet are free).",
   "load_bearing": "true when the child_part has a distal socket (intermediate segment); false for terminal parts (hand/foot/head). Derivable from the contract; stored explicitly so runtime need not recompute."
  },
  "lr": {
   "_note": "contract _l = screen-left = char -X = rig .R side ; _r = screen-right = char +X = rig .L. So socket ids use contract naming but bind to the OPPOSITE-letter rig bone.",
   "map": {
    "_l": "rig .R",
    "_r": "rig .L"
   }
  },
  "chirality_rule": "generator picks the hand/limb mirror_sign from sign(anchor_bone.head.x): x>0 -> mirror_sign=-1 ; x<0 -> mirror_sign=+1. Chirality follows the PHYSICAL bone side, never the _l/_r label. VALIDATED against live rig (hand.L head.x=+0.579 -> -1 ; hand.R head.x=-0.574 -> +1)."
 },
 "compatibility": {
  "rule": "compatible = classMatch AND seamFit",
  "classMatch": "a.class == b.class || a.class == 'universal' || b.class == 'universal'",
  "seamFit": "abs(part.radius - socket.radius) <= 0.10 * socket.radius",
  "_note": "universal bypasses the class test only; it still must pass seamFit. Length is NOT part of compatibility; it is handled by length_model (re-seat) at assembly time."
 },
 "gender_convention": {
  "child_distal": "male (plug)",
  "parent_proximal": "female (receptacle)",
  "torso_root": "none (screws into spine, no mate)"
 },
 "seam_table": {
  "_note": "world units. v0.3: radii RESET from real skeleton-mesh joint cross-sections (median, per vertex group). See _seam_audit. depth unchanged (connector design, not limb-derived; may need revisiting on thin limbs).",
  "neck": {
   "radius": 0.047,
   "depth": 0.03,
   "_note": "neck top <-> skull base (back-centre, spine-aligned). v0.4.1.",
   "_measured": "r_mean 0.056 @ z=0.975 (head bottom)"
  },
  "shoulder": {
   "radius": 0.05,
   "depth": 0.04,
   "_measured": "median 0.0499 n=36"
  },
  "elbow": {
   "radius": 0.022,
   "depth": 0.04,
   "_note": "armguard overlay shares this",
   "_measured": "median 0.0217 n=10"
  },
  "wrist": {
   "radius": 0.037,
   "depth": 0.04,
   "_note": "drives proc-hand scale via v4 generator",
   "_measured": "forearm distal median 0.0371 n=8 (old hand region masked)"
  },
  "collar": {
   "radius": 0.035,
   "depth": 0.04,
   "_note": "torso-top <-> neck-base. v0.4: measured from mesh xsec at z~0.89 (neck base pinch).",
   "_measured": "r_mean 0.035 @ z=0.88"
  },
  "hip": {
   "radius": 0.03,
   "depth": 0.045,
   "_measured": "median 0.0301 n=35"
  },
  "knee": {
   "radius": 0.025,
   "depth": 0.045,
   "_measured": "median 0.0246 n=57"
  },
  "ankle": {
   "radius": 0.042,
   "depth": 0.04,
   "_note": "historic 'ankle==wrist' swap now differs ~13% (wrist 0.037); unify to ~0.040 if hand/foot interchange is wanted",
   "_measured": "median 0.0418 n=20"
  },
  "universal": {
   "radius": "any",
   "depth": "any"
  },
  "_standard": "These radii ARE the canonical seam standard referenced by seam_standard. Author new parts to them."
 },
 "sockets": [
  {
   "socket_id": "neck",
   "class": "neck",
   "child_part": "head",
   "bone": "head",
   "seam_ref": "neck",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     0.0,
     0.0
    ]
   },
   "rest_length": 0.2297,
   "load_bearing": false
  },
  {
   "socket_id": "collar",
   "class": "collar",
   "child_part": "neck",
   "bone": "neckPivot",
   "seam_ref": "collar",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     0.0,
     0.0
    ]
   },
   "rest_length": 0.0563,
   "load_bearing": true
  },
  {
   "socket_id": "shoulder.l",
   "class": "shoulder",
   "child_part": "upper_arm_l",
   "bone": "upperarm.R",
   "seam_ref": "shoulder",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     -90.0,
     0.0
    ]
   },
   "rest_length": 0.2456,
   "load_bearing": true
  },
  {
   "socket_id": "shoulder.r",
   "class": "shoulder",
   "child_part": "upper_arm_r",
   "bone": "upperarm.L",
   "seam_ref": "shoulder",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     91.05,
     0.0
    ]
   },
   "rest_length": 0.2456,
   "load_bearing": true
  },
  {
   "socket_id": "elbow.l",
   "class": "elbow",
   "child_part": "forearm_l",
   "bone": "lowerarm.R",
   "seam_ref": "elbow",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     -90.65,
     0.0
    ]
   },
   "rest_length": 0.2047,
   "load_bearing": true
  },
  {
   "socket_id": "elbow.r",
   "class": "elbow",
   "child_part": "forearm_r",
   "bone": "lowerarm.L",
   "seam_ref": "elbow",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     89.36,
     0.0
    ]
   },
   "rest_length": 0.2047,
   "load_bearing": true
  },
  {
   "socket_id": "wrist.l",
   "class": "wrist",
   "child_part": "hand_l",
   "bone": "hand.R",
   "seam_ref": "wrist",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     180.0,
     0.0
    ]
   },
   "rest_length": 0.0992,
   "load_bearing": false,
   "_note": "wrist uses the 'A' convention: socket_to_bone = bone_basis . Ry(180). Reproduces _legacy_fit_reference within ~5deg (residual was bone tilt, now in basis). Hand front (+Z author) faces ~down, NOT char-front -Y; this differs from limb parts."
  },
  {
   "socket_id": "wrist.r",
   "class": "wrist",
   "child_part": "hand_r",
   "bone": "hand.L",
   "seam_ref": "wrist",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     180.0,
     0.0
    ]
   },
   "rest_length": 0.0992,
   "load_bearing": false,
   "_note": "see wrist.l note."
  },
  {
   "socket_id": "hip.l",
   "class": "hip",
   "child_part": "thigh_l",
   "bone": "upperleg.R",
   "seam_ref": "hip",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     -87.81,
     0.0
    ]
   },
   "rest_length": 0.2332,
   "load_bearing": true
  },
  {
   "socket_id": "hip.r",
   "class": "hip",
   "child_part": "thigh_r",
   "bone": "upperleg.L",
   "seam_ref": "hip",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     88.15,
     0.0
    ]
   },
   "rest_length": 0.2332,
   "load_bearing": true
  },
  {
   "socket_id": "knee.l",
   "class": "knee",
   "child_part": "calf_l",
   "bone": "lowerleg.R",
   "seam_ref": "knee",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     -90.61,
     0.0
    ]
   },
   "rest_length": 0.2086,
   "load_bearing": true
  },
  {
   "socket_id": "knee.r",
   "class": "knee",
   "child_part": "calf_r",
   "bone": "lowerleg.L",
   "seam_ref": "knee",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     91.38,
     0.0
    ]
   },
   "rest_length": 0.2086,
   "load_bearing": true
  },
  {
   "socket_id": "ankle.l",
   "class": "ankle",
   "child_part": "foot_l",
   "bone": "foot.R",
   "seam_ref": "ankle",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     0.0,
     0.0
    ]
   },
   "rest_length": 0.1385,
   "load_bearing": false
  },
  {
   "socket_id": "ankle.r",
   "class": "ankle",
   "child_part": "foot_r",
   "bone": "foot.L",
   "seam_ref": "ankle",
   "socket_to_bone": {
    "space": "bone_local",
    "rot_euler_deg": [
     0.0,
     0.0,
     0.0
    ]
   },
   "rest_length": 0.1385,
   "load_bearing": false
  }
 ],
 "torso_root": {
  "part": "torso",
  "bone": "belly",
  "gender": "none",
  "_note": "belly is the verified spine root (parent=None). chest parents belly; head parents chest (no neck bone yet)."
 },
 "equipment_mounts": [
  {
   "mount_id": "headgear",
   "bone": "head",
   "overlay_class": "helmet",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "_note": "頭戴道具(火帽/過熱核心噴火帽等);PS 掛 headPivot,對位用校準滑桿→匯出 EQUIP_CAL"
  },
  {
   "mount_id": "armguard.l",
   "bone": "lowerarm.R",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "overlay_class": "elbow",
   "_note": "overlay on forearm; shares elbow seam"
  },
  {
   "mount_id": "armguard.r",
   "bone": "lowerarm.L",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "overlay_class": "elbow"
  },
  {
   "mount_id": "cloak",
   "bone": "chest",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "_todo": "back-of-chest; placement TBD when asset exists"
  },
  {
   "mount_id": "pouch",
   "bone": "upperleg.L",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "_todo": "hip area; placement TBD"
  },
  {
   "mount_id": "bow",
   "bone": "chest",
   "transform": {
    "offset": [
     0,
     0,
     0
    ],
    "rot_euler_deg": [
     0,
     0,
     0
    ]
   },
   "_todo": "back-mounted; placement TBD"
  }
 ],
 "parts": [
  {
   "part_id": "hand.skeleton.relaxed.l",
   "anchor_bone": "hand.R",
   "proximal": {
    "mates_class": "wrist",
    "gender": "male",
    "radius": 0.037
   },
   "_source": "make_procedural_skeleton_hands_v3.py HAND_POSE=relaxed, physical side -X (mirror_sign=+1)"
  },
  {
   "part_id": "hand.skeleton.relaxed.r",
   "anchor_bone": "hand.L",
   "proximal": {
    "mates_class": "wrist",
    "gender": "male",
    "radius": 0.037
   },
   "_source": "v3 relaxed, physical side +X (mirror_sign=-1)"
  },
  {
   "part_id": "hand.skeleton.finger_gun.l",
   "anchor_bone": "hand.R",
   "proximal": {
    "mates_class": "wrist",
    "gender": "male",
    "radius": 0.037
   },
   "_source": "v3 finger_gun, -X"
  },
  {
   "part_id": "hand.skeleton.finger_gun.r",
   "anchor_bone": "hand.L",
   "proximal": {
    "mates_class": "wrist",
    "gender": "male",
    "radius": 0.037
   },
   "_source": "v3 finger_gun, +X"
  }
 ],
 "_rig_audit": {
  "_note": "Facts measured from the live skeleton-skeleton rig during v0.2 derivation. Provenance + cautions for downstream tools.",
  "armature": "skeleton-skeleton",
  "bone_count": 46,
  "up_axis": "+Z (Blender)",
  "front_axis": "-Y (face, toes point -Y)",
  "no_neck_bone": "head parents directly to chest. neckPivot must be inserted (handoff step 4) before collar can be filled.",
  "do_not_bind_bones": {
   "elbow.L, elbow.R, knee.L, knee.R": "ROOT-parented IK POLE TARGETS (sit far out at y~-0.5..-0.8), NOT joints. Joint sockets anchor on lowerarm/lowerleg. A string matcher must NOT grab 'elbow.*'/'knee.*'.",
   "arm.ik.L/R, foot.ik.L/R": "IK control bones (functional, do not delete).",
   "fingers.*, thumb.*, middlefinger.*, mouth, mouth_end, *_end": "legacy/leaf bones; PROC hands do not consume the finger bones."
  },
  "lr_asymmetry": {
   "_note": "rig was not perfectly symmetric. Handled as: roll fixed in-rig (orientation is bone-coupled), length canonicalized in this file (assembly metric, re-seat covers it).",
   "leg_roll_fixed_in_rig": "set L = -R for legs. lowerleg.L roll +98.010 -> +87.991 (-10.02deg, the knee outlier). upperleg.L +84.760 -> +85.518 (+0.76deg). Post-fix knee socket_to_bone symmetric within ~0.8deg.",
   "arm_roll_left_asis": "upperarm/lowerarm ~1deg asymmetric; intentionally NOT touched to protect the existing procedural-hand fit. ~1deg is negligible.",
   "rest_length_canonicalized": ".R-master. raw measured (L/R): upperarm 0.2456/0.2388, lowerarm 0.2047/0.2069, upperleg 0.2332/0.2351, lowerleg 0.2086/0.2184. Canonical used = the .R value for both sides.",
   "revert_rolls": "original leg rolls were upperleg.L=+84.760, lowerleg.L=+98.010 (deg) if a revert is ever needed."
  },
  "bone_count_v0.4": 47,
  "neckPivot": "inserted in v0.4 (was 46 bones, no neck)"
 },
 "_legacy_fit_reference": {
  "_note": "Pre-spec rigid fit of the v3 hand. v0.2: VALIDATED and superseded. The derived wrist socket_to_bone (clean bone_basis . Ry(180)) reproduces this orientation within ~5deg; the residual (~4.7deg L / ~5.8deg R) was the bone tilt, now living in the bone basis instead of a magic roll constant. Kept only as a record.",
  "wrist.r_bind_hand.L": {
   "scale": 0.24,
   "roll_deg": -175.277,
   "offset": [
    -0.0004,
    -0.0378,
    -0.00478
   ]
  },
  "wrist.l_bind_hand.R": {
   "scale": 0.24,
   "roll_deg": 174.176,
   "offset": [
    0.00049,
    -0.03823,
    -0.00478
   ]
  }
 },
 "next_steps": [
  "MAIN: integrate the assembled modular character (GLB bundle + sockets.json) into fight_demo_v0 runtime — drive parts off the rig at runtime",
  "bridge debugging: arm/leg flip-solution artifacts (lL_hz~160 deg) using the two logged test cases",
  "BODY STUDIO three-view scanning workflow for custom/alternate parts (hands solved procedurally, not blocking)",
  "make Punch Studio / MOCAP BRIDGE consume BODY STUDIO JSON; reconcile Punch Studio DIM skeleton with this rig",
  "optional: hand swap variants (finger_gun/open) to demo socket hot-swap; neck thickness tuning (cosmetic); rig L/R symmetrize (risky, affects fight_demo)"
 ],
 "_seam_audit": {
  "_note": "seam_table radii measured from the skeleton mesh (final character) at each joint plane, isolated by vertex group, median of perpendicular radii. Low poly => small n at thin joints => approximate.",
  "measured_median": {
   "shoulder": 0.0499,
   "elbow": 0.0217,
   "wrist_forearm_distal": 0.0371,
   "hip": 0.0301,
   "knee": 0.0246,
   "ankle": 0.0418
  },
  "previous_v0.2": {
   "shoulder": 0.06,
   "elbow": 0.05,
   "wrist": 0.045,
   "hip": 0.06,
   "knee": 0.055,
   "ankle": 0.045,
   "_note": "prior values were inherited from the chunky procedural hand, ~2x the real limbs at elbow/hip/knee"
  },
  "hand_rescale": "v4 generator drives hand scale = wrist_seam/0.18 => 0.037/0.18 = 0.206 (was 0.25); hand ~18% smaller, now flush with forearm.",
  "depth_caveat": "connector depths unchanged; on the now-thinner limbs a 0.040 depth is large relative to radius and may need reducing when the seam connectors are built."
 },
 "_neck_audit": {
  "neckPivot_inserted": true,
  "neckPivot": "head=(0,0,0.919)=chest.tail, tail=(0,0,0.975)=head.head, parent=chest, head reparented under it",
  "head_rest_unchanged": "max delta 0 after reparent; existing head mount unaffected",
  "neck_part": "PROCEDURAL spine-aligned tube: bottom(z0.88,y+0.015,r0.035) -> top(z0.978,y+0.005,r0.047), near-vertical along spine. Attaches at skull base back-centre near spine (y~0), NOT forward jaw. 96 verts watertight.",
  "collar_socket_to_bone": "[0,0,0] (neckPivot is straight +Z bone, same orientation as head/belly)",
  "bone_count": 47,
  "correction": "v0.4 first pass leaned top to y=-0.12 (jaw); corrected to spine line y~0 since skull base reaches back to y=0..+0.09."
 },
 "seam_standard": {
  "_purpose": "Authoring contract for swappable parts. Any part authored/scanned for a socket MUST build its seam ring(s) to this standard so parts interchange flush across bodies, with no retrofit needed.",
  "ring_geometry": "Each seam ring is a PLANAR CIRCLE: centred on the bone axis (socket-local X=0, Z=0), in the plane perpendicular to the bone axis (constant socket-local Y), radius = seam_table[class].radius.",
  "seam_planes": "proximal seam at socket-local Y=0 (bone head); distal seam (intermediate/load-bearing parts) at Y = rest_length (bone tail). +Y = bone axis, +Z = front.",
  "compliance": {
   "hands": "COMPLIANT & FINAL - v4 generator HAND_POSE=punch (finger_curl 88/100/74, thumb_curl 36/52/46, thumb_wrap 54), normalized to wrist 0.037. Tight white-knuckle fist; both hands. Other presets (open/relaxed/fist/finger_gun) available as swappable variants.",
   "neck": "COMPLIANT - procedural, built to collar 0.035 / neck 0.047.",
   "auto_split_body": "NOT retrofitted - head/torso/limb/foot are GetAmped-mesh auto-splits. Already flush within the same body (shared cut planes), but their seam rings are irregular bone cross-sections, not canonical circles. Rebuild to this standard when re-authored in the body-scanning workflow; do not retrofit."
  },
  "decision_v0.5": "Retrofit canonicalization DEFERRED. Evidence: (1) current assembly already flush; (2) source bones not centred in limbs (calf ~0.02 off bone axis); (3) head base naturally wide ~0.085 vs neck 0.047; (4) proximal/shoulder ends are non-planar cuts (unreliable to retrofit). Forcing axis-centred circles would distort limb ends + pinch the head for a swap capability not yet exercised. Standard is enforced at AUTHORING TIME instead."
 },
 "_history": [
  "v0.5: locked seam_standard as authoring contract; deferred retrofit canonicalization",
  "v0.5.1: hands regenerated as fist pose via v4 generator (born seam_standard-compliant); placeholder relaxed hands replaced",
  "v0.5.2: hand pose finalized as punch (tight fist) on both wrists; v4 generator default set to punch",
  "v0.5.3: L/R limb parts symmetrized (larger-volume side mirrored to other; faces flipped, proximal seam re-snapped to Y=0). thigh/calf assemble symmetric (err~0); arm/foot residual ~0.02-0.027 from RIG bone asymmetry (rig left unsymmetrized to protect fight_demo).",
  "v0.5.4: torso re-extracted as belly+chest + medial shoulder/hip caps (was narrow spine-column only). Fixes floating limbs: shoulder gap 0.09->0.01, hip 0.04->0.01. Ankle 0.03 was a heel-measurement artifact (real calf-distal->foot ~0.015).",
  "v0.5.5a: hand palm fixed — generator v5 replaces the thin trapezoid plate with add_palm_core (solid low-poly tapered elliptical tube, wrist 0.17x0.11 -> knuckle 0.24x0.085, Y -0.20..0.16, mat 1). Fills the hollow metacarpal region so the closed fist reads solid.",
  "v0.5.5b: ROOT CAUSE of hollow-palm-in-assembler found & fixed in tactics5x5_assembler.html (NOT a mesh issue). Old node-picker chose one child Mesh per slot; a multi-material hand (bone/joint/connector = 3 GLTF primitives -> Group + 3 child Meshes) lost the joint(palm core) + connector primitives. Fix: mount the SHALLOWEST matching node (the container Group) so all primitives render. Single-material body parts were unaffected (1 primitive)."
 ],
 "_part_state": {
  "symmetry": "Limb pairs (upper_arm/forearm/thigh/calf/foot) are exact mirror pairs at mesh level. Hands procedurally mirrored. Residual assembled asymmetry is rig-inherent, not part-level.",
  "torso": "belly+chest weight + shoulder/hip caps (upperarm/upperleg verts medial of joint plane, shoulder cap extended +0.035 to overlap arm). Reaches all 4 limb joints. Multi-island (vertebra stack) - intentional, no island filtering.",
  "hand": "punch pose, generator v5. wrist connector (mat2) + solid palm core (mat1, add_palm_core) + finger/thumb bones (mat0) + joints (mat1). normalize seam ring -> 0.037. L/R mirror via mirror_sign_for_bone.",
  "assembler": "tactics5x5_assembler.html: mounts whole container node per slot (all primitives). DoubleSide material. Reads sockets.json for mount; bone_rest x socket_to_bone reproduces Blender mount <=1e-6."
 }
};
