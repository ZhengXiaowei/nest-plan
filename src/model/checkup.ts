import type {Furniture, Opening, Plan, Room, Vec2} from './types';
import {activeWalls, liveOpenings, wallPieces, withCorners} from './walls';
import {planBounds, polygonCentroid, roomArea, segmentOutline} from './geometry';

/**
 * 居住体检：按常用的人体尺度经验检查方案住起来顺不顺手。
 *
 * - 床边：床两侧和床尾要留出下床、铺床的通道（≥ 500 mm）
 * - 柜门：衣柜、冰箱、洗衣机等前面要留出开门、站人的空间
 * - 开门：平开门扫过的扇形里不能有家具，门口不能堵
 * - 通行：从入户门能走到每个房间，路上最窄处不要太窄（不算门洞）
 * - 摆放：家具不嵌进墙里、不互相压着（地毯、桌下的椅子等除外）
 * - 餐桌：拉开椅子坐下要 600 到 700 mm
 *
 * 单位 mm。数值都是常见的设计经验值，不是强制规范。
 */

export type Severity = 'error' | 'warn';
export type RuleId = 'bed' | 'front' | 'door' | 'path' | 'overlap' | 'table';

export const RULES: Record<RuleId, string> = {
  bed: '床边通道',
  front: '柜门和操作空间',
  door: '开门空间',
  path: '通行和可达',
  overlap: '家具摆放',
  table: '餐桌座位',
};

export type Shape = {kind: 'poly'; pts: Vec2[]} | {kind: 'circle'; c: Vec2; r: number};

export interface Issue {
  /** 稳定的 id：规则 + 涉及的东西，改方案前后可以对比 */
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  detail: string;
  /** 平面图上标出来的区域 */
  shapes: Shape[];
  /** 标号的位置 */
  at: Vec2;
  /** 涉及的家具 id */
  furniture: string[];
}

export interface Checkup {
  score: number;
  issues: Issue[];
  /** 没有问题的规则 */
  passed: RuleId[];
}

/* ---------- 几何 ---------- */

/** 家具四个角（顺序：左上、右上、右下、左下，局部坐标 -y 是靠背 / 床头） */
export function furnitureCorners(f: Furniture, inset = 0): Vec2[] {
  const r = (f.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const hw = Math.max(1, f.w / 2 - inset);
  const hd = Math.max(1, f.d / 2 - inset);
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const).map(([x, y]) => [f.cx + x * c - y * s, f.cy + x * s + y * c] as Vec2);
}

/** 局部坐标 → 平面坐标 */
function local(f: Furniture, x: number, y: number): Vec2 {
  const r = (f.rot * Math.PI) / 180;
  return [f.cx + x * Math.cos(r) - y * Math.sin(r), f.cy + x * Math.sin(r) + y * Math.cos(r)];
}

