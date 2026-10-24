#!/usr/bin/env node
// Bake Mixamo clips onto the Strong Knight skeleton.
//
//   node scripts/retarget-mixamo.mjs <dir-of-converted-glb> [out.json]
//
// Input: Mixamo "Without Skin" FBX converted to GLB (FBX2glTF -b), one clip per
// file, named by game role (idle, walk, run, slash1..3, heavy, block, roll, hit,
// death). Output: per-frame LOCAL rotations for the knight's bones, in the
// knight GLB's own (raw glTF) node space, so the runtime only assigns
// quaternions — no retargeting math in the game.
//
// Method: the rigs rest in different poses (Mixamo T-pose, knight A-pose), so
// first build a knight "T-pose" by rotating each knight bone (top-down) until it
// points the same way as its Mixamo counterpart at rest. Then each frame, every
// mapped bone takes its Mixamo world-space rotation delta from rest and applies
// it to that T-pose; locals follow from the parent chain. Both rigs are +Y up,
// facing +Z, left = +X in raw glTF, so no frame alignment is needed.
import fs from "node:fs";
import path from "node:path";

// ---------- tiny quaternion kit (Hamilton, [x,y,z,w]) ----------
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = q => [-q[0], -q[1], -q[2], q[3]];
const qnorm = q => { const l = Math.hypot(...q) || 1; return q.map(x => x / l); };
const qrot = (q, v) => { const r = qmul(qmul(q, [...v, 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const vnorm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function fromTo(a, b) {
  a = vnorm(a); b = vnorm(b);
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) { const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = vnorm([a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]]); return [...c, 0]; }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return qnorm([...c, 1 + d]);
}
// rotation part of a column-major glTF matrix (assumes uniform-ish scale)
function quatFromMatrix(m) {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  // r is column-major 3x3: r[col*3+row]
  const m00 = r[0], m11 = r[4], m22 = r[8], m21 = r[5], m12 = r[7], m02 = r[6], m20 = r[2], m10 = r[1], m01 = r[3];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return qnorm(q);
}

// ---------- glTF reading ----------
function readGlb(p) {
  const b = fs.readFileSync(p); const jl = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + jl)), bin: b.subarray(20 + jl + 8) };
}
function accessor({ json, bin }, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(bin.buffer.slice(off, off + a.count * n * 4));
}
/** node rig: local rest rotation/translation, parents, name lookup */
function rig(g) {
  const nodes = g.json.nodes;
  const parent = []; nodes.forEach((n, i) => (n.children ?? []).forEach(c => (parent[c] = i)));
  const rot = nodes.map(n => n.matrix ? quatFromMatrix(n.matrix) : (n.rotation ?? [0, 0, 0, 1]));
  const pos = nodes.map(n => n.matrix ? [n.matrix[12], n.matrix[13], n.matrix[14]] : (n.translation ?? [0, 0, 0]));
  const find = suffix => { const i = nodes.findIndex(n => n.name === suffix || n.name.endsWith(":" + suffix) || n.name.startsWith(suffix)); if (i < 0) throw new Error("missing bone " + suffix); return i; };
  return { nodes, parent, rot, pos, find };
}
/** world rotations + positions for a set of local rotations (positions only for direction use) */
function solve(r, localRot) {
  const W = [], P = [];
  const get = i => {
    if (W[i]) return;
    const p = r.parent[i];
    if (p === undefined) { W[i] = localRot[i]; P[i] = r.pos[i]; return; }
    get(p);
    W[i] = qmul(W[p], localRot[i]);
    const off = qrot(W[p], r.pos[i]);
    P[i] = [P[p][0] + off[0], P[p][1] + off[1], P[p][2] + off[2]];
  };
  r.nodes.forEach((_, i) => get(i));
  return { W, P };
}

// knight bone ← mixamo bone, with the child joints that define each bone's direction
const MAP = [
  ["hips_", "Hips", null, null],
  ["spine_", "Spine1", ["chest_", "Spine2"]],
  ["chest_", "Spine2", ["neck_", "Neck"]],
  ["neck_", "Neck", ["head_", "Head"]],
  ["head_", "Head", null],
  ...["L", "R"].flatMap(s => {
    const m = s === "L" ? "Left" : "Right";
    return [
      [`${s}_shoulder_`, `${m}Shoulder`, [`${s}_arm_`, `${m}Arm`]],
      [`${s}_arm_`, `${m}Arm`, [`${s}_elbow_`, `${m}ForeArm`]],
      [`${s}_elbow_`, `${m}ForeArm`, [`${s}_wrist_`, `${m}Hand`]],
      [`${s}_wrist_`, `${m}Hand`, [`${s}_middle1_`, `${m}HandMiddle1`]],
      [`${s}_leg_`, `${m}UpLeg`, [`${s}_knee_`, `${m}Leg`]],
      [`${s}_knee_`, `${m}Leg`, [`${s}_anke_`, `${m}Foot`]],
      [`${s}_anke_`, `${m}Foot`, [`${s}_foot_`, `${m}ToeBase`]],
    ];
  }),
];

const [, , inDir, outFile = "public/character-prototype/knight-anims.json"] = process.argv;
if (!inDir) { console.error("usage: retarget-mixamo.mjs <dir-of-glb> [out.json]"); process.exit(1); }

const knight = rig(readGlb("public/character-prototype/knight.glb"));
const kIdx = MAP.map(([k]) => knight.find(k));
const kChild = MAP.map(([, , c]) => (c ? knight.find(c[0]) : -1));
const kRest = solve(knight, knight.rot);
const kHipHeight = kRest.P[kIdx[0]][1] - Math.min(kRest.P[knight.find("L_anke_")][1], kRest.P[knight.find("R_anke_")][1]);

