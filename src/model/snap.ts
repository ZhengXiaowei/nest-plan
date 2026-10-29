/**
 * 画墙吸附：描图（图片像素）和设计页砌墙（mm）共用，单位跟着输入走。
 */

export type P = [number, number];
type Pt = readonly [number, number];

/** 参与吸附的墙只需要中心线 */
export interface SnapWall {
  id: string;
  a: Pt;
  b: Pt;
}

export const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** 点到线段的投影：t ∈ [0,1] 为线段参数，point 为投影点 */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): {t: number; point: P; dist: number} {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const point: P = [a[0] + dx * t, a[1] + dy * t];
  return {t, point, dist: dist(p, point)};
}



export type SnapKind = 'endpoint' | 'wall' | 'axis' | 'align' | null;

export interface SnapResult {
  p: P;
  kind: SnapKind;
  /** 对齐参考线：x 或 y 方向对齐到的已有端点 */
  guides: {x?: number; y?: number};
}

const AXIS_SNAP_DEG = 12;

/**
 * 画墙时的吸附，优先级：已有端点 > 已有墙体 > 水平 / 垂直 > 与已有端点对齐。
 * free 为 true（按住 Shift）时不做轴向和对齐吸附。
 */
export function snapToWalls(
  walls: readonly SnapWall[],
  raw: Pt,
  opts: {radius: number; from?: Pt | null; free?: boolean; excludeWallIds?: string[]},
): SnapResult {
  const exclude = new Set(opts.excludeWallIds ?? []);
  const pool = walls.filter((w) => !exclude.has(w.id));

  let bestEnd: Pt | null = null;
  let bestEndD = opts.radius;
  for (const w of pool) {
    for (const e of [w.a, w.b]) {
      const d = dist(raw, e);
      if (d <= bestEndD) {
        bestEndD = d;
        bestEnd = e;
      }
    }
  }
  if (bestEnd) return {p: [bestEnd[0], bestEnd[1]], kind: 'endpoint', guides: {}};

  let p: P = [raw[0], raw[1]];
  let kind: SnapKind = null;

  if (opts.from && !opts.free) {
    const dx = p[0] - opts.from[0];
    const dy = p[1] - opts.from[1];
    const ang = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI;
    if (ang < AXIS_SNAP_DEG || ang > 180 - AXIS_SNAP_DEG) {
      p = [p[0], opts.from[1]];
      kind = 'axis';
    } else if (Math.abs(ang - 90) < AXIS_SNAP_DEG) {
      p = [opts.from[0], p[1]];
      kind = 'axis';
    }
  }

  // 落在已有墙上（T 形接头）
  let bestWall: P | null = null;
  let bestWallD = opts.radius;
  for (const w of pool) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist <= bestWallD) {
      bestWallD = pr.dist;
      bestWall = pr.point;
    }
  }
  if (bestWall) {
    // 轴向锁定时只沿锁定方向贴墙，避免线被拉歪
    if (kind === 'axis' && opts.from) {
      const horizontal = p[1] === opts.from[1];
      const onWall = intersectAxisWithWalls(pool, opts.from, horizontal, p, opts.radius);
      if (onWall) return {p: onWall, kind: 'wall', guides: {}};
    } else {
      return {p: bestWall, kind: 'wall', guides: {}};
    }
  }

  const guides: SnapResult['guides'] = {};
  if (!opts.free) {
    let gx = opts.radius;
    let gy = opts.radius;
    for (const w of pool) {
      for (const e of [w.a, w.b]) {
        const lockX = kind === 'axis' && opts.from && p[0] === opts.from[0];
        const lockY = kind === 'axis' && opts.from && p[1] === opts.from[1];
        if (!lockX && Math.abs(e[0] - p[0]) < gx) {
          gx = Math.abs(e[0] - p[0]);
          guides.x = e[0];
        }
        if (!lockY && Math.abs(e[1] - p[1]) < gy) {
          gy = Math.abs(e[1] - p[1]);
          guides.y = e[1];
        }
      }
    }
    if (guides.x !== undefined) p = [guides.x, p[1]];
    if (guides.y !== undefined) p = [p[0], guides.y];
    if ((guides.x !== undefined || guides.y !== undefined) && !kind) kind = 'align';
  }
  return {p, kind, guides};
}

/** 轴向锁定的线与附近墙体的交点 */
function intersectAxisWithWalls(walls: readonly SnapWall[], from: Pt, horizontal: boolean, p: Pt, radius: number): P | null {
  let best: P | null = null;
  let bestD = radius;
  for (const w of walls) {
    const [ax, ay] = w.a;
    const [bx, by] = w.b;
    if (horizontal) {
      const y = from[1];
      if ((ay - y) * (by - y) > 0 || ay === by) continue;
      const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
      const d = Math.abs(x - p[0]);
      if (d <= bestD) {
        bestD = d;
        best = [x, y];
      }
    } else {
      const x = from[0];
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const y = ay + ((x - ax) / (bx - ax)) * (by - ay);
      const d = Math.abs(y - p[1]);
      if (d <= bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}
