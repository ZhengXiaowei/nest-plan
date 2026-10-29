import type {WallKind} from '../../model/types';
import type {AiSettings} from './settings';
import {complete, extractJson, type AiImage} from './client';

/**
 * AI 户型识别：把户型截图交给用户配置的多模态模型，
 * 让它返回像素坐标下的墙、门窗、房间和图上能读到的尺寸标注，
 * 再由用户在「校对」「标定」两步里修正，最后换算成毫米（见 features/trace/draft.ts）。
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