/** 局部方向 → 平面方向 */
function localDir(f: Furniture, x: number, y: number): Vec2 {
  const r = (f.rot * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

/** 两个凸多边形是否相交（分离轴） */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

export function pointInPoly(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 挡路的东西：墙段、窗、家具，都是凸四边形 */
interface Obstacle {
  pts: Vec2[];
  /** 外接框，快速排除 */
  box?: [number, number, number, number];
  /** 家具 id；墙和窗为空 */
  fid?: string;
  name: string;
  type?: string;
}

/** 挂墙的、贴地的，不挡人 */
const NOT_BLOCKING = new Set(['rug', 'acwall', 'waterheater', 'tv']);
/** 厨房台面上的东西：L 形转角处互相挨着是正常的 */
const KITCHEN = new Set(['counter', 'stove', 'ksink', 'dishwasher']);
/** 离墙比这近就算贴墙放（只对墙；离家具这么近就是挤） */
const AGAINST = 150;
const touchesWall = (p: Probe) => p.dist < AGAINST && !p.hit?.fid;
const touches = (p: Probe) => p.dist < 20;
/** 可以随手挪开的椅凳：不算挡路 */
const MOVABLE = new Set(['chair', 'officechair', 'barstool']);
/** 允许互相叠着放的组合 */
const STACKS: [string, string[]][] = [
  ['chair', ['table', 'roundtable', 'desk', 'island', 'counter', 'dresser']],
  ['officechair', ['desk', 'table']],
  ['barstool', ['island', 'counter', 'table']],
  ['stove', ['counter']],
  ['ksink', ['counter']],
  ['dishwasher', ['counter']],
  ['counter', ['counter']],
  ['tv', ['tvstand']],
  ['baycushion', ['*']],
  ['plant', ['plant']],
];
function canStack(a: string, b: string) {
  if (NOT_BLOCKING.has(a) || NOT_BLOCKING.has(b)) return true;
  return STACKS.some(([x, ys]) => (x === a && (ys.includes(b) || ys.includes('*'))) || (x === b && (ys.includes(a) || ys.includes('*'))));
}

function wallObstacles(plan: Plan, openings: Opening[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const w of withCorners(activeWalls(plan))) {
    for (const [a, b] of wallPieces(w, openings)) out.push({pts: segmentOutline(a, b, w.thickness), name: '墙'});
  }
  for (const o of openings) if (o.kind === 'window') out.push({pts: segmentOutline(o.a, o.b, o.thickness), name: '窗台'});
  return out;
}


function boxOf(pts: readonly Vec2[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** 射线和凸多边形的最近交点距离；起点在多边形里返回 0；不相交返回 Infinity */
function rayPoly(p: Vec2, d: Vec2, poly: readonly Vec2[]): number {
  if (pointInPoly(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = a[0] - p[0];
    const ay = a[1] - p[1];
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * d[1] - ay * d[0]) / den;
    if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

interface Probe {
  /** 最小净距 */
  dist: number;
  /** 挡住的东西 */
  hit: Obstacle | null;
}

/**
 * 从家具的一条边往外量净距：沿边取样（from 到 to，0..1），每个样点朝外打一条线，取最近的障碍。
 */
function probeSide(
  f: Furniture,
  side: 'left' | 'right' | 'front' | 'back',
  obstacles: Obstacle[],
  from: number,
  to: number,
  /** 某个样点最近的障碍满足条件时，整个样点不算（比如 L 形橱柜的转角） */
  skipSample?: (o: Obstacle, d: number) => boolean,
  max = 1500,
): Probe {
  const hw = f.w / 2;
  const hd = f.d / 2;
  // 边的起止点（局部）和朝外方向
  const spec = {
    left: {p0: [-hw, -hd], p1: [-hw, hd], n: [-1, 0]},
    right: {p0: [hw, -hd], p1: [hw, hd], n: [1, 0]},
    front: {p0: [-hw, hd], p1: [hw, hd], n: [0, 1]},
    back: {p0: [-hw, -hd], p1: [hw, -hd], n: [0, -1]},
  }[side];
  const dir = localDir(f, spec.n[0]!, spec.n[1]!);
  const len = Math.hypot(spec.p1[0]! - spec.p0[0]!, spec.p1[1]! - spec.p0[1]!);
  const n = Math.max(2, Math.ceil(((to - from) * len) / 60));
  let best: Probe = {dist: max, hit: null};
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    // 起点离边 2mm，免得算到自己
    const lx = spec.p0[0]! + (spec.p1[0]! - spec.p0[0]!) * t + spec.n[0]! * 2;
    const ly = spec.p0[1]! + (spec.p1[1]! - spec.p0[1]!) * t + spec.n[1]! * 2;
    const p = local(f, lx, ly);
    let near: Probe = {dist: max, hit: null};
    const ex = p[0] + dir[0] * max;
    const ey = p[1] + dir[1] * max;
    const bx0 = Math.min(p[0], ex);
    const bx1 = Math.max(p[0], ex);
    const by0 = Math.min(p[1], ey);
    const by1 = Math.max(p[1], ey);
    for (const o of obstacles) {
      if (o.fid === f.id) continue;
      const b = (o.box ??= boxOf(o.pts));
      if (b[2] < bx0 || b[0] > bx1 || b[3] < by0 || b[1] > by1) continue;
      const d = rayPoly(p, dir, o.pts);
      if (d < near.dist) near = {dist: d, hit: o};
    }
    if (near.hit && skipSample?.(near.hit, near.dist)) continue;
    if (near.dist < best.dist) best = near;
  }
  return best;
}

/** 边外侧 dist 深的长条，平面图上标出来 */
function sideStrip(f: Furniture, side: 'left' | 'right' | 'front', from: number, to: number, dist: number): Vec2[] {
  const hw = f.w / 2;
  const hd = f.d / 2;
  const d = Math.max(dist, 60);
  if (side === 'front') {
    const x0 = -hw + f.w * from;
    const x1 = -hw + f.w * to;
    return [local(f, x0, hd), local(f, x1, hd), local(f, x1, hd + d), local(f, x0, hd + d)];
  }
  const s = side === 'left' ? -1 : 1;
  const y0 = -hd + f.d * from;
  const y1 = -hd + f.d * to;
  return [local(f, s * hw, y0), local(f, s * hw, y1), local(f, s * (hw + d), y1), local(f, s * (hw + d), y0)];
}

const centerOf = (pts: readonly Vec2[]): Vec2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

function roomOf(p: Vec2, rooms: readonly Room[]): Room | undefined {
  for (let k = rooms.length - 1; k >= 0; k--) if (pointInPoly(p, rooms[k]!.poly)) return rooms[k];
  return undefined;
}

const mmText = (v: number) => `${Math.max(0, Math.round(v / 10) * 10)} mm`;
const hitName = (h: Obstacle | null) => (h ? h.name : '旁边的东西');

/* ---------- 规则 ---------- */

/** 柜门 / 操作面前需要的净距（mm），以及叫法 */
const FRONT_NEED: Record<string, {need: number; what: string}> = {
  wardrobe: {need: 600, what: '开柜门、站着拿衣服'},
  shoecab: {need: 450, what: '开柜门、换鞋'},
  cabinet: {need: 500, what: '开柜门'},
  dresser: {need: 600, what: '坐下梳妆'},
  fridge: {need: 700, what: '开冰箱门'},
  dishwasher: {need: 650, what: '拉开洗碗机门'},
  washer: {need: 600, what: '开洗衣机门、弯腰取衣服'},
  dryer: {need: 600, what: '开烘干机门'},
  ovencol: {need: 600, what: '开蒸烤箱门'},
  bookshelf: {need: 450, what: '站着取书'},
  toilet: {need: 500, what: '坐下和起身'},
  vanity: {need: 600, what: '站着洗漱'},
  counter: {need: 800, what: '在台面前做饭'},
  desk: {need: 700, what: '拉开椅子坐下'},
  piano: {need: 750, what: '放琴凳坐下弹琴'},
};

function bedRule(plan: Plan, all: Obstacle[], out: Issue[]) {
  // 椅子随手一推就开，不算挡床
  const obstacles = all.filter((o) => !o.type || !MOVABLE.has(o.type));
  for (const f of plan.furniture) {
    if (f.type !== 'bed') continue;
    const room = roomOf([f.cx, f.cy], plan.rooms)?.name ?? '';
    const name = `${room}${f.name}`;
    const double = f.w >= 1350;
    const sides: ('left' | 'right')[] = ['left', 'right'];
    const probes = sides.map((side) => ({side, ...probeSide(f, side, obstacles, 0.3, 0.95)}));
    const againstWall = probes.filter(touchesWall);
    for (const p of probes) {
      if (touchesWall(p) || (touches(p) && p.hit?.type === 'nightstand')) continue;
      if (p.dist < 500) {
        const severity: Severity = p.dist < 400 ? 'error' : 'warn';
        const strip = sideStrip(f, p.side, 0.3, 0.95, p.dist);
        out.push({
          id: `bed:${f.id}:${p.side}`,
          rule: 'bed',
          severity,
          title: `${name}一侧离${hitName(p.hit)}只有 ${mmText(p.dist)}`,
          detail: `下床、铺床会磕碰，床边通道建议至少 500 mm，600 mm 更舒服。`,
          shapes: [{kind: 'poly', pts: strip}],
          at: centerOf(strip),
          furniture: [f.id, ...(p.hit?.fid ? [p.hit.fid] : [])],
        });
      }
    }
    if (double && againstWall.length === 1) {
      const strip = sideStrip(f, againstWall[0]!.side, 0.3, 0.95, 120);
      out.push({
        id: `bed:${f.id}:wall`,
        rule: 'bed',
        severity: 'warn',
        title: `${name}一侧贴墙`,
        detail: '睡里侧的人只能从床尾或爬过去下床，铺床也不方便。双人床两边最好都留通道。',
        shapes: [{kind: 'poly', pts: strip}],
        at: centerOf(strip),
        furniture: [f.id],
      });
    }
    const foot = probeSide(f, 'front', obstacles, 0.1, 0.9);
    if (!touchesWall(foot) && foot.dist < 450) {
      const strip = sideStrip(f, 'front', 0.1, 0.9, foot.dist);
      out.push({
        id: `bed:${f.id}:foot`,
        rule: 'bed',
        severity: foot.dist < 300 ? 'error' : 'warn',
        title: `${name}床尾离${hitName(foot.hit)}只有 ${mmText(foot.dist)}`,
        detail: '床尾要能走人，建议至少 500 mm；床尾对着衣柜时要 600 mm 以上才开得了柜门。',
        shapes: [{kind: 'poly', pts: strip}],
        at: centerOf(strip),
        furniture: [f.id, ...(foot.hit?.fid ? [foot.hit.fid] : [])],
      });
    }
  }
}

function frontRule(plan: Plan, obstacles: Obstacle[], out: Issue[]) {
  for (const f of plan.furniture) {
    const room = roomOf([f.cx, f.cy], plan.rooms)?.name ?? '';
    if (f.type === 'sofa' || f.type === 'cornersofa') {
      const p = probeSide(f, 'front', obstacles, 0.2, 0.8);
      if (p.hit?.type === 'coffeetable' && p.dist < 250) {
        const strip = sideStrip(f, 'front', 0.2, 0.8, p.dist);
        out.push({
          id: `front:${f.id}`,
          rule: 'front',
          severity: 'warn',
          title: `${room}茶几离${f.name}只有 ${mmText(p.dist)}`,
          detail: '坐下腿伸不开，茶几和沙发之间留 300 到 450 mm 比较合适。',
          shapes: [{kind: 'poly', pts: strip}],
          at: centerOf(strip),
          furniture: [f.id, p.hit.fid!],
        });
      }
      continue;
    }
    const spec = FRONT_NEED[f.type];
    if (!spec) continue;
    // 椅子随手能挪开，不算挡；橱柜转角处挨着另一段台面不算
    const obs = obstacles.filter((o) => !o.type || !MOVABLE.has(o.type));
    const corner = KITCHEN.has(f.type) ? (o: Obstacle, d: number) => d < 50 && !!o.type && KITCHEN.has(o.type) : undefined;
    const p = probeSide(f, 'front', obs, 0.15, 0.85, corner);
    if (p.dist >= spec.need) continue;
    const strip = sideStrip(f, 'front', 0.15, 0.85, p.dist);
    out.push({
      id: `front:${f.id}`,
      rule: 'front',
      severity: p.dist < spec.need * 0.6 ? 'error' : 'warn',
      title: `${room}${f.name}前面只有 ${mmText(p.dist)}`,
      detail: `被${hitName(p.hit)}挡着，${spec.what}要 ${spec.need} mm 左右。`,
      shapes: [{kind: 'poly', pts: strip}],
      at: centerOf(strip),
      furniture: [f.id, ...(p.hit?.fid ? [p.hit.fid] : [])],
    });
  }
}

/** 平开门扫过的扇形（多边形） */
export function swingSector(o: Opening): Vec2[] | null {
  const s = o.swing;
  if (!s) return null;
  const a0 = Math.atan2(s.closed[1], s.closed[0]);
  let a1 = Math.atan2(s.open[1], s.open[0]);
  if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
  const pts: Vec2[] = [s.hinge];
  for (let i = 0; i <= 8; i++) {
    const a = a0 + ((a1 - a0) * i) / 8;
    pts.push([s.hinge[0] + Math.cos(a) * s.leaf, s.hinge[1] + Math.sin(a) * s.leaf]);
  }
  return pts;
}

function doorRule(plan: Plan, openings: Opening[], out: Issue[]) {
  const blockers = plan.furniture.filter((f) => !NOT_BLOCKING.has(f.type) && !MOVABLE.has(f.type));
  for (const o of openings) {
    if (o.kind === 'window') continue;
    const label = o.name ?? (o.isEntry ? '入户门' : o.kind === 'slidingDoor' ? '推拉门' : '门');
    const sector = swingSector(o);
    const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) || 1;
    const ux = (o.b[0] - o.a[0]) / len;
    const uy = (o.b[1] - o.a[1]) / len;
    // 门口两侧各 400 的通行区：家具占了一部分没关系，剩下的宽度够一个人过就行
    const zone = segmentOutline(o.a, o.b, o.thickness + 800);
    const inZone: {f: Furniture; lo: number; hi: number}[] = [];
    for (const f of blockers) {
      const box = furnitureCorners(f, 15);
      if (sector && convexOverlap(sector, box)) {
        out.push({
          id: `door:${o.id}:${f.id}`,
          rule: 'door',
          severity: 'error',
          title: `${f.name}挡住了${label}，门开不到底`,
          detail: '平开门扫过的地方不要放家具，或者把门改成反向开、推拉门。',
          shapes: [{kind: 'poly', pts: sector}, {kind: 'poly', pts: furnitureCorners(f)}],
          at: centerOf(furnitureCorners(f)),
          furniture: [f.id],
        });
        continue;
      }
      if (!convexOverlap(zone, box)) continue;
      const ts = box.map(([x, y]) => (x - o.a[0]) * ux + (y - o.a[1]) * uy);
      inZone.push({f, lo: Math.max(0, Math.min(...ts)), hi: Math.min(len, Math.max(...ts))});
    }
    if (!inZone.length) continue;
    // 门洞里最宽的一段空当
    const cuts = [...inZone].sort((a, b) => a.lo - b.lo);
    let free = 0;
    let at = 0;
    for (const c of cuts) {
      free = Math.max(free, c.lo - at);
      at = Math.max(at, c.hi);
    }
    free = Math.max(free, len - at);
    const need = Math.min(600, len - 100);
    if (free >= need) continue;
    const names = inZone.map((z) => z.f.name);
    const who = names.length <= 2 ? names.join('和') : `${names[0]}、${names[1]}等 ${names.length} 件家具`;
    out.push({
      id: `door:${o.id}:zone`,
      rule: 'door',
      severity: free < 450 ? 'error' : 'warn',
      title: free <= 0 ? `${who}把${label}门口堵住了` : `${label}门口只剩 ${mmText(free)} 能过`,
      detail: free <= 0 ? '门口两侧至少留出一个人进出的位置。' : `被${who}挡了，门口要留 600 mm 以上才好进出。`,
      shapes: [{kind: 'poly', pts: zone}, ...inZone.map((z) => ({kind: 'poly' as const, pts: furnitureCorners(z.f)}))],
      at: [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2],
      furniture: inZone.map((z) => z.f.id),
    });
  }
}

function overlapRule(plan: Plan, walls: Obstacle[], out: Issue[]) {
  const fs = plan.furniture;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i]!;
    if (NOT_BLOCKING.has(a.type)) continue;
    const ca = furnitureCorners(a, 20);
    const wall = walls.find((w) => w.name === '墙' && convexOverlap(ca, w.pts));
    if (wall) {
      out.push({
        id: `overlap:${a.id}:wall`,
        rule: 'overlap',
        severity: 'error',
        title: `${a.name}嵌进墙里了`,
        detail: '挪一挪或者改小尺寸，家具要放在墙里面。',
        shapes: [{kind: 'poly', pts: furnitureCorners(a)}],
        at: [a.cx, a.cy],
        furniture: [a.id],
      });
    }
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j]!;
      if (canStack(a.type, b.type)) continue;
      if (!convexOverlap(ca, furnitureCorners(b, 20))) continue;
      out.push({
        id: `overlap:${a.id}:${b.id}`,
        rule: 'overlap',
        severity: 'error',
        title: `${a.name}和${b.name}叠在一起了`,
        detail: '两件家具压着放不下，挪开一点。',
        shapes: [{kind: 'poly', pts: furnitureCorners(a)}, {kind: 'poly', pts: furnitureCorners(b)}],
        at: [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2],
        furniture: [a.id, b.id],
      });
    }
  }
}

/** 围着桌子的座位：本来就是给这张桌子坐的 */
const SEATS = new Set(['armchair', 'sofa', 'cornersofa', 'beanbag']);

function tableRule(plan: Plan, obstacles: Obstacle[], out: Issue[]) {
  const obs = obstacles.filter((o) => !o.type || (!MOVABLE.has(o.type) && !SEATS.has(o.type)));
  for (const f of plan.furniture) {
    if (f.type !== 'table' && f.type !== 'roundtable') continue;
    const room = roomOf([f.cx, f.cy], plan.rooms)?.name ?? '';
    for (const side of ['left', 'right', 'front', 'back'] as const) {
      // 长桌只看两条长边，圆桌四边都看
      if (f.type === 'table' && (f.w >= f.d ? side === 'left' || side === 'right' : side === 'front' || side === 'back')) continue;
      const p = probeSide(f, side, obs, 0.2, 0.8);
      if (touchesWall(p) || p.dist >= 600) continue;
      const strip = side === 'back' ? null : sideStrip(f, side, 0.2, 0.8, p.dist);
      const at = strip ? centerOf(strip) : local(f, 0, -f.d / 2 - p.dist / 2);
      out.push({
        id: `table:${f.id}:${side}`,
        rule: 'table',
        severity: 'warn',
        title: `${room}${f.name}一边离${hitName(p.hit)}只有 ${mmText(p.dist)}`,
        detail: '这边坐人时拉不开椅子，桌边到墙或柜子留 600 到 700 mm；不坐人的话可以靠墙放。',
        shapes: strip ? [{kind: 'poly', pts: strip}] : [{kind: 'circle', c: at, r: Math.max(150, p.dist / 2)}],
        at,
        furniture: [f.id],
      });
    }
  }
}

/* ---------- 通行：栅格 + 距离变换 + 最宽路径 ---------- */

const CELL = 50;
/** 侧着身子也要 450 宽才挤得过去，中心离障碍至少 225 */
const PASS_R = 225;
/** 路上最窄处低于这个宽度提醒（门洞不算） */
const NARROW = 750;

/** 一维平方距离变换（Felzenszwalb） */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** 每个空格到最近障碍格的距离（格数） */
function distanceField(solid: Uint8Array, cols: number, rows: number): Float32Array {
  const INF = 1e12;
  const g = new Float64Array(cols * rows);
  for (let i = 0; i < g.length; i++) g[i] = solid[i] ? 0 : INF;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) f[r] = g[r * cols + c]!;
    edt1d(f, rows, d, v, z);
    for (let r = 0; r < rows; r++) g[r * cols + c] = d[r]!;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) f[c] = g[r * cols + c]!;
    edt1d(f, cols, d, v, z);
    for (let c = 0; c < cols; c++) g[r * cols + c] = d[c]!;
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]!);
  return out;
}

