/**
 * AI 一键布置房间的几何部分（纯函数）：房间墙面分析、把「靠墙 / 挨着 / 正前方 / 正中」的描述
 * 换算成家具位置、布局检查、写回方案。
 * AI 只决定放什么、靠哪面墙；坐标、朝向、避让都在这里算——模型给的坐标不可靠（户型识别时已经看到）。
 * 单位 mm，y 向下；家具局部 -y 一侧是靠背 / 床头，旋转角顺时针。
 */
import type {Furniture, OpeningKind, Plan, Room, Vec2} from './types';
import {CATALOG, FURNITURE_ELEVATION, FURNITURE_HEIGHT, type CatalogItem} from './catalog';
import {furnitureHalfExtents, pointInPolygon, polygonCentroid} from './geometry';
import {activeWalls, liveOpenings, type Rect} from './walls';
import {uid} from '../lib/id';
import {runCheckup, type RuleId, type Severity} from './checkup';

/* ---------- 房间类型 ---------- */

export type LayoutRoomKind = 'bedroom' | 'living' | 'dining' | 'study';

const UNSUPPORTED = /厨|卫|浴|厕|阳台|过道|走道|走廊|玄关|储藏|衣帽|洗衣/;

/** 能 AI 布置的房间类型；不支持的返回 null。先排除不支持的（「厨房」也带「房」字） */
export function layoutRoomKind(name: string): LayoutRoomKind | null {
  if (UNSUPPORTED.test(name)) return null;
  if (/书房|工作室/.test(name)) return 'study';
  if (/客厅|客餐厅|起居/.test(name)) return 'living';
  if (/餐厅/.test(name)) return 'dining';
  if (/卧|房/.test(name)) return 'bedroom';
  return null;
}

/* ---------- 房间墙面 ---------- */

/** 墙面在房间的哪一边（图纸方向） */
export type FaceSide = 'top' | 'right' | 'bottom' | 'left';

export interface FaceOpening {
  /** open：这段没有墙，通往别的房间 */
  kind: OpeningKind | 'open';
  name: string;
  /** 沿墙面、从 start 端量起的区间（mm） */
  from: number;
  to: number;
  /** 窗台高 / 洞口顶高；门和开口的窗台是 0 */
  sill: number;
  head: number;
  /** 平开门是否开向本房间 */
  swingsIn?: boolean;
  leaf?: number;
}

export interface Face {
  /** A、B、C…，按轮廓顺序 */
  id: string;
  side: FaceSide;
  /** 横墙取左端，竖墙取上端 */
  start: Vec2;
  end: Vec2;
  len: number;
  /** 指向房间内部的单位向量 */
  inward: Vec2;
  openings: FaceOpening[];
}

/** 家具不能放的地方：门扇扫过的范围、门口和开口前的通道 */
export interface KeepOut {
  rect: Rect;
  label: string;
}

export interface RoomInfo {
  room: Room;
  faces: Face[];
  keepOuts: KeepOut[];
}

/** 短于这个的边不算墙面 */
const MIN_FACE = 300;
/** 墙、门窗的中心线离墙面线不超过半个墙厚加这么多，算在这面墙上 */
const NEAR = 60;
/** 门口、开口向内留的通道深度 */
const PASSAGE = 600;
/** 没有墙的缺口短于这个就忽略（墙角的小误差） */
const MIN_GAP = 200;
const BAY_SILL = 450;

const isH = (f: Pick<Face, 'side'>) => f.side === 'top' || f.side === 'bottom';
/** 墙面线所在的坐标：横墙是 y，竖墙是 x */
const lineOf = (f: Face) => (isH(f) ? f.start[1] : f.start[0]);
/** 点沿墙面的坐标（从 start 端量起） */
const alongOf = (f: Face, p: Vec2) => (isH(f) ? p[0] - f.start[0] : p[1] - f.start[1]);
/** 沿墙 along、离墙 depth（向房间内）的点 */
const pointAt = (f: Face, along: number, depth: number): Vec2 =>
  isH(f) ? [f.start[0] + along, f.start[1] + f.inward[1] * depth] : [f.start[0] + f.inward[0] * depth, f.start[1] + along];

