import type {Opening, OpeningKind, Plan, Room, Vec2, Wall, WallKind} from '../../model/types';
import type {RecognizedPlan} from '../ai/recognize';
import {uid} from '../../lib/id';
import {dist, projectOnSegment, snapToWalls} from '../../model/snap';

/**
 * 户型还原的草稿：全部是图片像素坐标。
 * 用户在图上校对、描墙、挂门窗、圈房间，标定比例后再换算成毫米的 Plan。
 */

export type P = [number, number];
export type Source = 'ai' | 'manual';

export interface DraftWall {
  id: string;
  a: P;
  b: P;
  /** 像素厚度 */
  thickness: number;
  kind: WallKind;
  confidence?: number;
  confirmed?: boolean;
  source: Source;
}

export interface DraftOpening {
  id: string;
  kind: OpeningKind;
  /** 挂在哪段墙上；AI 识别的门窗没贴上墙时为 null */
  wallId: string | null;
  a: P;
  b: P;
  /** 手动放的门窗记下想要的真实宽度（mm），生成户型时按最终比例重新摆，不受放置时的估算比例影响 */
  widthMm?: number;
  confidence?: number;
  confirmed?: boolean;
  source: Source;
}

export interface DraftRoom {
  id: string;
  name: string;
  poly: P[];
  confidence?: number;
  confirmed?: boolean;
  source: Source;
}

export interface Draft {
  walls: DraftWall[];
  openings: DraftOpening[];
  rooms: DraftRoom[];
  /** 图上读到的尺寸标注，用来自动标定 */
  dimensions: {a: P; b: P; mm: number}[];
}

export const emptyDraft = (): Draft => ({walls: [], openings: [], rooms: [], dimensions: []});

/** 置信度低于这个值且没被用户确认的，在校对列表里高亮 */
export const LOW_CONFIDENCE = 0.6;
export const needsReview = (x: {confidence?: number; confirmed?: boolean}) =>
  !x.confirmed && x.confidence !== undefined && x.confidence < LOW_CONFIDENCE;

/* ---------- 基础几何 ---------- */

export function nearestWall(draft: Draft, p: P, maxDist: number): {wall: DraftWall; t: number; point: P} | null {
  let best: {wall: DraftWall; t: number; point: P; d: number} | null = null;
  for (const wall of draft.walls) {
    const pr = projectOnSegment(p, wall.a, wall.b);
    const limit = Math.max(maxDist, wall.thickness / 2);
    if (pr.dist <= limit && (!best || pr.dist < best.d)) best = {wall, t: pr.t, point: pr.point, d: pr.dist};
  }
  return best && {wall: best.wall, t: best.t, point: best.point};
}

/* ---------- 吸附（实现在 model/snap，设计页砌墙也用） ---------- */

export {dist, projectOnSegment, type SnapKind, type SnapResult} from '../../model/snap';

/** 描图时的吸附：吸到草稿里的墙 */
export const snapPoint = (draft: Draft, raw: P, opts: Parameters<typeof snapToWalls>[2]) => snapToWalls(draft.walls, raw, opts);

/* ---------- 门窗挂墙 ---------- */

/** 以 center 为中心，在墙上放一个宽 width（像素）的门窗，超出墙体时收回到墙内 */
export function openingOnWall(wall: DraftWall, center: P, width: number, kind: OpeningKind, widthMm?: number): DraftOpening {
  const len = dist(wall.a, wall.b);
  const half = Math.min(width, len) / 2;
  const {t} = projectOnSegment(center, wall.a, wall.b);
  const c = Math.max(half, Math.min(len - half, t * len));
  const ux = (wall.b[0] - wall.a[0]) / (len || 1);
  const uy = (wall.b[1] - wall.a[1]) / (len || 1);
  return {
    id: uid('o'),
    kind,
    wallId: wall.id,
    a: [wall.a[0] + ux * (c - half), wall.a[1] + uy * (c - half)],
    b: [wall.a[0] + ux * (c + half), wall.a[1] + uy * (c + half)],
    source: 'manual',
    confirmed: true,
    ...(widthMm ? {widthMm} : {}),
  };
}