/** 最大堆：按瓶颈宽度取最宽的 */
class MaxHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p]! >= this.k[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0]!, this.v[0]!];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l]! > this.k[m]!) m = l;
        if (r < this.k.length && this.k[r]! > this.k[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.v[a], this.v[b]] = [this.v[b]!, this.v[a]!];
  }
}

function pathRule(plan: Plan, openings: Opening[], walls: Obstacle[], out: Issue[]) {
  const rooms = plan.rooms.filter((r) => r.counted !== false && roomArea(r) >= 1.5);
  if (!rooms.length) return;
  const b = planBounds(plan);
  const x0 = b.minX - 500;
  const y0 = b.minY - 500;
  const cols = Math.ceil((b.maxX - b.minX + 1000) / CELL);
  const rows = Math.ceil((b.maxY - b.minY + 1000) / CELL);
  const solid = new Uint8Array(cols * rows);
  const raster = (pts: readonly Vec2[], val = 1, target = solid) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const c0 = Math.max(0, Math.floor((minX - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.ceil((maxX - x0) / CELL));
    const r0 = Math.max(0, Math.floor((minY - y0) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((maxY - y0) / CELL));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (pointInPoly([x0 + (c + 0.5) * CELL, y0 + (r + 0.5) * CELL], pts)) target[r * cols + c] = val;
  };
  // 房间外面都当墙：只在屋里走
  const inside = new Uint8Array(cols * rows);
  for (const r of plan.rooms) raster(r.poly, 1, inside);
  for (const o of openings) if (o.kind !== 'window') raster(segmentOutline(o.a, o.b, o.thickness + 40), 1, inside);
  for (let i = 0; i < solid.length; i++) if (!inside[i]) solid[i] = 1;
  for (const w of walls) raster(w.pts);
  for (const f of plan.furniture) if (!NOT_BLOCKING.has(f.type) && !MOVABLE.has(f.type)) raster(furnitureCorners(f));
  // 门洞：不算瓶颈（门本来就比过道窄）
  const doorway = new Uint8Array(cols * rows);
  for (const o of openings) if (o.kind !== 'window') raster(segmentOutline(o.a, o.b, o.thickness + 200), 1, doorway);

  const dist = distanceField(solid, cols, rows);
  const width = (i: number) => (doorway[i] ? Infinity : dist[i]! * CELL * 2);

  // 起点：入户门里侧
  const entry = openings.find((o) => o.isEntry) ?? openings.find((o) => o.kind === 'door');
  if (!entry) return;
  const em: Vec2 = [(entry.a[0] + entry.b[0]) / 2, (entry.a[1] + entry.b[1]) / 2];
  let start = -1;
  let bestD = Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (solid[i] || dist[i]! * CELL < PASS_R) continue;
      const p: Vec2 = [x0 + (c + 0.5) * CELL, y0 + (r + 0.5) * CELL];
      const d = Math.hypot(p[0] - em[0], p[1] - em[1]);
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
  if (start < 0 || bestD > 1500) {
    out.push({
      id: 'path:entry',
      rule: 'path',
      severity: 'error',
      title: '入户门口被堵住了',
      detail: '门里面要留出至少 450 mm 宽的地方让人进来，600 mm 以上才好走。',
      shapes: [{kind: 'circle', c: em, r: 600}],
      at: em,
      furniture: [],
    });
    return;
  }

  // 最宽路径：每格记从入口走过来路上最窄的地方有多宽，以及上一格
  const bottleneck = new Float64Array(cols * rows).fill(-1);
  const parent = new Int32Array(cols * rows).fill(-1);
  const heap = new MaxHeap();
  bottleneck[start] = width(start);
  heap.push(bottleneck[start]!, start);
  while (heap.size) {
    const [w, i] = heap.pop();
    if (w < bottleneck[i]!) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1];
    for (const j of nb) {
      if (j < 0 || solid[j] || dist[j]! * CELL < PASS_R) continue;
      const nw = Math.min(w, width(j));
      if (nw > bottleneck[j]!) {
        bottleneck[j] = nw;
        parent[j] = i;
        heap.push(nw, j);
      }
    }
  }

  // 几个房间常常卡在同一个窄处：按窄处归在一起报一次
  const narrow = new Map<number, Room[]>();
  for (const room of rooms) {
    // 房间里最好到达的一格
    let best = -1;
    let bw = -1;
    let r0 = Infinity;
    let r1 = -Infinity;
    let c0 = Infinity;
    let c1 = -Infinity;
    for (const [x, y] of room.poly) {
      c0 = Math.min(c0, Math.floor((x - x0) / CELL));
      c1 = Math.max(c1, Math.ceil((x - x0) / CELL));
      r0 = Math.min(r0, Math.floor((y - y0) / CELL));
      r1 = Math.max(r1, Math.ceil((y - y0) / CELL));
    }
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const i = r * cols + c;
        if (bottleneck[i]! > bw && pointInPoly([x0 + (c + 0.5) * CELL, y0 + (r + 0.5) * CELL], room.poly)) {
          bw = bottleneck[i]!;
          best = i;
        }
      }
    if (best < 0) {
      out.push({
        id: `path:${room.id}`,
        rule: 'path',
        severity: 'error',
        title: `从入户门走不到${room.name}`,
        detail: '路被家具堵死了，或者剩下的缝不到 450 mm，侧身都过不去。挪开挡路的家具，让人能走进去。',
        shapes: [{kind: 'poly', pts: room.poly}],
        at: room.labelAt ?? polygonCentroid(room.poly),
        furniture: [],
      });
      continue;
    }
    if (bw >= NARROW) continue;
    // 顺着路径往回找最窄的那一格（一样窄时取离入口近的，几个房间就能归到同一处）
    let i = best;
    let narrowest = best;
    while (i >= 0) {
      if (width(i) <= width(narrowest)) narrowest = i;
      i = parent[i]!;
    }
    narrow.set(narrowest, [...(narrow.get(narrowest) ?? []), room]);
  }
  for (const [cell, rs] of narrow) {
    const c = cell % cols;
    const p: Vec2 = [x0 + (c + 0.5) * CELL, y0 + ((cell - c) / cols + 0.5) * CELL];
    const w = width(cell);
    const names = rs.length <= 2 ? rs.map((r) => r.name).join('、') : `${rs[0]!.name}、${rs[1]!.name}等 ${rs.length} 个房间`;
    out.push({
      id: `path:${rs[0]!.id}:narrow`,
      rule: 'path',
      severity: 'warn',
      title: `去${names}的路最窄只有 ${mmText(w)}`,
      detail:
        w < 600
          ? '要侧着身子才过得去，搬东西、端菜都难。主要通道建议 900 mm 左右，至少 750 mm。'
          : '一个人能过，端东西、两人错身就挤了。主要通道建议 900 mm 左右，至少 750 mm。',
      shapes: [{kind: 'circle', c: p, r: w / 2}],
      at: p,
      furniture: [],
    });
  }
}

