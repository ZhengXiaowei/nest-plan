import type {Furniture, Opening, Plan, Vec2, Wall} from './types';
import {furnitureHalfExtents, snap} from './geometry';

/**
 * 墙体相关的几何：拆改后的有效墙、墙在门窗处断开、家具贴墙吸附、测量点吸附。
 * 单位 mm。
 */

export const wallLength = (w: Pick<Wall, 'a' | 'b'>) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** 改造后还在的墙：去掉拆除的，含新砌的 */
export function activeWalls(plan: Plan): Wall[] {
  if (!plan.demolished.length) return plan.walls;
  const gone = new Set(plan.demolished);
  return plan.walls.filter((w) => !gone.has(w.id));
}

/**
 * 改造后还在的门窗：所在的墙被拆了，门窗也就没了。
 * 有的户型门窗压在整段墙上，有的门窗是墙上的缺口（两边墙断开），两种都算。
 */
export function liveOpenings(plan: Plan): Opening[] {
  if (!plan.demolished.length) return plan.openings;
  const gone = plan.walls.filter((w) => plan.demolished.includes(w.id));
  const live = activeWalls(plan);
  return plan.openings.filter((o) => {
    const mid: Vec2 = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    const on = (w: Wall) => distToSegment(mid, w.a, w.b) <= w.thickness / 2 + 30;
    return !gone.some(on) || live.some(on);
  });
}

/** 改造前就有的墙（毛坯）：不含新砌的 */
export function originalWalls(plan: Plan): Wall[] {
  return plan.walls.filter((w) => !w.added);
}

/** 承重墙和外墙不能拆 */
export function canDemolish(w: Wall): boolean {
  return w.kind === 'partition' || w.kind === 'low';
}

/** 点到线段的距离 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * 墙在门窗处断开，返回实体墙段。
 * 描图生成的墙是一整段，门窗压在上面；3D 和碰撞都需要真正的洞口。
 */
export function wallPieces(wall: Wall, openings: readonly Opening[]): [Vec2, Vec2][] {
  const len = wallLength(wall);
  if (len <= 0) return [];
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uy = (wall.b[1] - wall.a[1]) / len;
  const along = (p: Vec2) => (p[0] - wall.a[0]) * ux + (p[1] - wall.a[1]) * uy;
  const off = (p: Vec2) => Math.abs(-(p[0] - wall.a[0]) * uy + (p[1] - wall.a[1]) * ux);
  const tol = wall.thickness / 2 + 20;

  const cuts: [number, number][] = [];
  for (const o of openings) {
    if (off(o.a) > tol || off(o.b) > tol) continue;
    let t0 = along(o.a);
    let t1 = along(o.b);
    if (t0 > t1) [t0, t1] = [t1, t0];
    t0 = Math.max(0, t0);
    t1 = Math.min(len, t1);
    if (t1 - t0 > 1) cuts.push([t0, t1]);
  }
  if (!cuts.length) return [[wall.a, wall.b]];
  cuts.sort((x, y) => x[0] - y[0]);

  const at = (t: number): Vec2 => [wall.a[0] + ux * t, wall.a[1] + uy * t];
  const pieces: [Vec2, Vec2][] = [];
  let cur = 0;
  for (const [t0, t1] of cuts) {
    if (t0 - cur > 1) pieces.push([at(cur), at(t0)]);
    cur = Math.max(cur, t1);
  }
  if (len - cur > 1) pieces.push([at(cur), wall.b]);
  return pieces;
}

/** 轴对齐矩形 [x0, y0, x1, y1] */
export type Rect = [number, number, number, number];

/** 横平竖直的墙的外轮廓矩形，用来给家具和测量做吸附；斜墙不参与 */
export function wallRects(plan: Plan): Rect[] {
  const rects: Rect[] = [];
  for (const w of activeWalls(plan)) {
    const h = w.thickness / 2;
    if (Math.abs(w.a[1] - w.b[1]) < 1) {
      rects.push([Math.min(w.a[0], w.b[0]) - h, w.a[1] - h, Math.max(w.a[0], w.b[0]) + h, w.a[1] + h]);
    } else if (Math.abs(w.a[0] - w.b[0]) < 1) {
      rects.push([w.a[0] - h, Math.min(w.a[1], w.b[1]) - h, w.a[0] + h, Math.max(w.a[1], w.b[1]) + h]);
    }
  }
  return rects;
}

