import type {Plan, Room, Vec2} from '../../model/types';
import {planBounds, polygonArea, polygonCentroid} from '../../model/geometry';
import {distToSegment} from '../../model/walls';
import {blocked, buildColliders, furnitureFootprints, pointInPolygon, startPose, type Collider} from '../view3d/walk';

/**
 * 回放里的漫游路线：从入户门进屋，按就近顺序走遍每个房间，
 * 在网格上用 A* 绕开墙和家具，再拉直、倒圆角。单位 m（场景坐标 x, z）。
 */

const CELL = 0.05;
/** 路线离墙和家具至少这么远（700 的卫生间门也要过得去） */
const CLEAR = 0.18;
/** 离墙 40 cm 以外的格子代价不超过这个 */
const COMFORT = 1.8;
/** 太小的房间（储物间、管井）不进去 */
const MIN_ROOM_AREA = 2.5e6;

export interface RouteStop {
  room: Room;
  /** 路线上停下来环视的点 */
  at: Vec2;
  /** 停下时最值得看的方向：视线最远、能看到最多房间的那边（yaw，0 朝 -z） */
  view: number;
}

export interface Route {
  /** 起点 + 每段走到下一个房间的折线（已拉直倒角） */
  start: Vec2;
  startYaw: number;
  legs: {to: RouteStop; path: Vec2[]}[];
}

interface Grid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  free: Uint8Array;
  cost: Float32Array;
}

function buildGrid(plan: Plan, colliders: readonly Collider[]): Grid {
  const b = planBounds(plan);
  const x0 = b.minX / 1000 - 0.5;
  const z0 = b.minY / 1000 - 0.5;
  const nx = Math.ceil((b.maxX - b.minX) / 1000 / CELL) + 20;
  const nz = Math.ceil((b.maxY - b.minY) / 1000 / CELL) + 20;
  const free = new Uint8Array(nx * nz);
  const cost = new Float32Array(nx * nz);

  // 按 1 m 分块收碰撞体，每格只和附近的比：只关心 0.7 m 以内的
  const TILE = 1;
  const REACH = 0.7;
  const tx = Math.ceil((nx * CELL) / TILE);
  const tz = Math.ceil((nz * CELL) / TILE);
  const tiles: Collider[][] = Array.from({length: tx * tz}, () => []);
  for (const c of colliders) {
    const pad = c.half + REACH;
    const i0 = Math.max(0, Math.floor((Math.min(c.a[0], c.b[0]) - pad - x0) / TILE));
    const i1 = Math.min(tx - 1, Math.floor((Math.max(c.a[0], c.b[0]) + pad - x0) / TILE));
    const j0 = Math.max(0, Math.floor((Math.min(c.a[1], c.b[1]) - pad - z0) / TILE));
    const j1 = Math.min(tz - 1, Math.floor((Math.max(c.a[1], c.b[1]) + pad - z0) / TILE));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tiles[j * tx + i]!.push(c);
  }

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p: Vec2 = [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL];
      // 离最近的墙面 / 家具边还有多远
      let clear = REACH;
      for (const c of tiles[Math.floor((j * CELL) / TILE) * tx + Math.floor((i * CELL) / TILE)]!) {
        const d = distToSegment(p, c.a, c.b) - c.half;
        if (d < clear) clear = d;
      }
      if (clear < CLEAR) continue;
      const k = j * nx + i;
      free[k] = 1;
      // 贴墙走的格子贵一点，路线会尽量走在通道中间
      cost[k] = 1 + (clear < 0.4 ? 3 : 0) + (clear < 0.65 ? 0.8 : 0);
    }
  }

  // 家具里面也不能走（碰撞体只是外框，床和餐桌中间会空出一块）
  for (const q of furnitureFootprints(plan)) {
    const xs = q.map((v) => v[0]);
    const zs = q.map((v) => v[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / CELL));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / CELL));
    const j1 = Math.min(nz - 1, Math.floor((Math.max(...zs) - z0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (pointInPolygon([x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL], q)) free[j * nx + i] = 0;
  }
  return {x0, z0, nx, nz, free, cost};
}

const cellOf = (g: Grid, p: Vec2) => [Math.floor((p[0] - g.x0) / CELL), Math.floor((p[1] - g.z0) / CELL)] as const;
const centerOf = (g: Grid, k: number): Vec2 => [g.x0 + ((k % g.nx) + 0.5) * CELL, g.z0 + (Math.floor(k / g.nx) + 0.5) * CELL];

/** 离 p 最近的可走格子（广度优先，最多找 1.5 m） */
function nearestFree(g: Grid, p: Vec2): number | null {
  const [ci, cj] = cellOf(g, p);
  const R = Math.round(1.2 / CELL);
  let best: number | null = null;
  let bestD = Infinity;
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const k = j * g.nx + i;
      if (!g.free[k]) continue;
      const d = di * di + dj * dj;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  }
  return best;
}