/** 把没挂墙的门窗贴到最近的墙上（AI 结果常常略偏） */
export function attachOpenings(draft: Draft, maxDist: number): Draft {
  const openings = draft.openings.map((o) => {
    const wall = o.wallId ? draft.walls.find((w) => w.id === o.wallId) : undefined;
    const target =
      wall ??
      nearestWall(draft, [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], maxDist)?.wall;
    if (!target) return {...o, wallId: null};
    return {
      ...o,
      wallId: target.id,
      a: projectOnSegment(o.a, target.a, target.b).point,
      b: projectOnSegment(o.b, target.a, target.b).point,
    };
  });
  return {...draft, openings};
}

/** 移动墙体端点：所有重合的端点一起动，墙角不会被拉开；挂在墙上的门窗保持离墙起点的距离 */
export function moveVertex(draft: Draft, from: P, to: P, eps = 0.5): Draft {
  const same = (p: P) => dist(p, from) <= eps;
  const changed = new Map<string, {old: DraftWall; next: DraftWall}>();
  const walls = draft.walls.map((w) => {
    if (!same(w.a) && !same(w.b)) return w;
    const next = {...w, a: same(w.a) ? to : w.a, b: same(w.b) ? to : w.b};
    changed.set(w.id, {old: w, next});
    return next;
  });
  const openings = draft.openings.map((o) => {
    const c = o.wallId ? changed.get(o.wallId) : undefined;
    if (!c) return o;
    return {...o, a: carryAlong(o.a, c.old, c.next), b: carryAlong(o.b, c.old, c.next)};
  });
  return {...draft, walls, openings};
}

/** 点 p 在旧墙上离起点的距离，搬到新墙上同样的距离处 */
function carryAlong(p: P, oldWall: DraftWall, newWall: DraftWall): P {
  const d = projectOnSegment(p, oldWall.a, oldWall.b).t * dist(oldWall.a, oldWall.b);
  const len = dist(newWall.a, newWall.b) || 1;
  const k = Math.min(d, len) / len;
  return [newWall.a[0] + (newWall.b[0] - newWall.a[0]) * k, newWall.a[1] + (newWall.b[1] - newWall.a[1]) * k];
}

export function removeWall(draft: Draft, wallId: string): Draft {
  return {
    ...draft,
    walls: draft.walls.filter((w) => w.id !== wallId),
    openings: draft.openings.filter((o) => o.wallId !== wallId),
  };
}

/* ---------- 从 AI 结果生成草稿 ---------- */

export function draftFromRecognized(r: RecognizedPlan): Draft {
  const draft: Draft = {
    walls: r.walls.map((w) => ({
      id: uid('w'),
      a: [...w.a] as P,
      b: [...w.b] as P,
      thickness: Math.max(2, w.thickness || 6),
      kind: w.kind ?? 'partition',
      confidence: w.confidence,
      source: 'ai',
    })),
    openings: r.openings.map((o) => ({
      id: uid('o'),
      kind: o.kind,
      wallId: null,
      a: [...o.a] as P,
      b: [...o.b] as P,
      confidence: o.confidence,
      source: 'ai',
    })),
    rooms: r.rooms.map((room) => ({
      id: uid('r'),
      name: room.name,
      poly: room.poly.map((p) => [...p] as P),
      confidence: room.confidence,
      source: 'ai',
    })),
    dimensions: r.dimensions.map((d) => ({a: [...d.a] as P, b: [...d.b] as P, mm: d.mm})),
  };
  const median = medianWallThickness(draft) ?? 6;
  return attachOpenings(draft, median * 1.5);
}

export function medianWallThickness(draft: Draft): number | null {
  const t = draft.walls.map((w) => w.thickness).sort((a, b) => a - b);
  return t.length ? t[Math.floor(t.length / 2)]! : null;
}