const rectOf = (p: Vec2, q: Vec2): Rect => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];

/** 矩形在墙面上的投影区间 */
const project = (f: Face, r: Rect): [number, number] => (isH(f) ? [r[0] - f.start[0], r[2] - f.start[0]] : [r[1] - f.start[1], r[3] - f.start[1]]);

/** 一维区间重叠的长度 */
const overlap1 = (a: readonly [number, number], b: readonly [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/** 两个矩形在两个方向上都重叠超过 eps */
const overlaps = (a: Rect, b: Rect, eps = 1) => overlap1([a[0], a[2]], [b[0], b[2]]) > eps && overlap1([a[1], a[3]], [b[1], b[3]]) > eps;

/** 把区间并起来，求 [0, len] 里没被盖住的段 */
function gapsOf(covered: [number, number][], len: number): [number, number][] {
  const sorted = covered.map(([a, b]) => [Math.max(0, a), Math.min(len, b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const gaps: [number, number][] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a > at) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < len) gaps.push([at, len]);
  return gaps.filter(([a, b]) => b - a >= MIN_GAP);
}

/** 房间的墙面、门窗和禁放区；房间不存在返回 null */
export function roomInfo(plan: Plan, roomId: string): RoomInfo | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.poly.length < 3) return null;
  const poly = room.poly;

  const faces: Face[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const horizontal = Math.abs(p[1] - q[1]) < 1;
    if (!horizontal && Math.abs(p[0] - q[0]) >= 1) continue;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < MIN_FACE) continue;
    const first = horizontal ? p[0] <= q[0] : p[1] <= q[1];
    const start = first ? p : q;
    const end = first ? q : p;
    const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const inside = (v: Vec2) => pointInPolygon([mid[0] + v[0] * 20, mid[1] + v[1] * 20], poly);
    const inward: Vec2 = horizontal ? (inside([0, 1]) ? [0, 1] : [0, -1]) : inside([1, 0]) ? [1, 0] : [-1, 0];
    const side: FaceSide = horizontal ? (inward[1] > 0 ? 'top' : 'bottom') : inward[0] > 0 ? 'left' : 'right';
    faces.push({id: String.fromCharCode(65 + faces.length), side, start: [start[0], start[1]], end: [end[0], end[1]], len, inward, openings: []});
  }

  const keepOuts: KeepOut[] = [];
  const passage = (f: Face, from: number, to: number): Rect => rectOf(pointAt(f, from, 0), pointAt(f, to, PASSAGE));

  // 门窗挂在哪面墙上
  for (const f of faces) {
    for (const o of liveOpenings(plan)) {
      const parallel = isH(f) ? Math.abs(o.a[1] - o.b[1]) < 1 : Math.abs(o.a[0] - o.b[0]) < 1;
      if (!parallel || Math.abs((isH(f) ? o.a[1] : o.a[0]) - lineOf(f)) > o.thickness / 2 + NEAR) continue;
      const from = Math.max(0, Math.min(alongOf(f, o.a), alongOf(f, o.b)));
      const to = Math.min(f.len, Math.max(alongOf(f, o.a), alongOf(f, o.b)));
      if (to - from < 1) continue;
      const name = o.name ?? (o.kind === 'door' ? '门' : o.kind === 'slidingDoor' ? '推拉门' : '窗');
      if (o.kind === 'window') {
        f.openings.push({kind: 'window', name, from, to, sill: o.sill ?? 900, head: o.head ?? 2400});
        continue;
      }
      const head = o.head ?? (o.kind === 'door' ? 2100 : 2200);
      if (o.kind === 'door' && o.swing) {
        const {hinge, closed, open, leaf} = o.swing;
        const square = rectOf(hinge, [hinge[0] + (closed[0] + open[0]) * leaf, hinge[1] + (closed[1] + open[1]) * leaf]);
        const swingsIn = pointInPolygon([(square[0] + square[2]) / 2, (square[1] + square[3]) / 2], poly);
        f.openings.push({kind: 'door', name, from, to, sill: 0, head, swingsIn, leaf});
        keepOuts.push(swingsIn ? {rect: square, label: `${name}的开门范围`} : {rect: passage(f, from, to), label: `${name}的门口`});
      } else {
        f.openings.push({kind: o.kind, name, from, to, sill: 0, head});
        keepOuts.push({rect: passage(f, from, to), label: `${name}的门口`});
      }
    }
  }

  // 没有墙、也没有门窗的段：通往别的房间的开口。飘窗按窗台 450 的窗算
  const covers = faces.map((f) => {
    const covered: [number, number][] = f.openings.map((o) => [o.from, o.to]);
    for (const w of activeWalls(plan)) {
      const parallel = isH(f) ? Math.abs(w.a[1] - w.b[1]) < 1 : Math.abs(w.a[0] - w.b[0]) < 1;
      if (!parallel || Math.abs((isH(f) ? w.a[1] : w.a[0]) - lineOf(f)) > w.thickness / 2 + NEAR) continue;
      const a = alongOf(f, w.a);
      const b = alongOf(f, w.b);
      covered.push([Math.min(a, b), Math.max(a, b)]);
    }
    return covered;
  });
  const total = faces.reduce((s, f) => s + f.len, 0);
  const uncovered = faces.map((f, i) => gapsOf(covers[i]!, f.len));
  const gapLen = uncovered.flat().reduce((s, [a, b]) => s + b - a, 0);
  // 墙和房间轮廓对不上（例如识别出来的户型）时，大半都会是「缺口」，这种情况当作四面都有墙
  if (gapLen < total * 0.7) {
    faces.forEach((f, i) => {
      for (const [from, to] of uncovered[i]!) {
        const probe = pointAt(f, (from + to) / 2, -150);
        const next = plan.rooms.find((r) => r.id !== room.id && pointInPolygon(probe, r.poly));
        if (next && (next.counted === false || /飘窗/.test(next.name))) {
          f.openings.push({kind: 'window', name: '飘窗', from, to, sill: BAY_SILL, head: 2400});
        } else {
          const name = next ? `通往${next.name}的开口` : '开口';
          f.openings.push({kind: 'open', name, from, to, sill: 0, head: plan.wallHeight});
          keepOuts.push({rect: passage(f, from, to), label: name});
        }
      }
    });
  }

  for (const f of faces) f.openings.sort((a, b) => a.from - b.from);
  return {room, faces, keepOuts};
}

