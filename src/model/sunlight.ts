import type {Opening, Plan, Site, Vec2} from './types';
import {activeWalls, distToSegment, liveOpenings, wallPieces} from './walls';
import {roomArea} from './geometry';
import {daylight, solarPosition, sunDirOnPlan} from './sun';

/**
 * 室内日照分析：把每个房间的地面切成小格，太阳从日出走到日落，
 * 每 10 分钟从格子中心朝太阳打一条光线，看它能不能穿过窗户照进来。
 *
 * 光线碰到墙要看高度：墙实心的那段挡光，窗洞（窗台到窗顶）和推拉门的玻璃透光，平开门当作关着。
 * 光线还在屋里时升到层高以上，就是被天花板（楼上）挡住了。穿出外墙到了室外就算照到。
 * 只算户型本身，不算对面楼、阳台外的遮挡和窗框。
 */

export const SUN_STEP_MIN = 10;

export interface SunRoomStat {
  id: string;
  name: string;
  /** 房间地面平均日照时长（小时） */
  avg: number;
  /** 日照最长的那一块地面（小时） */
  max: number;
  /** 至少晒到 1 小时的地面占比 0..1 */
  share: number;
  /** 地面面积 ㎡ */
  area: number;
}

export interface SunResult {
  /** 网格左上角（mm）、格子边长、列数、行数 */
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 每格属于第几个房间，-1 表示不在房间里 */
  room: Int16Array;
  /** 每个时刻的钟点（北京时间） */
  times: number[];
  /** lit[step * cells + i] = 1 表示这个时刻这格有阳光 */
  lit: Uint8Array;
  /** 每格全天日照小时数 */
  hours: Float32Array;
  rooms: SunRoomStat[];
}

/** 挡光的线段：沿线段在 [lo, hi] 高度区间不透光（mm） */
interface Blocker {
  a: Vec2;
  b: Vec2;
  solid: [number, number][];
}

function pointInPoly(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function openingSolid(o: Opening, wallH: number): [number, number][] {
  const head = Math.min(wallH, o.head ?? 2100);
  if (o.kind === 'window') return [[0, o.sill ?? 900], [head, wallH]];
  if (o.kind === 'door' && o.swing) return [[0, wallH]];
  return [[head, wallH]];
}

/** 改造后的墙体 + 门窗，拆成挡光线段 */
export function sunBlockers(plan: Plan): Blocker[] {
  const walls = activeWalls(plan);
  const out: Blocker[] = [];
  for (const w of walls) {
    const h = w.height ?? (w.kind === 'low' ? 1000 : plan.wallHeight);
    // 两头各伸出半个墙厚：墙在转角、丁字口处的中心线往往不相交，不伸出去光会从缝里漏进来。
    // 伸出去的部分压到门窗上会被 wallPieces 切掉，不影响洞口宽度。
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const e = len > 0 ? w.thickness / 2 / len : 0;
    const dx = (w.b[0] - w.a[0]) * e;
    const dy = (w.b[1] - w.a[1]) * e;
    const long = {...w, a: [w.a[0] - dx, w.a[1] - dy] as Vec2, b: [w.b[0] + dx, w.b[1] + dy] as Vec2};
    for (const [a, b] of wallPieces(long, plan.openings)) out.push({a, b, solid: [[0, h]]});
  }
  // 所在的墙被拆了，门窗也就没了；墙上缺口式的门窗按最近那面墙的高度算
  for (const o of liveOpenings(plan)) {
    const mid: Vec2 = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    let host: (typeof walls)[number] | undefined;
    let best = Infinity;
    for (const w of walls) {
      const d = distToSegment(mid, w.a, w.b);
      if (d < best) [best, host] = [d, w];
    }
    out.push({a: o.a, b: o.b, solid: openingSolid(o, host?.height ?? plan.wallHeight)});
  }
  return out;
}

/**
 * 室外区域：从网格外圈出发泛洪，墙和门窗都当实心。
 * 返回查询函数：某点是不是在室外。
 */
function outsideMask(blockers: Blocker[], x0: number, y0: number, x1: number, y1: number) {
  const cell = 100;
  const pad = 2;
  const cols = Math.ceil((x1 - x0) / cell) + pad * 2;
  const rows = Math.ceil((y1 - y0) / cell) + pad * 2;
  const ox = x0 - pad * cell;
  const oy = y0 - pad * cell;
  const solid = new Uint8Array(cols * rows);
  const half = cell * 0.75;
  for (const bl of blockers) {
    const minX = Math.floor((Math.min(bl.a[0], bl.b[0]) - half - ox) / cell);
    const maxX = Math.ceil((Math.max(bl.a[0], bl.b[0]) + half - ox) / cell);
    const minY = Math.floor((Math.min(bl.a[1], bl.b[1]) - half - oy) / cell);
    const maxY = Math.ceil((Math.max(bl.a[1], bl.b[1]) + half - oy) / cell);
    for (let r = Math.max(0, minY); r <= Math.min(rows - 1, maxY); r++)
      for (let c = Math.max(0, minX); c <= Math.min(cols - 1, maxX); c++) {
        if (distToSegment([ox + (c + 0.5) * cell, oy + (r + 0.5) * cell], bl.a, bl.b) <= half) solid[r * cols + c] = 1;
      }
  }
  const out = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (let c = 0; c < cols; c++) stack.push(c, (rows - 1) * cols + c);
  for (let r = 0; r < rows; r++) stack.push(r * cols, r * cols + cols - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] || solid[i]) continue;
    out[i] = 1;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
  }
  return (p: Vec2) => {
    const c = Math.floor((p[0] - ox) / cell);
    const r = Math.floor((p[1] - oy) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return true;
    return out[r * cols + c] === 1;
  };
}

