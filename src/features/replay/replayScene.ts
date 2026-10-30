import * as THREE from 'three';
import type {Opening, Plan, Vec2, Wall} from '../../model/types';
import {planBounds} from '../../model/geometry';
import {distToSegment, wallLength, wallPieces, withCorners} from '../../model/walls';
import {floorMaterial, furnitureObject} from '../view3d/models';
import {WALL_COLOR} from '../view3d/scene';
import {doorsOf} from '../view3d/walk';
import {floorLaying, layingCount, PLANK_ROW} from './floorLaying';
import {easeInOut, progress, type Timeline} from './timeline';

/**
 * 回放场景：一次性用 three.js 搭好全部物体（含拆掉的墙和新砌的墙），
 * 每帧按时间线 t 改变可见性、位置、旋转和着色器参数。不走 React 渲染，播放和逐帧导出都便宜。
 * 所有动画只依赖 t（伪随机按序号哈希），导出视频逐帧结果和播放一致。
 *
 * - 开场：交房时的墙从入户门开始一波波立起来
 * - 拆墙：整面标红，从上往下一块块砸落翻滚，最后清运
 * - 砌墙：200 mm 一皮往上砌，每皮沿墙长伸长，相邻两皮反向
 * - 刷墙：着色器里按离入户门的距离延迟、从下往上刷
 * - 铺地：着色器里按块的铺设顺序揭开，从离门最远的一边铺向门口（见 floorLaying.ts）
 * - 家具：落下带一点回弹
 */

const M = 0.001;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const CONCRETE = new THREE.Color('#BDB7AE');
const DEMOLISH_RED = new THREE.Color('#E5484D');
const NEW_WALL = new THREE.Color('#BFCBF6');
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 确定的伪随机：同一个序号永远得到同一个 0..1 */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 刷墙波：离入户门近的墙先刷，最远的墙在进度约 0.91 时刷完（着色器里是同一个式子） */
const PAINT_SPEED = 1.75;
const PAINT_LAG = 0.6;

function std(color: string | THREE.Color, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({color, roughness, metalness: 0, ...extra});
}

/** 沿线段的盒子，y0..y1 为底高和顶高（mm） */
function segMesh(a: Vec2, b: Vec2, t: number, y0: number, y1: number, material: THREE.Material): THREE.Mesh | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= 0 || y1 <= y0) return null;
  const m = new THREE.Mesh(unitBox, material);
  m.position.set(((a[0] + b[0]) / 2) * M, ((y0 + y1) / 2) * M, ((a[1] + b[1]) / 2) * M);
  m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  m.scale.set(len * M, (y1 - y0) * M, t * M);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const onWall = (w: Wall, o: Opening) => distToSegment([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], w.a, w.b) <= w.thickness / 2 + 30;

/** 墙体的实心部分（mm）：门窗之间的墙段，加窗台下、门窗洞口上方的部分 */
interface Box {
  a: Vec2;
  b: Vec2;
  t: number;
  y0: number;
  y1: number;
}

function bodyBoxes(w: Wall, openings: readonly Opening[], top: number, wallHeight: number): Box[] {
  const boxes: Box[] = wallPieces(w, openings).map(([a, b]) => ({a, b, t: w.thickness, y0: 0, y1: top}));
  for (const o of openings) {
    const head = o.head ?? 2100;
    const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
    if (sill > 0) boxes.push({a: o.a, b: o.b, t: o.thickness, y0: 0, y1: sill});
    if (wallHeight > head) boxes.push({a: o.a, b: o.b, t: o.thickness, y0: head, y1: wallHeight});
  }
  return boxes;
}

/* ---------- 着色器片段 ---------- */

const VARYING = 'varying vec3 vNpWorld;\n';
function withWorldPos(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = VARYING + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vNpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = VARYING + shader.fragmentShader;
}

interface PaintUniforms {
  uPaint: THREE.IUniform<number>;
  uOrigin: THREE.IUniform<THREE.Vector2>;
  uReach: THREE.IUniform<number>;
  uH: THREE.IUniform<number>;
}

