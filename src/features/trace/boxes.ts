import type {OpeningKind, WallKind} from '../../model/types';
import {projectOnSegment} from '../../model/snap';
import {uid} from '../../lib/id';
import {MANUAL_THICKNESS, openingOnWall, type Draft, type DraftOpening, type DraftRoom, type DraftWall, type P} from './draft';

/**
 * 框房间：用户在户型图上给每个房间拖一个矩形，墙由方框的边现算出来。
 * 全部是图片像素坐标；门窗和墙类型按「图上位置点」挂到现算出的墙上，拖方框后它们留在原处。
 */

export interface Box {
  id: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  source: 'ai' | 'manual';
}

export type MarkKind = 'door' | 'slidingDoor' | 'window' | 'entry';

/** 门窗：挂在离 at 最近的墙上，以 at 为中心 */
export interface Mark {
  id: string;
  kind: MarkKind;
  at: P;
  /** 按图猜的，用户还没点过 */
  guessed?: boolean;
}

/** 墙类型：离 at 最近的那段墙是承重、非承重，还是敞开（两个房间之间其实没有墙，比如客餐厅） */
export interface WallMark {
  at: P;
  kind: 'bearing' | 'partition' | 'open';
  guessed?: boolean;
}

export interface BoxWall {
  /** 由几何算出的 id，方框不变时不变 */
  id: string;
  /** 横墙 a 在左、竖墙 a 在上 */
  a: P;
  b: P;
  axis: 'h' | 'v';
  /** 两侧的方框：横墙 [上, 下]，竖墙 [左, 右]；null 表示那一侧是户外 */
  sides: [string | null, string | null];
}

export const isExterior = (w: BoxWall) => !w.sides[0] || !w.sides[1];

export const MARK_WIDTH_MM: Record<MarkKind, number> = {door: 900, entry: 1000, slidingDoor: 2400, window: 1500};
export const MARK_LABEL: Record<MarkKind, string> = {door: '门', entry: '入户门', slidingDoor: '推拉门', window: '窗'};

/** 常见房间名，框好一个方框后一点就选 */
export const ROOM_NAMES = ['客厅', '餐厅', '主卧', '次卧', '儿童房', '书房', '厨房', '卫生间', '主卫', '阳台', '玄关', '过道', '衣帽间', '洗衣房'];

/** 规整方框：x0 < x1，y0 < y1 */
export function normBox<T extends Pick<Box, 'x0' | 'y0' | 'x1' | 'y1'>>(b: T): T {
  return {...b, x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1)};
}

const EPS = 0.5;

/** 方框 → 墙。每条直线上按所有边的端点切段，看两侧各是哪个方框，两侧相同的相邻段合并 */
export function wallsFromBoxes(boxes: readonly Box[]): BoxWall[] {
  const bs = boxes.map(normBox).filter((b) => b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1);
  const inside = (x: number, y: number) => bs.find((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)?.id ?? null;
  const out: BoxWall[] = [];

  for (const axis of ['h', 'v'] as const) {
    // 横线：line = y，沿 x；竖线：line = x，沿 y
    const edges = bs.flatMap((b) =>
      axis === 'h'
        ? [{line: b.y0, s0: b.x0, s1: b.x1}, {line: b.y1, s0: b.x0, s1: b.x1}]
        : [{line: b.x0, s0: b.y0, s1: b.y1}, {line: b.x1, s0: b.y0, s1: b.y1}],
    );
    edges.sort((e, f) => e.line - f.line);
    const groups: (typeof edges)[] = [];
    for (const e of edges) {
      const g = groups.at(-1);
      if (g && Math.abs(e.line - g[0]!.line) <= EPS) g.push(e);
      else groups.push([e]);
    }
    for (const g of groups) {
      const line = g[0]!.line;
      const cuts = [...new Set(g.flatMap((e) => [e.s0, e.s1]))].sort((x, y) => x - y);
      let cur: BoxWall | null = null;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [p, q] = [cuts[i]!, cuts[i + 1]!];
        if (q - p <= EPS) continue;
        const mid = (p + q) / 2;
        if (!g.some((e) => e.s0 <= mid && e.s1 >= mid)) {
          cur = null;
          continue;
        }
        const neg = axis === 'h' ? inside(mid, line - EPS) : inside(line - EPS, mid);
        const pos = axis === 'h' ? inside(mid, line + EPS) : inside(line + EPS, mid);
        if (neg === pos) {
          cur = null;
          continue;
        }
        const at = (s: number): P => (axis === 'h' ? [s, line] : [line, s]);
        if (cur && cur.sides[0] === neg && cur.sides[1] === pos && Math.abs((axis === 'h' ? cur.b[0] : cur.b[1]) - p) <= EPS) {
          cur.b = at(q);
        } else {
          cur = {id: '', a: at(p), b: at(q), axis, sides: [neg, pos]};
          out.push(cur);
        }
      }
    }
  }
  for (const w of out) w.id = `bw-${w.axis}-${Math.round(w.a[0])}-${Math.round(w.a[1])}-${Math.round(w.b[0])}-${Math.round(w.b[1])}`;
  return out;
}

