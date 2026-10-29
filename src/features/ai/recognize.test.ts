import {afterEach, describe, expect, it, vi} from 'vitest';
import {recognizeFloorplan, toImagePixels, type RecognizedPlan} from './recognize';
import type {AiSettings} from './settings';

const settings: AiSettings = {
  protocol: 'openai',
  baseUrl: 'https://ai.example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  remember: false,
  thinking: false,
};

/** 宽 2000、高 1000 的图：横竖换算比例不同，能看出有没有分开换算 */
const image = {dataUrl: 'data:image/png;base64,AAAA', width: 2000, height: 1000};

/** 让模型回复这段 JSON；返回 mock，用来查看发出去的请求 */
const modelSays = (plan: Partial<RecognizedPlan>) => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(plan)}, finish_reason: 'stop'}]}), {status: 200}),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => vi.unstubAllGlobals());

const RELATIVE: Partial<RecognizedPlan> = {
  walls: [{a: [100, 200], b: [900, 200], thickness: 10, kind: 'exterior'}],
  openings: [{kind: 'door', a: [400, 200], b: [450, 200]}],
  rooms: [{name: '客厅', poly: [[100, 200], [900, 200], [900, 800], [100, 800]]}],
  dimensions: [{a: [100, 100], b: [900, 100], mm: 8000}],
};

describe('户型识别：坐标换算', () => {
  // 复现：DeepSeek 按宽高各 0~1000 的相对坐标回答，之前直接当像素用，结果整体缩小、挤到左上角
  it('相对坐标按图片宽高分别换算回像素', async () => {
    modelSays(RELATIVE);
    const r = await recognizeFloorplan(settings, image);
    expect(r.walls[0]).toMatchObject({a: [200, 200], b: [1800, 200], thickness: 20});
    expect(r.openings[0]).toMatchObject({a: [800, 200], b: [900, 200]});
    expect(r.rooms[0]!.poly).toEqual([[200, 200], [1800, 200], [1800, 800], [200, 800]]);
    // 尺寸标注也要换算，否则自动估算的比例会错
    expect(r.dimensions[0]).toMatchObject({a: [200, 100], b: [1800, 100], mm: 8000});
  });

  it('提示词要求用 0~1000 的相对坐标', async () => {
    const fetch = modelSays(RELATIVE);
    await recognizeFloorplan(settings, image);
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body)) as {messages: {role: string; content: unknown}[]};
    expect(JSON.stringify(body.messages[0])).toMatch(/1000/);
  });

  it('模型没照做、直接给了像素（出现明显大于 1000 的数）时原样使用', () => {
    const pixels: RecognizedPlan = {
      walls: [{a: [150, 120], b: [1850, 120], thickness: 18}],
      openings: [],
      rooms: [],
      dimensions: [],
    };
    expect(toImagePixels(pixels, image)).toEqual(pixels);
  });

  it('一项都没识别出来时不出错', () => {
    const empty: RecognizedPlan = {walls: [], openings: [], rooms: [], dimensions: []};
    expect(toImagePixels(empty, image)).toEqual(empty);
  });
});