/** 墙面从 base 刷成 top：离入户门越远越晚，从下往上，交界 0.25 m 柔边 */
function paintable(m: THREE.MeshStandardMaterial, shared: PaintUniforms, base: THREE.Color, top: THREE.Color) {
  m.color.set('#ffffff');
  const own = {uBase: {value: base.clone()}, uTop: {value: top.clone()}};
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    withWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uPaint; uniform vec2 uOrigin; uniform float uReach; uniform float uH; uniform vec3 uBase; uniform vec3 uTop;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float npL = clamp(uPaint * ${PAINT_SPEED.toFixed(2)} - distance(vNpWorld.xz, uOrigin) / uReach * ${PAINT_LAG.toFixed(2)}, 0.0, 1.0);
  float npK = clamp((npL * (uH + 0.3) - vNpWorld.y) / 0.25, 0.0, 1.0);
  diffuseColor.rgb = mix(uBase, uTop, npK);`,
      );
  };
}

interface FloorUniforms {
  uLaid: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
}

/** 地面按块揭开：所在块的铺设顺序小于已铺块数才显示，刚铺的几块淡入、稍亮 */
function layable(m: THREE.MeshStandardMaterial, plan: Plan, room: Plan['rooms'][number]): {u: FloorUniforms; count: number; sweep: boolean} {
  const l = floorLaying(plan, room);
  const u: FloorUniforms = {uLaid: {value: 0}, uFade: {value: Math.max(2, l.cols * 0.7)}};
  const consts = {
    uKind: {value: l.kind === 'tiles' ? 0 : l.kind === 'planks' ? 1 : 2},
    uDir: {value: new THREE.Vector2(l.dir[0], l.dir[1])},
    uRow: {value: l.rowSize},
    uCol: {value: l.colSize},
    uRowStart: {value: l.rowStart},
    uColStart: {value: l.colStart},
    uCols: {value: l.cols},
    uP: {value: new THREE.Vector2(l.pStart, l.pEnd)},
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, consts);
    withWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uLaid; uniform float uFade; uniform float uKind; uniform vec2 uDir; uniform float uRow; uniform float uCol; uniform float uRowStart; uniform float uColStart; uniform float uCols; uniform vec2 uP;\nvoid main() {',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float npP = dot(vNpWorld.xz, uDir);
  float npA;
  if (uKind > 1.5) {
    float front = mix(uP.x - 0.3, uP.y, uLaid);
    npA = clamp((front - npP) / 0.3, 0.0, 1.0);
  } else {
    float row = floor(npP / uRow) - uRowStart;
    float q = abs(uDir.y) > 0.5 ? vNpWorld.x : vNpWorld.z;
    float joint = 0.0;
    if (uKind > 0.5) joint = mod(floor(-vNpWorld.z / ${PLANK_ROW.toFixed(2)}), 2.0) < 0.5 ? 0.6 : 1.2;
    float col = floor((q - joint) / uCol) - uColStart;
    float ord = row * uCols + (mod(row, 2.0) < 0.5 ? col : uCols - 1.0 - col);
    npA = clamp((uLaid - ord) / uFade, 0.0, 1.0);
  }
  if (npA <= 0.002) discard;
  diffuseColor.a *= npA;
  diffuseColor.rgb *= 1.0 + 0.22 * (1.0 - npA);`,
      );
  };
  return {u, count: layingCount(l), sweep: l.kind === 'sweep'};
}

export interface ReplayScene {
  root: THREE.Group;
  /** 把场景摆到 t 秒时的样子 */
  apply(t: number): void;
  dispose(): void;
}

interface Block {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  size: THREE.Vector3;
  yaw: number;
  /** 墙的法线（倒向）和沿墙方向 */
  n: THREE.Vector3;
  u: THREE.Vector3;
  /** 落地后中心离地的高度 */
  rest: number;
  delay: number;
  side: number;
  drift: number;
  along: number;
  spin: number;
  tilt: number;
}

interface Course {
  mesh: THREE.Mesh;
  /** 第几皮（从地面数） */
  j: number;
  /** 这段在墙上的起止（从墙的 a 端量，m） */
  s0: number;
  s1: number;
}

interface WallAnim {
  w: Wall;
  /** 墙的中点离入户门的距离 / reach，刷墙波用 */
  d: number;
  group: THREE.Group;
  /** 压顶、踢脚、窗玻璃、门扇：拆墙时随整面墙消失，砌墙时砌完才出现 */
  extras: THREE.Object3D[];
  body: THREE.MeshStandardMaterial;
  skirts: THREE.Object3D[];
  leaves: {pivot: THREE.Object3D; open: number}[];
  blocks: Block[];
  rubble: THREE.Group | null;
  courses: Course[];
  /** 墙的起点、方向和长度（m），砌墙用 */
  a: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  courseCount: number;
}