const distToWall = (p: P, w: BoxWall) => projectOnSegment(p, w.a, w.b).dist;

/** 离 p 最近、且不超过 tol 的墙 */
export function wallAt(walls: readonly BoxWall[], p: P, tol: number): BoxWall | null {
  let best: BoxWall | null = null;
  let bestD = tol;
  for (const w of walls) {
    const d = distToWall(p, w);
    if (d <= bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

export interface WallType {
  kind: WallKind;
  /** 敞开：两个房间之间没有墙，生成户型时不出墙 */
  open: boolean;
  /** 外墙，或者用户点过；按图猜的和默认的都算没核实 */
  verified: boolean;
  guessed: boolean;
}

/** 每段墙的类型：外墙不变，其余按墙类型标记，没标的是非承重 */
export function wallTypes(walls: readonly BoxWall[], wallMarks: readonly WallMark[], tol: number): Map<string, WallType> {
  const marked = new Map<string, WallMark>();
  for (const m of wallMarks) {
    const w = wallAt(walls, m.at, tol);
    // 用户点的覆盖猜的
    if (w && (!marked.has(w.id) || !m.guessed)) marked.set(w.id, m);
  }
  return new Map<string, WallType>(
    walls.map((w): [string, WallType] => {
      const m = marked.get(w.id);
      if (isExterior(w)) return [w.id, {kind: m?.kind === 'bearing' ? 'bearing' : 'exterior', open: false, verified: true, guessed: false}];
      const open = m?.kind === 'open';
      return [w.id, {kind: m?.kind === 'bearing' ? 'bearing' : 'partition', open, verified: open || (!!m && !m.guessed), guessed: !!m?.guessed}];
    }),
  );
}

/** 门窗挂到哪段墙上；同一段墙上有多个时都保留 */
export function attachMarks(walls: readonly BoxWall[], marks: readonly Mark[], tol: number): {mark: Mark; wall: BoxWall}[] {
  return marks.flatMap((mark) => {
    const wall = wallAt(walls, mark.at, tol);
    return wall ? [{mark, wall}] : [];
  });
}

/** 门窗的宽度（mm）：默认宽度，墙太短时收到墙长的 80% */
export function markWidthMm(kind: MarkKind, wallLenMm: number): number {
  return Math.round(Math.min(MARK_WIDTH_MM[kind], wallLenMm * 0.8) / 10) * 10;
}

const wallLen = (w: BoxWall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** 方框每条边内缩该边上墙厚的一半（mm 换成像素），得到房间内轮廓 */
export function roomRect(box: Box, walls: readonly BoxWall[], types: Map<string, WallType>, mmPerPixel: number): {x0: number; y0: number; x1: number; y1: number} {
  const b = normBox(box);
  const half = (axis: 'h' | 'v', line: number, s0: number, s1: number) => {
    let t = 0;
    for (const w of walls) {
      if (w.axis !== axis) continue;
      const [wl, ws0, ws1] = axis === 'h' ? [w.a[1], w.a[0], w.b[0]] : [w.a[0], w.a[1], w.b[1]];
      if (Math.abs(wl - line) > EPS || ws1 <= s0 + EPS || ws0 >= s1 - EPS) continue;
      const ty = types.get(w.id);
      if (!ty?.open) t = Math.max(t, MANUAL_THICKNESS[ty?.kind ?? 'partition']);
    }
    return t / 2 / mmPerPixel;
  };
  return {
    x0: b.x0 + half('v', b.x0, b.y0, b.y1),
    x1: b.x1 - half('v', b.x1, b.y0, b.y1),
    y0: b.y0 + half('h', b.y0, b.x0, b.x1),
    y1: b.y1 - half('h', b.y1, b.x0, b.x1),
  };
}

const rectArea = (r: {x0: number; y0: number; x1: number; y1: number}) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

/** 按套内面积（㎡）定比例：方框内缩后的总面积等于套内面积。内缩量和比例有关，迭代几次就稳定 */
export function scaleFromArea(boxes: readonly Box[], walls: readonly BoxWall[], types: Map<string, WallType>, areaM2: number): number | null {
  const raw = boxes.reduce((s, b) => s + rectArea(normBox(b)), 0);
  if (!(areaM2 > 0) || !(raw > 0)) return null;
  const target = areaM2 * 1e6;
  let s = Math.sqrt(target / raw);
  for (let i = 0; i < 6; i++) {
    const px = boxes.reduce((sum, b) => sum + rectArea(roomRect(b, walls, types, s)), 0);
    if (!(px > 0)) return null;
    s *= Math.sqrt(target / (px * s * s));
  }
  return s;
}

/** 量一段墙：墙中心线长度 = mm */
export const scaleFromWall = (w: BoxWall, mm: number) => (mm > 0 && wallLen(w) > 0 ? mm / wallLen(w) : null);

export interface BoxState {
  boxes: Box[];
  marks: Mark[];
  wallMarks: WallMark[];
}

/** 吸附门窗和墙类型时的容差（像素）：按比例取 300 mm，至少 6 像素 */
export const attachTol = (mmPerPixel: number) => Math.max(6, 300 / mmPerPixel);

/** 框房间的结果 → 描墙草稿（像素），再走原来的 draftToPlan 生成户型 */
export function boxesToDraft(state: BoxState, mmPerPixel: number): Draft {
  const walls = wallsFromBoxes(state.boxes);
  const tol = attachTol(mmPerPixel);
  const types = wallTypes(walls, state.wallMarks, tol);
  const solid = walls.filter((w) => !types.get(w.id)!.open);
  const draftWalls: DraftWall[] = solid.map((w) => {
    const t = types.get(w.id)!;
    return {
      id: w.id,
      a: w.a,
      b: w.b,
      thickness: MANUAL_THICKNESS[t.kind] / mmPerPixel,
      kind: t.kind,
      source: 'manual',
      confirmed: true,
      ...(t.verified ? {} : {unverified: true}),
    };
  });
  const byId = new Map(draftWalls.map((w) => [w.id, w]));
  const openings: DraftOpening[] = attachMarks(solid, state.marks, tol).map(({mark, wall}) => {
    const kind: OpeningKind = mark.kind === 'entry' ? 'door' : mark.kind;
    const widthMm = markWidthMm(mark.kind, wallLen(wall) * mmPerPixel);
    const o = openingOnWall(byId.get(wall.id)!, mark.at, widthMm / mmPerPixel, kind, widthMm);
    return {...o, id: mark.id, ...(mark.kind === 'entry' ? {isEntry: true} : {})};
  });
  const rooms: DraftRoom[] = state.boxes.map((b) => {
    const r = roomRect(b, walls, types, mmPerPixel);
    return {
      id: b.id,
      name: b.name,
      poly: [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]],
      source: 'manual',
      confirmed: true,
    };
  });
  return {walls: draftWalls, openings, rooms, dimensions: []};
}

export const newBox = (x0: number, y0: number, x1: number, y1: number, name: string, source: Box['source'] = 'manual'): Box =>
  normBox({id: uid('b'), name, x0, y0, x1, y1, source});

/** 新方框的默认名：房间 1、房间 2……（猜错的名字比没名字更容易被忽略，让用户一点选） */
export function suggestName(boxes: readonly Box[]): string {
  const used = new Set(boxes.map((b) => b.name));
  let n = boxes.length + 1;
  while (used.has(`房间 ${n}`)) n++;
  return `房间 ${n}`;
}

/**
 * 方框边吸附到其他方框的平行边：坐标差不超过 tol、沿边方向有重叠时对齐。
 * 只改正在画或拖的那个方框（id），返回新方框。
 */
export function snapToBoxes(box: Box, others: readonly Box[], tol: number, sides: ('x0' | 'x1' | 'y0' | 'y1')[] = ['x0', 'x1', 'y0', 'y1']): Box {
  const b = {...box};
  for (const side of sides) {
    const vertical = side === 'x0' || side === 'x1';
    let best: number | null = null;
    let bestD = tol;
    for (const o of others) {
      if (o.id === box.id) continue;
      const overlap = vertical ? Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0) : Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0);
      if (overlap < -tol) continue;
      for (const v of vertical ? [o.x0, o.x1] : [o.y0, o.y1]) {
        const d = Math.abs(v - b[side]);
        if (d <= bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    if (best !== null) b[side] = best;
  }
  return b;
}

/**
 * AI 识别出的房间轮廓 → 方框：取外接矩形，再把彼此很近的边对齐到同一条线（相邻房间共用一面墙）。
 * snap 可选：把每条边吸到图上的墙线（输入边的方向、位置、范围）。
 */
export function boxesFromRooms(
  rooms: readonly {name: string; poly: readonly P[]}[],
  tol: number,
  snap?: (axis: 'h' | 'v', at: number, s0: number, s1: number) => number | null,
): Box[] {
  let boxes = rooms
    .filter((r) => r.poly.length >= 3)
    .map((r) => {
      const xs = r.poly.map((p) => p[0]);
      const ys = r.poly.map((p) => p[1]);
      return newBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), r.name || '房间', 'ai');
    })
    .filter((b) => b.x1 - b.x0 > tol && b.y1 - b.y0 > tol);
  if (snap) {
    boxes = boxes.map((b) => ({
      ...b,
      x0: snap('v', b.x0, b.y0, b.y1) ?? b.x0,
      x1: snap('v', b.x1, b.y0, b.y1) ?? b.x1,
      y0: snap('h', b.y0, b.x0, b.x1) ?? b.y0,
      y1: snap('h', b.y1, b.x0, b.x1) ?? b.y1,
    }));
  }
  const align = (keys: ('x0' | 'x1' | 'y0' | 'y1')[]) => {
    const vals = boxes.flatMap((b) => keys.map((k) => b[k])).sort((a, c) => a - c);
    const groups: number[][] = [];
    for (const v of vals) {
      const g = groups.at(-1);
      if (g && v - g.at(-1)! <= tol) g.push(v);
      else groups.push([v]);
    }
    const to = (v: number) => {
      const g = groups.find((gg) => v >= gg[0]! - 1e-9 && v <= gg.at(-1)! + 1e-9)!;
      return g.reduce((s, x) => s + x, 0) / g.length;
    };
    boxes = boxes.map((b) => ({...b, ...Object.fromEntries(keys.map((k) => [k, to(b[k])]))}));
  };
  align(['x0', 'x1']);
  align(['y0', 'y1']);
  return boxes.map(normBox);
}

type Rect = {x0: number; y0: number; x1: number; y1: number};

/**
 * 自动框出的矩形和已有方框重叠时（客餐厅、过道这类连在一起的空间），切掉重叠部分：
 * 每碰到一个方框，在四种切法里选保留面积最大、又还包含双击点的那种。双击点在已有方框里时返回 null。
 */
export function clipAgainst(r: Rect, others: readonly Rect[], p: P): Rect | null {
  let cur = {...r};
  for (const o of others.map(normBox)) {
    if (p[0] > o.x0 && p[0] < o.x1 && p[1] > o.y0 && p[1] < o.y1) return null;
    const ox = Math.min(cur.x1, o.x1) - Math.max(cur.x0, o.x0);
    const oy = Math.min(cur.y1, o.y1) - Math.max(cur.y0, o.y0);
    if (ox <= 1 || oy <= 1) continue;
    const cuts: Rect[] = [
      {...cur, x1: Math.min(cur.x1, o.x0)},
      {...cur, x0: Math.max(cur.x0, o.x1)},
      {...cur, y1: Math.min(cur.y1, o.y0)},
      {...cur, y0: Math.max(cur.y0, o.y1)},
    ].filter((c) => c.x1 - c.x0 > 1 && c.y1 - c.y0 > 1 && p[0] >= c.x0 && p[0] <= c.x1 && p[1] >= c.y0 && p[1] <= c.y1);
    if (!cuts.length) return null;
    cur = cuts.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]!;
  }
  return cur;
}