/** 拖家具：先按网格取整，再在容差内贴到最近的墙面 */
export function snapFurniture(rects: readonly Rect[], f: Furniture, cx: number, cy: number, tol: number, grid = 10): [number, number] {
  let nx = snap(cx, grid);
  let ny = snap(cy, grid);
  const {hw, hh} = furnitureHalfExtents(f);
  let bx = tol;
  let by = tol;
  for (const r of rects) {
    // 只跟上下（左右）范围有重叠的墙比
    if (!(r[3] < cy - hh - tol || r[1] > cy + hh + tol)) {
      for (const ex of [r[0], r[2]])
        for (const c of [ex + hw, ex - hw])
          if (Math.abs(c - cx) < bx) {
            bx = Math.abs(c - cx);
            nx = c;
          }
    }
    if (!(r[2] < cx - hw - tol || r[0] > cx + hw + tol)) {
      for (const ey of [r[1], r[3]])
        for (const c of [ey + hh, ey - hh])
          if (Math.abs(c - cy) < by) {
            by = Math.abs(c - cy);
            ny = c;
          }
    }
  }
  return [nx, ny];
}

/** 新放进来的家具如果压在墙里，推到墙外最近的一侧 */
export function pushOut(rects: readonly Rect[], f: Furniture): [number, number] {
  let {cx, cy} = f;
  const {hw, hh} = furnitureHalfExtents(f);
  for (let n = 0; n < 4; n++) {
    let moved = false;
    for (const r of rects) {
      const ox = Math.min(cx + hw, r[2]) - Math.max(cx - hw, r[0]);
      const oy = Math.min(cy + hh, r[3]) - Math.max(cy - hh, r[1]);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) cx = cx < (r[0] + r[2]) / 2 ? r[0] - hw : r[2] + hw;
      else cy = cy < (r[1] + r[3]) / 2 ? r[1] - hh : r[3] + hh;
      moved = true;
    }
    if (!moved) break;
  }
  return [cx, cy];
}

/** 测量点：贴墙面，Shift 时锁水平 / 垂直 */
export function snapMeasurePoint(rects: readonly Rect[], p: Vec2, tol: number, from: Vec2 | null, lock: boolean): Vec2 {
  let x = snap(p[0], 10);
  let y = snap(p[1], 10);
  let bx = tol;
  let by = tol;
  for (const r of rects) {
    for (const ex of [r[0], r[2]])
      if (Math.abs(ex - p[0]) < bx) {
        bx = Math.abs(ex - p[0]);
        x = ex;
      }
    for (const ey of [r[1], r[3]])
      if (Math.abs(ey - p[1]) < by) {
        by = Math.abs(ey - p[1]);
        y = ey;
      }
  }
  if (lock && from) {
    if (Math.abs(x - from[0]) > Math.abs(y - from[1])) y = from[1];
    else x = from[0];
  }
  return [x, y];
}

/** 改造统计：拆了多少米墙、新砌多少米 */
export function renovationStats(plan: Plan): {demolishedM: number; addedM: number} {
  const gone = new Set(plan.demolished);
  let d = 0;
  let a = 0;
  for (const w of plan.walls) {
    if (gone.has(w.id)) d += wallLength(w);
    else if (w.added) a += wallLength(w);
  }
  return {demolishedM: d / 1000, addedM: a / 1000};
}

/**
 * 墙角补齐：两段墙在端点相接（L 形、十字）时，各自向外延长对方半个墙厚，
 * 否则中心线相接的墙角会缺一个小方块。T 形接头（端点落在另一段墙中间）本来就埋在墙里，不用管。
 */
export function withCorners(walls: readonly Wall[]): Wall[] {
  return walls.map((w) => {
    const len = wallLength(w);
    if (len <= 0) return w;
    const ux = (w.b[0] - w.a[0]) / len;
    const uy = (w.b[1] - w.a[1]) / len;
    const ext = (p: Vec2) => {
      let e = 0;
      for (const o of walls) {
        if (o === w) continue;
        const shared = Math.hypot(o.a[0] - p[0], o.a[1] - p[1]) < 1 || Math.hypot(o.b[0] - p[0], o.b[1] - p[1]) < 1;
        if (!shared) continue;
        const ol = wallLength(o) || 1;
        const cross = Math.abs(ux * ((o.b[1] - o.a[1]) / ol) - uy * ((o.b[0] - o.a[0]) / ol));
        if (cross > 0.1) e = Math.max(e, o.thickness / 2);
      }
      return e;
    };
    const ea = ext(w.a);
    const eb = ext(w.b);
    if (!ea && !eb) return w;
    return {...w, a: [w.a[0] - ux * ea, w.a[1] - uy * ea], b: [w.b[0] + ux * eb, w.b[1] + uy * eb]};
  });
}