/* ---------- 家具库与家具尺寸 ---------- */

const normName = (s: string) => s.replace(/\s+/g, '');
const CATALOG_BY_NAME = new Map<string, CatalogItem>();
for (const g of CATALOG) for (const it of g.items) if (!CATALOG_BY_NAME.has(normName(it.name))) CATALOG_BY_NAME.set(normName(it.name), it);

/** 按名字找家具库里的家具（不区分空格） */
export const findCatalogItem = (name: string) => CATALOG_BY_NAME.get(normName(name));

/** 家具占的高度范围 [离地, 离地 + 高] */
const vrange = (type: string): [number, number] => {
  const e = FURNITURE_ELEVATION[type] ?? 0;
  return [e, e + (FURNITURE_HEIGHT[type] ?? 800)];
};

/** 家具占地的外接矩形 */
export function footprint(f: Furniture): Rect {
  const {hw, hh} = furnitureHalfExtents(f);
  return [f.cx - hw, f.cy - hh, f.cx + hw, f.cy + hh];
}

/* ---------- 摆放 ---------- */

export type Align = 'start' | 'center' | 'end';

/**
 * AI 给的一件家具的描述，四种放法选一种：
 * 靠墙 wall（+ align / offset / gap / w）、挨着另一件 beside（+ side / gap）、
 * 在另一件正前方 front（+ gap，可为负）、房间正中 center（+ rot）。
 */