export function buildReplayScene(plan: Plan, tl: Timeline): ReplayScene {
  const root = new THREE.Group();
  const owned: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const own = <T extends THREE.Material>(m: T) => (owned.push(m), m);
  const origin = new THREE.Vector2(tl.origin[0], tl.origin[1]);

  // 毛坯地面：水泥找平
  const b = planBounds(plan);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((b.maxX - b.minX) * M + 1, (b.maxY - b.minY) * M + 1), own(std('#B9B4AB', 0.95)));
  geos.push(ground.geometry);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(((b.minX + b.maxX) / 2) * M, -0.004, ((b.minY + b.maxY) / 2) * M);
  ground.receiveShadow = true;
  root.add(ground);

  // 墙面：按墙种类各一份，刷墙由着色器完成
  const paintU: PaintUniforms = {uPaint: {value: 0}, uOrigin: {value: origin}, uReach: {value: tl.reach}, uH: {value: plan.wallHeight * M}};
  const paintMats = new Map<Wall['kind'], THREE.MeshStandardMaterial>();
  const paintMat = (kind: Wall['kind']) => {
    let m = paintMats.get(kind);
    if (!m) {
      m = own(std(CONCRETE));
      paintable(m, paintU, CONCRETE, new THREE.Color(WALL_COLOR[kind]));
      paintMats.set(kind, m);
    }
    return m;
  };
  const capMat = own(std('#34312D', 0.9));
  const skirtMat = own(std('#CFC6B8', 0.6));
  const glassMat = own(std('#BFD3F2', 0.1, {transparent: true, opacity: 0.35}));
  const frameMat = own(std('#2747D6', 0.6));
  const leafMat = own(std('#D9CBB4', 0.6));

  const walls: WallAnim[] = [];
  const corners = withCorners(plan.walls);
  const doors = doorsOf(plan.openings);
  plan.walls.forEach((w0, i) => {
    const w = corners[i]!;
    const openings = plan.openings.filter((o) => onWall(w0, o));
    const demolished = plan.demolished.includes(w0.id);
    const added = !!w0.added && !demolished;
    const body = demolished ? own(std(CONCRETE)) : added ? own(std(NEW_WALL)) : paintMat(w0.kind);
    if (added) paintable(body, paintU, NEW_WALL, new THREE.Color(WALL_COLOR[w0.kind]));
    const group = new THREE.Group();
    const top = w0.height ?? (w0.kind === 'low' ? 1000 : plan.wallHeight);
    const extras: THREE.Object3D[] = [];
    const skirts: THREE.Object3D[] = [];
    const blocks: Block[] = [];
    const courses: Course[] = [];
    let rubble: THREE.Group | null = null;
    const wa = new THREE.Vector3(w.a[0] * M, 0, w.a[1] * M);
    const wdir = new THREE.Vector3(w.b[0] - w.a[0], 0, w.b[1] - w.a[1]).normalize();
    const alongOf = (p: Vec2) => ((p[0] - w.a[0]) * wdir.x + (p[1] - w.a[1]) * wdir.z) * M;

    const boxes = bodyBoxes(w, openings, top, plan.wallHeight);
    if (demolished) {
      // 按约 600 × 400 mm 分块
      rubble = new THREE.Group();
      let k = 0;
      for (const bx of boxes) {
        const L = Math.hypot(bx.b[0] - bx.a[0], bx.b[1] - bx.a[1]);
        if (L <= 0) continue;
        const nA = Math.max(1, Math.round(L / 600));
        const nU = Math.max(1, Math.round((bx.y1 - bx.y0) / 400));
        const yaw = -Math.atan2(bx.b[1] - bx.a[1], bx.b[0] - bx.a[0]);
        const u = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const bw = L / nA;
        const bh = (bx.y1 - bx.y0) / nU;
        for (let ia = 0; ia < nA; ia++) {
          for (let iu = 0; iu < nU; iu++) {
            const s = (ia + 0.5) * bw;
            const yc = bx.y0 + (iu + 0.5) * bh;
            const mesh = new THREE.Mesh(unitBox, body);
            const base = new THREE.Vector3(bx.a[0] + ((bx.b[0] - bx.a[0]) * s) / L, yc, bx.a[1] + ((bx.b[1] - bx.a[1]) * s) / L).multiplyScalar(M);
            const size = new THREE.Vector3(bw * M * 0.97, bh * M * 0.97, bx.t * M);
            mesh.position.copy(base);
            mesh.rotation.set(0, yaw, 0, 'YXZ');
            mesh.scale.copy(size);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            rubble.add(mesh);
            const h = (x: number) => hash(i * 7919 + k * 31 + x);
            blocks.push({
              mesh,
              base,
              size,
              yaw,
              n,
              u,
              rest: (Math.min(bx.t, bh) / 2) * M,
              // 上面的先落，同一层稍微错开
              delay: 0.22 + 0.42 * (1 - yc / top) + 0.08 * h(1),
              side: h(2) < 0.5 ? -1 : 1,
              drift: 0.15 + 0.4 * h(3),
              along: (h(4) - 0.5) * 0.35,
              spin: (h(5) - 0.5) * 0.9,
              tilt: (Math.PI / 2) * (0.55 + 0.45 * h(6)),
            });
            k++;
          }
        }
      }
      root.add(rubble);
    } else if (added) {
      // 200 mm 一皮，每皮按墙段各一块
      for (const bx of boxes) {
        const [lo, hi] = [alongOf(bx.a), alongOf(bx.b)].sort((x, y) => x - y) as [number, number];
        for (let j = Math.floor(bx.y0 / 200); j * 200 < bx.y1; j++) {
          const y0 = Math.max(bx.y0, j * 200);
          const y1 = Math.min(bx.y1, (j + 1) * 200);
          const mesh = y1 - y0 >= 1 ? segMesh(bx.a, bx.b, bx.t, y0, y1, body) : null;
          if (!mesh) continue;
          group.add(mesh);
          courses.push({mesh, j, s0: lo, s1: hi});
        }
      }
    } else {
      for (const bx of boxes) {
        const m = segMesh(bx.a, bx.b, bx.t, bx.y0, bx.y1, body);
        if (m) group.add(m);
      }
    }

    for (const [a, bb] of wallPieces(w, openings)) {
      const cap = segMesh(a, bb, w.thickness + 2, top, top + 12, capMat);
      if (cap) (group.add(cap), extras.push(cap));
      const sk = segMesh(a, bb, w.thickness + 16, 0, 80, skirtMat);
      if (sk) (group.add(sk), skirts.push(sk), extras.push(sk));
    }
    const leaves: WallAnim['leaves'] = [];
    for (const o of openings) {
      const head = o.head ?? 2100;
      const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
      const ms = [
        o.kind === 'window' ? segMesh(o.a, o.b, 20, sill, head, glassMat) : null,
        o.kind === 'slidingDoor' ? segMesh(o.a, o.b, 30, 0, head, glassMat) : null,
        o.isEntry ? segMesh(o.a, o.b, o.thickness + 20, head, head + 40, frameMat) : null,
      ];
      for (const m of ms) if (m) (group.add(m), extras.push(m));
      // 门扇：墙刷好后装上
      const d = doors.find((x) => x.id === o.id);
      if (d) {
        const pivot = new THREE.Group();
        pivot.position.set(d.hinge[0], 0, d.hinge[1]);
        pivot.rotation.y = d.open;
        const leaf = new THREE.Mesh(unitBox, leafMat);
        leaf.position.set(d.leaf / 2, d.head / 2, 0);
        leaf.scale.set(d.leaf - 0.01, d.head - 0.01, 0.04);
        leaf.castShadow = true;
        pivot.add(leaf);
        group.add(pivot);
        leaves.push({pivot, open: d.open});
        extras.push(pivot);
      }
    }
    root.add(group);
    const mid: Vec2 = [((w.a[0] + w.b[0]) / 2) * M, ((w.a[1] + w.b[1]) / 2) * M];
    const d = Math.hypot(mid[0] - origin.x, mid[1] - origin.y) / tl.reach;
    walls.push({
      w: w0,
      d,
      group,
      extras,
      body,
      skirts,
      leaves,
      blocks,
      rubble,
      courses,
      a: wa,
      dir: wdir,
      len: wallLength(w) * M,
      courseCount: Math.max(1, Math.ceil(top / 200)),
    });
  });

  // 地面：每个房间一张网格，着色器按块揭开
  const floors = plan.rooms.map((r) => {
    const shape = new THREE.Shape();
    r.poly.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * M, -y * M) : shape.lineTo(x * M, -y * M)));
    shape.closePath();
    const m = own(floorMaterial(r.material).clone());
    m.transparent = true;
    const lay = layable(m, plan, r);
    const geo = new THREE.ShapeGeometry(shape);
    geos.push(geo);
    // ShapeGeometry 的 UV 就是 (x, -y)，单位 m，和 3D 视图的贴图花纹对得上
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.002;
    mesh.receiveShadow = true;
    root.add(mesh);
    return {id: r.id, mesh, m, ...lay};
  });

  // 家具
  const furniture = plan.furniture.map((f) => {
    const obj = furnitureObject(f);
    root.add(obj);
    return {id: f.id, obj, y: obj.position.y, s: obj.scale.clone()};
  });

  const v = new THREE.Vector3();
  function apply(t: number) {
    const paint = progress(tl.paint, t);
    paintU.uPaint.value = paint;
    for (const wa of walls) {
      const dem = tl.demolish.get(wa.w.id);
      const bld = tl.build.get(wa.w.id);
      const rise = easeOut(progress(tl.rise.get(wa.w.id), t));

      if (wa.rubble) {
        const p = progress(dem, t);
        // 开场时整面墙随立墙长高；开拆后压顶、窗等先撤掉
        wa.rubble.visible = rise > 0.001 && p < 1;
        wa.rubble.scale.y = p > 0 ? 1 : Math.max(0.001, rise);
        wa.group.visible = rise > 0.001 && p < 0.22;
        wa.group.scale.y = Math.max(0.001, rise);
        // 标红闪两下，之后保持淡红
        const flash = p <= 0 ? 0 : p < 0.22 ? Math.abs(Math.sin((p / 0.22) * Math.PI * 2)) * 0.85 : 0.35;
        wa.body.color.copy(CONCRETE).lerp(DEMOLISH_RED, flash);
        // 落地后清运：缩小消失
        const clear = 1 - smooth((p - 0.82) / 0.18);
        for (const bl of wa.blocks) {
          const tau = clamp01((p - bl.delay) / 0.2);
          v.copy(bl.base);
          v.y = bl.base.y + (bl.rest - bl.base.y) * tau * tau;
          v.addScaledVector(bl.n, bl.side * bl.drift * tau).addScaledVector(bl.u, bl.along * tau);
          bl.mesh.position.copy(v);
          bl.mesh.rotation.set(bl.side * bl.tilt * easeOut(tau), bl.yaw + bl.spin * tau, 0, 'YXZ');
          bl.mesh.scale.copy(bl.size).multiplyScalar(Math.max(0.001, clear));
          bl.mesh.visible = clear > 0.01;
        }
        continue;
      }

      const local = paint * PAINT_SPEED - wa.d * PAINT_LAG;
      if (wa.courses.length) {
        // 一皮一皮往上砌：第 j 皮在 0.88 × [j/n, (j+1.5)/n] 里从一头伸到另一头，相邻两皮反向
        const p = progress(bld, t);
        const n = wa.courseCount;
        for (const c of wa.courses) {
          const f = easeInOut(clamp01((p - (c.j / n) * 0.88) / ((0.88 / n) * 1.5)));
          const front = f * wa.len;
          const [lo, hi] = c.j % 2 === 0 ? [c.s0, Math.min(c.s1, front)] : [Math.max(c.s0, wa.len - front), c.s1];
          const vis = hi - lo;
          c.mesh.visible = vis > 0.001;
          if (!c.mesh.visible) continue;
          c.mesh.scale.x = vis;
          v.copy(wa.a).addScaledVector(wa.dir, (lo + hi) / 2);
          c.mesh.position.x = v.x;
          c.mesh.position.z = v.z;
        }
        for (const e of wa.extras) e.visible = p >= 1;
        wa.group.visible = p > 0;
        if (p < 1) continue;
      } else {
        wa.group.visible = rise > 0.001;
        wa.group.scale.y = Math.max(0.001, rise);
      }
      // 这面墙刷好后装踢脚线，门扇随后装上并转到开着的位置
      for (const s of wa.skirts) s.visible = local >= 0.95;
      const k = smooth((local - 0.9) / 0.25);
      for (const l of wa.leaves) {
        l.pivot.visible = k > 0.01;
        l.pivot.rotation.y = l.open + (1 - k) * 0.9;
      }
    }

    for (const f of floors) {
      const p = progress(tl.floors.get(f.id), t);
      f.mesh.visible = p > 0;
      f.m.transparent = p < 1;
      f.u.uLaid.value = p >= 1 ? 1e6 : f.sweep ? easeInOut(p) : p * (f.count + f.u.uFade.value);
    }

    for (const f of furniture) {
      const p = progress(tl.furniture.get(f.id), t);
      f.obj.visible = p > 0;
      // 前 65% 落下，之后一次小回弹
      const drop = p < 0.65 ? 1 - (p / 0.65) ** 2 : 0.07 * Math.sin(((p - 0.65) / 0.35) * Math.PI);
      f.obj.position.y = f.y + drop * 0.45;
      f.obj.scale.copy(f.s).multiplyScalar(0.94 + 0.06 * smooth(p / 0.65));
    }
  }

  return {
    root,
    apply,
    dispose() {
      for (const m of owned) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
}
