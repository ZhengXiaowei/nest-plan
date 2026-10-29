import type {Opening, Plan, Vec2} from '../../model/types';
import {polygonArea, polygonCentroid} from '../../model/geometry';
import {activeWalls, distToSegment, liveOpenings, wallPieces} from '../../model/walls';
import {FURNITURE_ELEVATION} from '../../model/catalog';

/** 漫游时能穿过去的家具 */
const WALK_THROUGH = new Set(['rug', 'tv', 'acwall', 'waterheater']);

/**
 * 第一人称漫游用到的纯计算：碰撞体、起始位置、门。
 * 输入是户型（mm），输出是场景坐标（m），平面 (x, y) → 场景 (x, z)。
 */

const M = 0.001;
export const EYE_HEIGHT = 1.6;
export const BODY_RADIUS = 0.25;

/** 一段挡人的线段：中心线两端 + 半厚（m） */
export interface Collider {
  a: Vec2;
  b: Vec2;
  half: number;
}

/** 落在某段墙上的门窗才算数；墙拆了，上面的门窗也跟着没了 */
export function openingsOnActiveWalls(plan: Plan): Opening[] {
  return liveOpenings(plan);
}

/** 实体墙段 + 窗（窗台挡人），推拉门和平开门洞口不挡 */
export function buildColliders(plan: Plan, opts: {furniture?: boolean} = {}): Collider[] {
  const openings = openingsOnActiveWalls(plan);
  const out: Collider[] = [];
  for (const w of activeWalls(plan)) {
    for (const [a, b] of wallPieces(w, openings)) out.push({a: [a[0] * M, a[1] * M], b: [b[0] * M, b[1] * M], half: (w.thickness / 2) * M});
  }
  for (const o of openings) {
    if (o.kind === 'window') out.push({a: [o.a[0] * M, o.a[1] * M], b: [o.b[0] * M, o.b[1] * M], half: (o.thickness / 2) * M});
  }
  // 家具也挡人（地毯、挂墙的电视空调除外），免得走进沙发里
  if (opts.furniture !== false) for (const q of furnitureFootprints(plan)) for (let i = 0; i < 4; i++) out.push({a: q[i]!, b: q[(i + 1) % 4]!, half: 0.01});
  return out;
}

/** 挡人的家具外框四角（m），按顺序首尾相连 */
export function furnitureFootprints(plan: Plan): Vec2[][] {
  return plan.furniture.flatMap((f) => {
    if (WALK_THROUGH.has(f.type) || (FURNITURE_ELEVATION[f.type] ?? 0) > 1200) return [];
    const r = (f.rot * Math.PI) / 180;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    const pt = (x: number, y: number): Vec2 => [(f.cx + x * c - y * sn) * M, (f.cy + x * sn + y * c) * M];
    const hw = f.w / 2;
    const hd = f.d / 2;
    return [[pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)]];
  });
}

export function blocked(colliders: readonly Collider[], p: Vec2, r = BODY_RADIUS): boolean {
  for (const c of colliders) if (distToSegment(p, c.a, c.b) < c.half + r) return true;
  return false;
}

/** 按 x、z 分开试走，撞墙时还能顺着墙滑 */
export function tryMove(colliders: readonly Collider[], from: Vec2, dx: number, dz: number, r = BODY_RADIUS): Vec2 {
  let x = from[0];
  let z = from[1];
  if (!blocked(colliders, [x + dx, z], r)) x += dx;
  if (!blocked(colliders, [x, z + dz], r)) z += dz;
  return [x, z];
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 漫游起点：从入户门往屋里走一步，面朝屋内；没有入户门就站在最大房间中间。
 * yaw 是绕 y 轴的角度，0 表示看向 -z。
 */
export function startPose(plan: Plan): {pos: Vec2; yaw: number} {
  const entry = plan.openings.find((o) => o.isEntry) ?? plan.openings.find((o) => o.kind === 'door');
  const inRoom = (p: Vec2) => plan.rooms.some((r) => r.counted !== false && pointInPolygon(p, r.poly));
  if (entry) {
    const mid: Vec2 = [(entry.a[0] + entry.b[0]) / 2, (entry.a[1] + entry.b[1]) / 2];
    const len = Math.hypot(entry.b[0] - entry.a[0], entry.b[1] - entry.a[1]) || 1;
    const n: Vec2 = [-(entry.b[1] - entry.a[1]) / len, (entry.b[0] - entry.a[0]) / len];
    const step = entry.thickness / 2 + 700;
    for (const s of [1, -1]) {
      const p: Vec2 = [mid[0] + n[0] * step * s, mid[1] + n[1] * step * s];
      if (inRoom(p)) return {pos: [p[0] * M, p[1] * M], yaw: Math.atan2(-n[0] * s, -n[1] * s)};
    }
  }
  const rooms = plan.rooms.filter((r) => r.counted !== false);
  const big = rooms.sort((a, b) => polygonArea(b.poly) - polygonArea(a.poly))[0];
  if (big) {
    const c = polygonCentroid(big.poly);
    return {pos: [c[0] * M, c[1] * M], yaw: 0};
  }
  return {pos: [0, 0], yaw: 0};
}

/** 平开门：铰链、门扇长度、关 / 开时的角度（绕 y 轴） */
export interface DoorInfo {
  id: string;
  hinge: Vec2;
  leaf: number;
  closed: number;
  open: number;
  head: number;
  thickness: number;
  /** 洞口中心（m），找最近的门用 */
  mid: Vec2;
}

export function doorsOf(openings: readonly Opening[]): DoorInfo[] {
  const ang = (v: Vec2) => Math.atan2(-v[1], v[0]);
  return openings.flatMap((o) => {
    if (o.kind !== 'door' || !o.swing) return [];
    const s = o.swing;
    const closed = ang(s.closed);
    let open = ang(s.open);
    // 走短的那一边转
    if (open - closed > Math.PI) open -= Math.PI * 2;
    if (closed - open > Math.PI) open += Math.PI * 2;
    return [
      {
        id: o.id,
        hinge: [s.hinge[0] * M, s.hinge[1] * M],
        leaf: s.leaf * M,
        closed,
        open,
        head: (o.head ?? 2100) * M,
        thickness: o.thickness * M,
        mid: [((o.a[0] + o.b[0]) / 2) * M, ((o.a[1] + o.b[1]) / 2) * M],
      },
    ];
  });
}

/** 关着的门挡人：按门扇关闭时的位置算一段碰撞 */
export function doorCollider(d: DoorInfo): Collider {
  return {a: d.hinge, b: [d.hinge[0] + Math.cos(d.closed) * d.leaf, d.hinge[1] - Math.sin(d.closed) * d.leaf], half: 0.03};
}