export interface LayoutItem {
  /** AI 自取的短名，供别的家具引用 */
  id: string;
  /** 家具库里的名字 */
  item: string;
  wall?: string;
  align?: Align;
  offset?: number;
  gap?: number;
  w?: number;
  beside?: string;
  side?: 'start' | 'end';
  front?: string;
  center?: boolean;
  rot?: number;
}

export interface Placed {
  key: string;
  f: Furniture;
}

const ROT: Record<FaceSide, number> = {top: 0, right: 90, bottom: 180, left: 270};
const RAD = Math.PI / 180;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 加宽限制在家具库宽度的 0.5～2.5 倍，且不超过 max */
const widthOf = (want: unknown, base: number, max: number) =>
  typeof want === 'number' && Number.isFinite(want) ? clamp(want, base * 0.5, Math.min(base * 2.5, max)) : base;

/** 家具朝向（局部 +y，正面）在平面上的方向 */
const frontOf = (rot: number): Vec2 => [-Math.sin(rot * RAD), Math.cos(rot * RAD)];

/**
 * 靠墙的家具压到门口、开口、禁放区，或者高家具压到窗，或者压到已经放好的家具时，
 * 沿墙滑到最近的空位；没有空位就原地不动，交给布局检查报告。
 */
function slideAlong(info: RoomInfo, face: Face, along: number, w: number, depth: number, type: string, others: readonly Furniture[]): number {
  const band = rectOf(pointAt(face, 0, 0), pointAt(face, face.len, depth));
  const vr = vrange(type);
  const floor = type !== 'rug' && vr[0] < 2000;
  const blocks: [number, number][] = [];
  if (floor) for (const k of info.keepOuts) if (overlaps(k.rect, band)) blocks.push(project(face, k.rect));
  for (const o of face.openings) {
    if (o.kind === 'window' ? overlap1(vr, [o.sill, o.head]) > 0 : floor) blocks.push([o.from, o.to]);
  }
  for (const g of others) {
    if (type === 'rug' || g.type === 'rug' || overlap1(vr, vrange(g.type)) <= 0) continue;
    const r = footprint(g);
    if (overlaps(r, band)) blocks.push(project(face, r));
  }
  const free = (a: number) => blocks.every((b) => overlap1([a - w / 2, a + w / 2], b) <= 1);
  if (free(along)) return along;
  const candidates = blocks
    .flatMap(([b0, b1]) => [b0 - w / 2, b1 + w / 2])
    .filter((a) => a >= w / 2 - 0.5 && a <= face.len - w / 2 + 0.5 && free(a));
  return candidates.reduce((best, a) => (Math.abs(a - along) < Math.abs(best - along) ? a : best), candidates[0] ?? along);
}

/**
 * 把 AI 的描述换算成家具。existing 是房间里保留的家具，靠墙滑动时也会避开它们。
 * 家具库里没有、引用不存在、放不下的跳过，并在 skipped 里说明。
 */