/** 由尺寸标注估算比例（中位数，抗个别读错） */
export function scaleFromDimensions(draft: Draft): number | null {
  const ratios = draft.dimensions
    .map((d) => d.mm / dist(d.a, d.b))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((x, y) => x - y);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)]! : null;
}

/* ---------- 草稿 → 毫米户型 ---------- */

function guessMaterial(name: string): Room['material'] {
  if (/卫|浴|厕|洗衣|阳台|厨/.test(name)) return /厨/.test(name) ? 'tile600' : 'antislip';
  if (/卧|房|书|衣帽/.test(name)) return 'wood';
  return 'tile800';
}

const round10 = (v: number) => Math.round(v / 10) * 10;

/** 在墙上以原中点为中心、按指定宽度重新摆门窗，不超出墙两端 */
function respan(wall: Wall, a: Vec2, b: Vec2, width: number): [Vec2, Vec2] {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1;
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uy = (wall.b[1] - wall.a[1]) / len;
  const mid = ((a[0] + b[0]) / 2 - wall.a[0]) * ux + ((a[1] + b[1]) / 2 - wall.a[1]) * uy;
  const half = Math.min(width, len) / 2;
  const c = Math.max(half, Math.min(len - half, mid));
  const at = (t: number): Vec2 => [round10(wall.a[0] + ux * t), round10(wall.a[1] + uy * t)];
  return [at(c - half), at(c + half)];
}

/** 手描墙的默认厚度（mm） */
export const MANUAL_THICKNESS: Record<WallKind, number> = {bearing: 240, exterior: 240, partition: 120, low: 100};

export function draftToPlan(draft: Draft, mmPerPixel: number, name = '我的户型'): Plan {
  // 平移到原点附近，坐标取整到 10mm
  const xs = draft.walls.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = draft.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const ox = xs.length ? Math.min(...xs) : 0;
  const oy = ys.length ? Math.min(...ys) : 0;
  const s = (p: P): Vec2 => [round10((p[0] - ox) * mmPerPixel), round10((p[1] - oy) * mmPerPixel)];

  const wallThick = new Map<string, number>();
  const walls: Wall[] = draft.walls.map((w) => {
    // 手描的墙在图上只是一条线，厚度按墙的类型给常见值；识别出来的墙按图上量到的厚度
    const thickness = w.source === 'manual' ? MANUAL_THICKNESS[w.kind] : Math.max(60, round10(w.thickness * mmPerPixel));
    wallThick.set(w.id, thickness);
    return {id: w.id, a: s(w.a), b: s(w.b), thickness, kind: w.kind};
  });

  const wallMm = new Map(walls.map((w) => [w.id, w]));
  const openings: Opening[] = draft.openings.map((o) => {
    let a = s(o.a);
    let b = s(o.b);
    const host = o.wallId ? wallMm.get(o.wallId) : undefined;
    if (o.widthMm && host) [a, b] = respan(host, a, b, o.widthMm);
    const thickness = (o.wallId && wallThick.get(o.wallId)) || 240;
    const base: Opening = {
      id: o.id,
      kind: o.kind,
      a,
      b,
      thickness,
      head: o.kind === 'window' ? 2400 : o.kind === 'slidingDoor' ? 2200 : 2100,
      ...(o.kind === 'window' ? {sill: 900} : {}),
    };
    if (o.kind !== 'door') return base;
    // 默认门扇：铰链在 a 端，关门时沿墙指向 b，开门时转向墙的一侧
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    return {...base, swing: {hinge: a, closed: [ux, uy], open: [-uy, ux], leaf: Math.round(len)}};
  });

  const rooms: Room[] = draft.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    poly: r.poly.map(s),
    material: guessMaterial(r.name),
  }));

  return {
    version: 1,
    id: uid('plan'),
    name,
    wallHeight: 2800,
    walls,
    openings,
    rooms,
    furniture: [],
    demolished: [],
    measures: [],
    source: {kind: 'image', mmPerPixel},
  };
}