export interface SunOptions {
  /** 格子边长 mm */
  cell?: number;
  /** 取样高度 mm，0 是地面 */
  height?: number;
}

export function computeSunlight(plan: Plan, site: Site, doy: number, opts: SunOptions = {}): SunResult {
  const cell = opts.cell ?? 200;
  const h0 = opts.height ?? 0;
  const rooms = plan.rooms.filter((r) => r.poly.length >= 3);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rooms)
    for (const [x, y] of r.poly) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!rooms.length) {
    return {x0: 0, y0: 0, cell, cols: 0, rows: 0, room: new Int16Array(0), times: [], lit: new Uint8Array(0), hours: new Float32Array(0), rooms: []};
  }
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell));
  const rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  const cells = cols * rows;
  const room = new Int16Array(cells).fill(-1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p: Vec2 = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
      // 后画的房间（比如飘窗）盖在前面的上面
      for (let k = rooms.length - 1; k >= 0; k--)
        if (pointInPoly(p, rooms[k]!.poly)) {
          room[r * cols + c] = k;
          break;
        }
    }

  const blockers = sunBlockers(plan);
  const isOutside = outsideMask(blockers, x0 - 3000, y0 - 3000, x1 + 3000, y1 + 3000);
  const ceiling = plan.wallHeight;

  const span = daylight(site, doy);
  const times: number[] = [];
  if (span) for (let m = Math.ceil((span[0] * 60) / SUN_STEP_MIN) * SUN_STEP_MIN; m <= span[1] * 60; m += SUN_STEP_MIN) times.push(m / 60);

  const lit = new Uint8Array(times.length * cells);
  // 挡光线段摊平成数组，内层循环不分配对象
  const nb = blockers.length;
  const bax = new Float64Array(nb);
  const bay = new Float64Array(nb);
  const bex = new Float64Array(nb);
  const bey = new Float64Array(nb);
  blockers.forEach((bl, k) => {
    bax[k] = bl.a[0];
    bay[k] = bl.a[1];
    bex[k] = bl.b[0] - bl.a[0];
    bey[k] = bl.b[1] - bl.a[1];
  });
  const hitT = new Float64Array(nb);
  const hitK = new Int32Array(nb);
  const probe: [number, number] = [0, 0];
  times.forEach((hour, step) => {
    const {az, el} = solarPosition(site, doy, hour);
    // 太阳太低时基本照不进来，也避免数值问题
    if (el < 2 * (Math.PI / 180)) return;
    const [dx, dy] = sunDirOnPlan(az, site.north);
    const tanEl = Math.tan(el);
    for (let i = 0; i < cells; i++) {
      if (room[i]! < 0) continue;
      const c = i % cols;
      const px = x0 + (c + 0.5) * cell;
      const py = y0 + ((i - c) / cols + 0.5) * cell;
      // 收集交点，按距离插入排序（一般只有几个）
      let n = 0;
      for (let k = 0; k < nb; k++) {
        const ex = bex[k]!;
        const ey = bey[k]!;
        const den = dx * ey - dy * ex;
        if (den > -1e-9 && den < 1e-9) continue;
        const ax = bax[k]! - px;
        const ay = bay[k]! - py;
        const t = (ax * ey - ay * ex) / den;
        if (t <= 1) continue;
        const u = (ax * dy - ay * dx) / den;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        let j = n++;
        while (j > 0 && hitT[j - 1]! > t) {
          hitT[j] = hitT[j - 1]!;
          hitK[j] = hitK[j - 1]!;
          j--;
        }
        hitT[j] = t;
        hitK[j] = k;
      }
      let ok = true;
      for (let j = 0; j < n; j++) {
        const t = hitT[j]!;
        const z = h0 + t * tanEl;
        if (z >= ceiling || blockers[hitK[j]!]!.solid.some(([lo, hi]) => z >= lo && z < hi)) {
          ok = false;
          break;
        }
        probe[0] = px + dx * (t + 150);
        probe[1] = py + dy * (t + 150);
        if (isOutside(probe)) break;
      }
      if (ok) lit[step * cells + i] = 1;
    }
  });

  const hours = new Float32Array(cells);
  const stepH = SUN_STEP_MIN / 60;
  for (let s = 0; s < times.length; s++) for (let i = 0; i < cells; i++) if (lit[s * cells + i]) hours[i]! += stepH;

  const stats: SunRoomStat[] = rooms.map((r, k) => {
    let n = 0;
    let sum = 0;
    let max = 0;
    let good = 0;
    for (let i = 0; i < cells; i++) {
      if (room[i] !== k) continue;
      const h = hours[i]!;
      n++;
      sum += h;
      max = Math.max(max, h);
      if (h >= 1) good++;
    }
    return {id: r.id, name: r.name, avg: n ? sum / n : 0, max, share: n ? good / n : 0, area: roomArea(r)};
  });

  return {x0, y0, cell, cols, rows, room, times, lit, hours, rooms: stats};
}

/** 日照时长的评价，给房间列表用 */
export function sunGrade(hours: number): {label: string; tone: 'good' | 'mid' | 'low'} {
  if (hours >= 3) return {label: '充足', tone: 'good'};
  if (hours >= 1) return {label: '一般', tone: 'mid'};
  return {label: '偏少', tone: 'low'};
}
