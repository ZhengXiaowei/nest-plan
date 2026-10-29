import type {Opening, Plan, Room, Vec2, Wall, WallKind} from '../../model/types';
import {uid} from '../../lib/id';
import type {AiSettings} from './settings';
import {complete, extractJson, type AiImage} from './client';

/**
 * AI 户型识别：把户型截图交给用户配置的多模态模型，
 * 让它返回像素坐标下的墙、门窗、房间和图上能读到的尺寸标注，
 * 再由用户在「校对」「标定」两步里修正，最后换算成毫米。
 */

export interface RecognizedPlan {
  walls: {a: [number, number]; b: [number, number]; thickness: number; kind?: WallKind; confidence?: number}[];
  openings: {kind: 'window' | 'door' | 'slidingDoor'; a: [number, number]; b: [number, number]; confidence?: number}[];
  rooms: {name: string; poly: [number, number][]; confidence?: number}[];
  /** 图上的尺寸标注：两个像素点之间标的是多少毫米，用于自动标定 */
  dimensions: {a: [number, number]; b: [number, number]; mm: number}[];
}

const SYSTEM = `你是户型图识别助手。输入是一张住宅户型图（可能是截图或照片）。
只输出一个 JSON 对象，不要解释。坐标一律是图片像素坐标，原点在左上角。
字段：
- walls: 墙体中心线 {a:[x,y], b:[x,y], thickness: 像素厚度, kind: "bearing"|"exterior"|"partition"|"low", confidence: 0~1}
- openings: 门窗 {kind: "window"|"door"|"slidingDoor", a:[x,y], b:[x,y], confidence}
- rooms: 房间 {name: 图上的房间名（如 客厅、主卧）, poly: [[x,y],...] 内轮廓, confidence}
- dimensions: 图上能读到的尺寸标注 {a:[x,y], b:[x,y], mm: 标注数值}
看不清的部分宁可不输出，也不要猜。`;

export async function recognizeFloorplan(settings: AiSettings, image: AiImage, signal?: AbortSignal): Promise<RecognizedPlan> {
  const text = await complete(settings, {
    system: SYSTEM,
    text: '识别这张户型图，按要求输出 JSON。',
    images: [image],
    maxTokens: 8000,
    signal,
  });
  const raw = extractJson<Partial<RecognizedPlan>>(text);
  return {
    walls: raw.walls ?? [],
    openings: raw.openings ?? [],
    rooms: raw.rooms ?? [],
    dimensions: raw.dimensions ?? [],
  };
}

/** 用尺寸标注估算比例（中位数，抗个别读错） */
export function estimateMmPerPixel(r: RecognizedPlan): number | null {
  const ratios = r.dimensions
    .map((d) => d.mm / Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((x, y) => x - y);
  if (!ratios.length) return null;
  return ratios[Math.floor(ratios.length / 2)]!;
}

/** 像素坐标 → 毫米，生成可编辑的户型 */
export function recognizedToPlan(r: RecognizedPlan, mmPerPixel: number, name = '我的户型'): Plan {
  const s = (p: readonly [number, number]): Vec2 => [Math.round(p[0] * mmPerPixel), Math.round(p[1] * mmPerPixel)];
  const walls: Wall[] = r.walls.map((w) => ({
    id: uid('w'),
    a: s(w.a),
    b: s(w.b),
    thickness: Math.max(80, Math.round(w.thickness * mmPerPixel)),
    kind: w.kind ?? 'partition',
  }));
  const openings: Opening[] = r.openings.map((o) => ({
    id: uid('o'),
    kind: o.kind,
    a: s(o.a),
    b: s(o.b),
    thickness: 240,
    sill: o.kind === 'window' ? 900 : undefined,
    head: o.kind === 'window' ? 2400 : 2100,
  }));
  const rooms: Room[] = r.rooms.map((room) => ({
    id: uid('r'),
    name: room.name,
    poly: room.poly.map(s),
    material: /卫|厨|阳台/.test(room.name) ? 'antislip' : /卧|房/.test(room.name) ? 'wood' : 'tile800',
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
    source: {kind: 'image', mmPerPixel},
  };
}