export function placeItems(
  info: RoomInfo,
  items: readonly LayoutItem[],
  existing: readonly Furniture[] = [],
  makeId: () => string = () => uid('f'),
): {placed: Placed[]; skipped: string[]} {
  const placed: Placed[] = [];
  const skipped: string[] = [];
  const byKey = new Map<string, Furniture>();

  for (const it of items) {
    const want = String(it.item ?? '').trim();
    const cat = findCatalogItem(want);
    if (!cat) {
      skipped.push(`家具库里没有「${want}」`);
      continue;
    }
    const q = `「${cat.name}」`;
    const base = {id: makeId(), type: cat.type, name: cat.name, color: cat.color, d: cat.d};
    let f: Furniture;

    if (it.wall !== undefined) {
      const face = info.faces.find((x) => x.id === String(it.wall).trim().toUpperCase());
      if (!face) {
        skipped.push(`${q}要靠的墙「${it.wall}」不存在`);
        continue;
      }
      const w = widthOf(it.w, cat.w, face.len);
      if (w > face.len + 1) {
        skipped.push(`${q}宽 ${Math.round(w)} mm，${face.id} 墙只有 ${Math.round(face.len)} mm，放不下`);
        continue;
      }
      const gap = Math.max(0, num(it.gap, 0));
      const off = num(it.offset, 0);
      const align = it.align === 'start' || it.align === 'end' ? it.align : 'center';
      let along = align === 'start' ? Math.max(0, off) + w / 2 : align === 'end' ? face.len - Math.max(0, off) - w / 2 : face.len / 2 + off;
      along = clamp(along, w / 2, face.len - w / 2);
      along = slideAlong(info, face, along, w, gap + cat.d, cat.type, [...existing, ...placed.map((p) => p.f)]);
      const c = pointAt(face, along, gap + cat.d / 2);
      f = {...base, w, cx: Math.round(c[0]), cy: Math.round(c[1]), rot: ROT[face.side]};
    } else if (it.beside !== undefined || it.front !== undefined) {
      const refKey = String(it.beside ?? it.front);
      const ref = byKey.get(refKey);
      if (!ref) {
        skipped.push(`${q}要${it.beside !== undefined ? '挨着' : '放在前面'}的「${refKey}」没放上`);
        continue;
      }
      const w = widthOf(it.w, cat.w, Infinity);
      const n = frontOf(ref.rot);
      if (it.beside !== undefined) {
        // 朝向相同、背面对齐，放在 start（左 / 上）或 end（右 / 下）侧
        const u: Vec2 = Math.abs(Math.cos(ref.rot * RAD)) > 0.5 ? [1, 0] : [0, 1];
        const sign = it.side === 'start' ? -1 : 1;
        const along = ref.w / 2 + Math.max(0, num(it.gap, 0)) + w / 2;
        const shift = (cat.d - ref.d) / 2;
        f = {...base, w, rot: ref.rot, cx: Math.round(ref.cx + u[0] * sign * along + n[0] * shift), cy: Math.round(ref.cy + u[1] * sign * along + n[1] * shift)};
      } else {
        // 面朝那件家具；间距可为负（椅子塞进桌下），最多塞进一半
        const gap = Math.max(-Math.min(cat.d, ref.d) / 2, num(it.gap, 0));
        const k = ref.d / 2 + gap + cat.d / 2;
        f = {...base, w, rot: (ref.rot + 180) % 360, cx: Math.round(ref.cx + n[0] * k), cy: Math.round(ref.cy + n[1] * k)};
      }
    } else if (it.center) {
      let c = polygonCentroid(info.room.poly);
      if (!pointInPolygon(c, info.room.poly)) c = info.room.labelAt ?? c;
      const rot = num(it.rot, 0) % 180 === 90 ? 90 : 0;
      f = {...base, w: widthOf(it.w, cat.w, Infinity), rot, cx: Math.round(c[0]), cy: Math.round(c[1])};
    } else {
      skipped.push(`${q}没说放在哪`);
      continue;
    }
    placed.push({key: String(it.id), f});
    byKey.set(String(it.id), f);
  }
  return {placed, skipped};
}

/* ---------- 布局检查 ---------- */

export type LayoutIssueKind = 'overlap' | 'outside' | 'door' | 'window' | 'clearance' | 'path';

export interface LayoutIssue {
  kind: LayoutIssueKind;
  severity: Severity;
  message: string;
  /** 怎么改的建议（交回 AI 修正时一起带上） */
  advice?: string;
  /** 涉及的家具 id */
  ids: string[];
}