/** 小顶堆：键和节点分开存在定长数组里，过期的条目出堆时跳过 */
class Heap {
  keys = new Float64Array(1024);
  nodes = new Int32Array(1024);
  size = 0;
  push(key: number, node: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const n = new Int32Array(this.size * 2);
      k.set(this.keys);
      n.set(this.nodes);
      this.keys = k;
      this.nodes = n;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.keys[i] = this.keys[p]!;
      this.nodes[i] = this.nodes[p]!;
      i = p;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
  }
  /** 弹出最小的节点（调用前确认 size > 0） */
  pop(): number {
    const top = this.nodes[0]!;
    const key = this.keys[--this.size]!;
    const node = this.nodes[this.size]!;
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1]! < this.keys[c]!) c++;
      if (this.keys[c]! >= key) break;
      this.keys[i] = this.keys[c]!;
      this.nodes[i] = this.nodes[c]!;
      i = c;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
    return top;
  }
}

const D = Math.SQRT2;
const STEPS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, D],
  [1, -1, D],
  [-1, 1, D],
  [-1, -1, D],
] as const;

/**
 * 从 from 出发找最近的目标格子（Dijkstra，8 邻接），第一个出堆的目标就是路程最短的。
 * 返回目标格子和回溯用的 prev；一个都到不了时 hit 为 -1。
 */
function nearestTarget(g: Grid, from: number, targets: ReadonlySet<number>): {hit: number; prev: Int32Array} {
  const n = g.nx * g.nz;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (targets.has(k)) return {hit: k, prev};
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    for (const [di, dj, len] of STEPS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const nk = nj * g.nx + ni;
      if (!g.free[nk] || done[nk]) continue;
      // 斜着走不能擦过墙角
      if (di && dj && (!g.free[j * g.nx + ni] || !g.free[nj * g.nx + i])) continue;
      const nd = dist[k]! + len * g.cost[nk]!;
      if (nd < dist[nk]!) {
        dist[nk] = nd;
        prev[nk] = k;
        heap.push(nd, nk);
      }
    }
  }
  return {hit: -1, prev};
}

function walkBack(g: Grid, prev: Int32Array, to: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = to; k !== -1; k = prev[k]!) out.push(centerOf(g, k));
  return out.reverse();
}

/**
 * 两点之间能不能直着走过去：沿线每半格查一次网格。
 * maxCost 限制沿途格子的代价：拉直时只穿过离墙 40 cm 以外的格子，镜头不会贴着墙角擦过去。
 */
function lineFree(g: Grid, a: Vec2, b: Vec2, maxCost = Infinity): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (CELL / 2)));
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const [i, j] = cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || !g.free[j * g.nx + i] || g.cost[j * g.nx + i]! > maxCost) return false;
  }
  return true;
}

/** 拉直：能直走就跳过中间的格子 */
function pull(g: Grid, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineFree(g, pts[i]!, pts[j]!, COMFORT)) j--;
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

