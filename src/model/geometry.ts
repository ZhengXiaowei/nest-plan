import type {Furniture, Plan, Room, Vec2} from './types';
import {priceOf, WASTE_RATE} from './materials';

/** 多边形面积（mm²），鞋带公式 */
export function polygonArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** 多边形几何中心 */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (a === 0) return poly[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** 点是否在多边形内（射线法） */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const mm2ToM2 = (v: number) => v / 1_000_000;

export function roomArea(room: Room): number {
  return mm2ToM2(polygonArea(room.poly));
}

export interface FloorBudgetLine {
  roomId: string;
  name: string;
  area: number;
  cost: number;
}

export function floorBudget(plan: Plan): {lines: FloorBudgetLine[]; area: number; total: number} {
  const lines = plan.rooms
    .filter((r) => r.counted !== false)
    .map((r) => {
      const area = roomArea(r);
      return {roomId: r.id, name: r.name, area, cost: area * priceOf(plan, r.material) * (1 + WASTE_RATE)};
    });
  return {
    lines,
    area: lines.reduce((s, l) => s + l.area, 0),
    total: lines.reduce((s, l) => s + l.cost, 0),
  };
}

/** 家具旋转后的轴对齐半宽半高 */
export function furnitureHalfExtents(f: Furniture): {hw: number; hh: number} {
  const a = (f.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return {hw: (f.w / 2) * c + (f.d / 2) * s, hh: (f.w / 2) * s + (f.d / 2) * c};
}

export function planBounds(plan: Plan): {minX: number; minY: number; maxX: number; maxY: number} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = ([x, y]: Vec2, pad = 0) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  for (const w of plan.walls) {
    add(w.a, w.thickness / 2);
    add(w.b, w.thickness / 2);
  }
  for (const r of plan.rooms) r.poly.forEach((p) => add(p));
  if (!Number.isFinite(minX)) return {minX: 0, minY: 0, maxX: 10000, maxY: 10000};
  return {minX, minY, maxX, maxY};
}

/** 墙体中心线 + 厚度 → 四边形轮廓（用于 2D 绘制和 3D 挤出） */
export function segmentOutline(a: Vec2, b: Vec2, thickness: number): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

export const snap = (v: number, step: number) => Math.round(v / step) * step;

export const normAngle = (deg: number) => ((deg % 360) + 360) % 360;