const EPS = 20;

/** 矩形（缩进一点）的角、边中点和中心都在多边形里 */
function rectInside(r: Rect, poly: readonly Vec2[]): boolean {
  const [x0, y0, x1, y1] = [r[0] + 10, r[1] + 10, r[2] - 10, r[3] - 10];
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const pts: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [mx, y0], [x1, my], [mx, y1], [x0, my], [mx, my]];
  return pts.every((p) => pointInPolygon(p, poly));
}

const KIND_OF_RULE: Record<RuleId, LayoutIssueKind> = {bed: 'clearance', front: 'clearance', table: 'clearance', door: 'door', overlap: 'overlap', path: 'path'};

/**
 * 检查房间里的家具（含保留的），返回问题清单（空数组表示没问题）。
 * 床边、柜前、餐桌留空，挡门，压着，通道都直接用居住体检（model/checkup）的规则，两边结论一致；
 * 这里只补体检没有的两条：伸出房间、高家具挡窗。
 */
export function checkLayout(plan: Plan, info: RoomInfo, furniture: readonly Furniture[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const poly = info.room.poly;
  const q = (f: Furniture) => `「${f.name}」`;

  for (const f of furniture) {
    const r = footprint(f);
    if (!rectInside(r, poly)) issues.push({kind: 'outside', severity: 'error', message: `${q(f)}伸出了房间`, ids: [f.id]});
    for (const face of info.faces) {
      // 家具贴着这面墙（离墙面不到 150 mm）
      const gap = face.side === 'top' ? r[1] - lineOf(face) : face.side === 'bottom' ? lineOf(face) - r[3] : face.side === 'left' ? r[0] - lineOf(face) : lineOf(face) - r[2];
      if (gap < -50 || gap > 150) continue;
      const span = project(face, r);
      for (const o of face.openings) {
        if (o.kind !== 'window' || overlap1(vrange(f.type), [o.sill, o.head]) <= 0 || overlap1(span, [o.from, o.to]) <= EPS) continue;
        issues.push({kind: 'window', severity: 'warn', message: `${q(f)}挡住了 ${face.id} 墙的${o.name}`, ids: [f.id]});
      }
    }
  }

  // 体检：只报和这批家具有关的；通道问题只报布置前没有的
  const ids = new Set(furniture.map((f) => f.id));
  const before = new Set(runCheckup(withRoomFurniture(plan, info.room.id, [], false)).issues.map((i) => i.id));
  for (const i of runCheckup(withRoomFurniture(plan, info.room.id, furniture, false)).issues) {
    const mine = i.furniture.filter((id) => ids.has(id));
    if (i.rule === 'path' ? before.has(i.id) : !mine.length) continue;
    issues.push({kind: KIND_OF_RULE[i.rule], severity: i.severity, message: i.title, advice: i.detail, ids: mine});
  }
  return issues;
}

/* ---------- 写回方案 ---------- */

/** 中心点在这个房间里的家具 */
export function furnitureInRoom(plan: Plan, roomId: string): Furniture[] {
  const room = plan.rooms.find((r) => r.id === roomId);
  return room ? plan.furniture.filter((f) => pointInPolygon([f.cx, f.cy], room.poly)) : [];
}

/** 把布置结果写进方案：默认先清掉这个房间原有的家具；地毯放最底层 */
export function withRoomFurniture(plan: Plan, roomId: string, items: readonly Furniture[], keepExisting: boolean): Plan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return plan;
  const kept = keepExisting ? plan.furniture : plan.furniture.filter((f) => !pointInPolygon([f.cx, f.cy], room.poly));
  const rugs = items.filter((f) => f.type === 'rug');
  const rest = items.filter((f) => f.type !== 'rug');
  return {...plan, furniture: [...rugs, ...kept, ...rest]};
}