/** Chaikin 倒圆角两次；倒完如果蹭到墙就用原折线 */
function round(g: Grid, pts: Vec2[]): Vec2[] {
  let cur = pts;
  for (let it = 0; it < 2; it++) {
    if (cur.length < 3) return cur;
    const next: Vec2[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      const q: Vec2 = [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25];
      const r: Vec2 = [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75];
      if (i > 0) next.push(q);
      if (i < cur.length - 2) next.push(r);
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  for (let i = 0; i < cur.length - 1; i++) if (!lineFree(g, cur[i]!, cur[i + 1]!)) return pts;
  return cur;
}

/** 要去的房间：计入面积、够大的 */
export function tourRooms(plan: Plan): Room[] {
  return plan.rooms.filter((r) => r.counted !== false && polygonArea(r.poly) >= MIN_ROOM_AREA);
}

/** 从 at 朝 32 个方向看，挑视线最远的一边（只看墙，不看家具） */
function bestView(walls: readonly Collider[], at: Vec2): number {
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < 32; i++) {
    const yaw = (i / 32) * Math.PI * 2;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let d = 0;
    while (d < 12 && !blocked(walls, [at[0] + dx * d, at[1] + dz * d], 0.05)) d += 0.1;
    // 稍微偏好看向房间中间的方向：两侧也要远
    if (d > bestD) {
      bestD = d;
      best = yaw;
    }
  }
  return best;
}

export function planRoute(plan: Plan): Route {
  const colliders = buildColliders(plan);
  const walls = buildColliders(plan, {furniture: false});
  const pose = startPose(plan);
  const g = buildGrid(plan, colliders);
  let curCell = nearestFree(g, pose.pos);
  const route: Route = {start: pose.pos, startYaw: pose.yaw, legs: []};
  if (curCell === null) return route;
  route.start = centerOf(g, curCell);

  // 每个房间的停留点：房间里离中心近、四周又宽敞的可走处（中心常被床和餐桌占着）
  const targets = tourRooms(plan).flatMap((room) => {
    const c = polygonCentroid(room.poly);
    const cxm = c[0] / 1000;
    const czm = c[1] / 1000;
    let best = -1;
    let bestScore = Infinity;
    const xs = room.poly.map((q) => q[0] / 1000);
    const zs = room.poly.map((q) => q[1] / 1000);
    const [i0, j0] = cellOf(g, [Math.min(...xs), Math.min(...zs)]);
    const [i1, j1] = cellOf(g, [Math.max(...xs), Math.max(...zs)]);
    for (let j = Math.max(0, j0); j <= Math.min(g.nz - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(g.nx - 1, i1); i++) {
        const k = j * g.nx + i;
        if (!g.free[k]) continue;
        const at = centerOf(g, k);
        if (!pointInPolygon([at[0] * 1000, at[1] * 1000], room.poly)) continue;
        const score = Math.hypot(at[0] - cxm, at[1] - czm) + (g.cost[k]! - 1) * 0.35;
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
    }
    return best < 0 ? [] : [{room, at: centerOf(g, best), k: best}];
  });

  // 就近原则：每次去路程最短的下一个房间；到不了的跳过
  const left = [...targets];
  // 先看进门的那个房间，之后每次去路程最短的下一个；到不了的跳过
  const startIn = left.findIndex((t) => pointInPolygon([route.start[0] * 1000, route.start[1] * 1000], t.room.poly));
  if (startIn > 0) left.unshift(...left.splice(startIn, 1));
  let only: number | null = startIn >= 0 ? left[0]!.k : null;
  while (left.length) {
    let {hit, prev} = nearestTarget(g, curCell, new Set(only !== null ? [only] : left.map((t) => t.k)));
    if (hit < 0 && only !== null) ({hit, prev} = nearestTarget(g, curCell, new Set(left.map((t) => t.k))));
    only = null;
    if (hit < 0) break;
    let raw = walkBack(g, prev, hit);
    // 路上先穿过了别的没去过的房间（比如去主卫要经过主卧），就先停在那个房间
    const via = raw.findIndex((p, i) => i > 0 && left.some((x) => x.k !== hit && pointInPolygon([p[0] * 1000, p[1] * 1000], x.room.poly)));
    if (via > 0) {
      const p = raw[via]!;
      const other = left.find((x) => x.k !== hit && pointInPolygon([p[0] * 1000, p[1] * 1000], x.room.poly))!;
      const again = nearestTarget(g, curCell, new Set([other.k]));
      if (again.hit >= 0) {
        hit = again.hit;
        raw = walkBack(g, again.prev, hit);
      }
    }
    const t = left.splice(left.findIndex((x) => x.k === hit), 1)[0]!;
    raw[0] = centerOf(g, curCell);
    route.legs.push({to: {room: t.room, at: t.at, view: bestView(walls, t.at)}, path: round(g, pull(g, raw))});
    curCell = t.k;
  }
  return route;
}

export const pathLength = (pts: readonly Vec2[]) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return s;
};

/** 折线上按弧长取点 */
export function pointAlong(pts: readonly Vec2[], s: number): Vec2 {
  if (pts.length === 1 || s <= 0) return pts[0]!;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= s) {
      const t = l ? (s - acc) / l : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1]!;
}