/* ---------- 汇总 ---------- */

export function runCheckup(plan: Plan): Checkup {
  const openings = liveOpenings(plan);
  const walls = wallObstacles(plan, openings);
  const furniture: Obstacle[] = plan.furniture
    .filter((f) => !NOT_BLOCKING.has(f.type))
    .map((f) => ({pts: furnitureCorners(f), fid: f.id, name: f.name, type: f.type}));
  const obstacles = [...walls, ...furniture];
  const issues: Issue[] = [];
  bedRule(plan, obstacles, issues);
  frontRule(plan, obstacles, issues);
  doorRule(plan, openings, issues);
  overlapRule(plan, walls, issues);
  tableRule(plan, obstacles, issues);
  pathRule(plan, openings, walls, issues);
  // 同一个 id 只留一条
  const seen = new Set<string>();
  const unique = issues.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  unique.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const errors = unique.filter((i) => i.severity === 'error').length;
  const warns = unique.length - errors;
  const score = Math.max(0, Math.round(100 - errors * 10 - warns * 4));
  const passed = (Object.keys(RULES) as RuleId[]).filter((r) => !unique.some((i) => i.rule === r));
  return {score, issues: unique, passed};
}

/** 两次体检的差别：解决了哪些、新出了哪些，同一个问题从要改变成建议调（或反过来）也算 */
export function diffCheckups(
  before: Checkup,
  after: Checkup,
): {fixed: Issue[]; added: Issue[]; eased: Issue[]; worsened: Issue[]} {
  const b = new Map(before.issues.map((i) => [i.id, i]));
  const a = new Map(after.issues.map((i) => [i.id, i]));
  return {
    fixed: before.issues.filter((i) => !a.has(i.id)),
    added: after.issues.filter((i) => !b.has(i.id)),
    eased: after.issues.filter((i) => i.severity === 'warn' && b.get(i.id)?.severity === 'error'),
    worsened: after.issues.filter((i) => i.severity === 'error' && b.get(i.id)?.severity === 'warn'),
  };
}