const clips = {};
let mixamoT = null; // knight T-pose world rotations (built from the first clip's rest)
for (const file of fs.readdirSync(inDir).filter(f => f.endsWith(".glb")).sort()) {
  const g = readGlb(path.join(inDir, file));
  const mx = rig(g);
  const mIdx = MAP.map(([, m]) => mx.find("mixamorig:" + m));
  const mChild = MAP.map(([, , c]) => (c ? mx.find("mixamorig:" + c[1]) : -1));
  const mRest = solve(mx, mx.rot);

  if (!mixamoT) {
    // knight T-pose: top-down, swing each mapped bone onto the Mixamo rest direction
    const local = knight.rot.map(q => [...q]);
    for (let k = 0; k < MAP.length; k++) {
      if (kChild[k] < 0) continue;
      const cur = solve(knight, local);
      const i = kIdx[k];
      const dk = vsub(cur.P[kChild[k]], cur.P[i]);
      const dm = vsub(mRest.P[mChild[k]], mRest.P[mIdx[k]]);
      const want = qmul(fromTo(dk, dm), cur.W[i]);
      const pw = knight.parent[i] === undefined ? [0, 0, 0, 1] : cur.W[knight.parent[i]];
      local[i] = qnorm(qmul(qinv(pw), want));
    }
    mixamoT = solve(knight, local).W;
  }

  // sample every channel at the hips track's key times (FBX2glTF bakes all channels together)
  const anim = g.json.animations[0];
  const tracks = new Map();
  let times = null;
  let hipsPos = null;
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const out = accessor(g, s.output);
    if (ch.target.path === "rotation") tracks.set(ch.target.node, out);
    if (ch.target.path === "translation" && ch.target.node === mIdx[0]) hipsPos = out;
    if (ch.target.node === mIdx[0] && ch.target.path === "rotation") times = accessor(g, s.input);
  }
  const frames = times.length;
  const restHipY = mx.pos[mIdx[0]][1];
  const mHipHeight = mRest.P[mIdx[0]][1] - Math.min(mRest.P[mx.find("mixamorig:LeftFoot")][1], mRest.P[mx.find("mixamorig:RightFoot")][1]);
  const q = [], hipsY = [], hand = [];
  const mHand = mx.find("mixamorig:RightHand");
  for (let f = 0; f < frames; f++) {
    const local = mx.rot.map((r, i) => { const t = tracks.get(i); return t ? qnorm([t[f * 4], t[f * 4 + 1], t[f * 4 + 2], t[f * 4 + 3]]) : r; });
    const ms = solve(mx, local);
    const mw = ms.W;
    hand.push(ms.P[mHand]);
    // knight chain at this frame: mapped bones get delta·Tpose, the rest keep rest locals
    const kLocal = knight.rot.map(r => [...r]);
    const kWorld = [];
    const worldOf = i => {
      if (kWorld[i]) return kWorld[i];
      const p = knight.parent[i];
      return (kWorld[i] = p === undefined ? kLocal[i] : qmul(worldOf(p), kLocal[i]));
    };
    for (let k = 0; k < MAP.length; k++) {
      const delta = qmul(mw[mIdx[k]], qinv(mRest.W[mIdx[k]]));
      const target = qmul(delta, mixamoT[kIdx[k]]);
      const p = knight.parent[kIdx[k]];
      kLocal[kIdx[k]] = qnorm(qmul(qinv(p === undefined ? [0, 0, 0, 1] : worldOf(p)), target));
      kWorld.length = 0; // parents changed: recompute lazily
    }
    for (const i of kIdx) q.push(...kLocal[i].map(x => Math.round(x * 1e4) / 1e4));
    // in-place clips keep their vertical bob; express it as a fraction of hip height
    const y = hipsPos ? hipsPos[f * 3 + 1] : restHipY;
    const parentScale = mRest.P[mIdx[0]][1] / (restHipY || 1);
    hipsY.push(Math.round(((y - restHipY) * parentScale / mHipHeight) * 1e4) / 1e4);
  }
  const name = path.basename(file, ".glb");
  // weapon-hand speed marks the action: contact = fastest frame, start/end where it
  // rises above / settles below a fraction of that (attack clips get remapped to
  // the gameplay swing timing around these frames)
  const speed = hand.map((p, f) => (f === 0 ? 0 : Math.hypot(...vsub(p, hand[f - 1]))));
  const contact = speed.indexOf(Math.max(...speed));
  let start = contact; while (start > 0 && speed[start - 1] > speed[contact] * 0.12) start--;
  let end = contact; while (end < frames - 1 && speed[end + 1] > speed[contact] * 0.12) end++;
  clips[name] = { frames, duration: +(times[frames - 1] - times[0]).toFixed(4), start: Math.max(0, start - 3), contact, end: Math.min(frames - 1, end + 3), q, hipsY };
  console.log(`${name}: ${frames} frames, ${clips[name].duration}s, action ${clips[name].start}→${contact}→${clips[name].end}`);
}

fs.writeFileSync(outFile, JSON.stringify({
  source: "Mixamo (Adobe) animations retargeted to Strong Knight by scripts/retarget-mixamo.mjs",
  fps: 30, bones: MAP.map(([k]) => k), hipHeight: +kHipHeight.toFixed(3), clips,
}));
console.log("wrote", outFile, (fs.statSync(outFile).size / 1024).toFixed(0) + "KB");
