import type {WallKind} from '../../model/types';
import type {AiSettings} from './settings';
import {complete, extractJson, type AiImage} from './client';

/**
 * AI 户型识别：把户型截图交给用户配置的多模态模型，
 * 让它返回墙、门窗、房间和图上能读到的尺寸标注，换算成图片像素坐标，
 * 再由用户在「校对」「标定」两步里修正，最后换算成毫米（见 features/trace/draft.ts）。
 */

/** 识别结果，坐标是图片像素（原点在左上角） */
export interface RecognizedPlan {
  walls: {a: [number, number]; b: [number, number]; thickness: number; kind?: WallKind; confidence?: number}[];
  openings: {kind: 'window' | 'door' | 'slidingDoor'; a: [number, number]; b: [number, number]; confidence?: number}[];
  rooms: {name: string; poly: [number, number][]; confidence?: number}[];
  /** 图上的尺寸标注：两个像素点之间标的是多少毫米，用于自动标定 */
  dimensions: {a: [number, number]; b: [number, number]; mm: number}[];
}

/**
 * 坐标让模型按宽高各 0~1000 的相对值给，不要像素：
 * 接口会先把图片缩放再交给模型（DeepSeek 缩到约 1300×1300 的像素量），模型看不到原图尺寸，
 * 给的「像素」并不是我们这张图的像素；不少视觉模型本来也是按 0~1000 的相对坐标训练的。
 */
const SYSTEM = `你是户型图识别助手。输入是一张住宅户型图（可能是截图或照片）。
只输出一个 JSON 对象，不要解释。
坐标一律用相对坐标：把图片的宽和高都看作 1000，左上角是 [0,0]，右下角是 [1000,1000]，x 向右、y 向下，取整数。
字段：
- walls: 墙体中心线 {a:[x,y], b:[x,y], thickness: 墙厚（同样按图片宽 1000 计）, kind: "bearing"|"exterior"|"partition"|"low", confidence: 0~1}
- openings: 门窗 {kind: "window"|"door"|"slidingDoor", a:[x,y], b:[x,y], confidence}
- rooms: 房间 {name: 图上的房间名（如 客厅、主卧）, poly: [[x,y],...] 内轮廓, confidence}
- dimensions: 图上能读到的尺寸标注 {a:[x,y], b:[x,y], mm: 标注数值}
户型图的墙大多是水平或竖直的；相邻两面墙在墙角处的中心线端点要接在一起。
看不清的部分宁可不输出，也不要猜。`;

export async function recognizeFloorplan(
  settings: AiSettings,
  image: AiImage & {width: number; height: number},
  signal?: AbortSignal,
): Promise<RecognizedPlan> {
  const text = await complete(settings, {
    system: SYSTEM,
    text: '识别这张户型图，按要求输出 JSON。',
    images: [{dataUrl: image.dataUrl}],
    maxTokens: 8000,
    signal,
  });
  const raw = extractJson<Partial<RecognizedPlan>>(text);
  return toImagePixels(
    {
      walls: raw.walls ?? [],
      openings: raw.openings ?? [],
      rooms: raw.rooms ?? [],
      dimensions: raw.dimensions ?? [],
    },
    image,
  );
}

/** 相对坐标最大是 1000，留一点余量：超过它说明模型没照做、直接给了像素 */
const RELATIVE_MAX = 1050;

/**
 * 把模型给的 0~1000 相对坐标换算成图片像素，x 按宽、y 按高、墙厚按宽。
 * 模型没照做、坐标里出现明显大于 1000 的数时，按像素原样使用。
 * 图片小于 1000 像素时这个判断分不清，按相对坐标算（提示词就是这么要求的）。
 */
export function toImagePixels(r: RecognizedPlan, size: {width: number; height: number}): RecognizedPlan {
  const points = [
    ...r.walls.flatMap((w) => [w.a, w.b]),
    ...r.openings.flatMap((o) => [o.a, o.b]),
    ...r.rooms.flatMap((room) => room.poly),
    ...r.dimensions.flatMap((d) => [d.a, d.b]),
  ];
  if (!points.length || points.some(([x, y]) => x > RELATIVE_MAX || y > RELATIVE_MAX)) return r;
  const kx = size.width / 1000;
  const ky = size.height / 1000;
  const p = ([x, y]: [number, number]): [number, number] => [x * kx, y * ky];
  return {
    walls: r.walls.map((w) => ({...w, a: p(w.a), b: p(w.b), thickness: w.thickness * kx})),
    openings: r.openings.map((o) => ({...o, a: p(o.a), b: p(o.b)})),
    rooms: r.rooms.map((room) => ({...room, poly: room.poly.map(p)})),
    dimensions: r.dimensions.map((d) => ({...d, a: p(d.a), b: p(d.b)})),
  };
}
