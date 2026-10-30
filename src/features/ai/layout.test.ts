import {afterEach, describe, expect, it, vi} from 'vitest';
import {layoutRoom} from './layout';
import type {AiSettings} from './settings';
import {createSamplePlan} from '../../model/samplePlan';
import {furnitureInRoom} from '../../model/autolayout';

const settings: AiSettings = {
  protocol: 'openai',
  baseUrl: 'https://ai.example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  remember: false,
  thinking: false,
};

const plan = createSamplePlan();

/** 模拟接口按顺序回复这些文字；返回 mock，用来查看发出去的请求 */
function replies(...texts: string[]) {
  let i = 0;
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
    const content = texts[Math.min(i++, texts.length - 1)]!;
    return new Response(JSON.stringify({choices: [{message: {content}, finish_reason: 'stop'}]}), {status: 200});
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** 第 n 次请求发出去的提示词（系统 + 用户） */
const promptOf = (fetch: ReturnType<typeof replies>, n: number) => {
  const body = JSON.parse(String(fetch.mock.calls[n]![1].body)) as {messages: {content: unknown}[]};
  return body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
};

const json = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';

const GOOD = {
  note: '床头靠图纸上方的墙，两侧床头柜；衣柜放下方的墙靠右，避开门。',
  items: [
    {id: 'bed', item: '双人床 1.8m', wall: 'A', align: 'center'},
    {id: 'n1', item: '床头柜', beside: 'bed', side: 'start'},
    {id: 'n2', item: '床头柜', beside: 'bed', side: 'end'},
    {id: 'wd', item: '衣柜', wall: 'C', align: 'end'},
  ],
};

/** 衣柜堵在飘窗开口前（墙太短，滑不开），检查会报挡窗 */
const BLOCKS_BAY = {
  note: '衣柜放右侧的墙。',
  items: [
    {id: 'bed', item: '双人床 1.8m', wall: 'A', align: 'center'},
    {id: 'wd', item: '衣柜', wall: 'B', align: 'center'},
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('AI 布置房间', () => {
  it('提示词里有房间、墙面、门窗、家具库和需求', async () => {
    const fetch = replies(json(GOOD));
    await layoutRoom(settings, plan, 'master', {request: '两口人，要梳妆台', keepExisting: false});
    const p = promptOf(fetch, 0);
    expect(p).toMatch(/主卧室/);
    expect(p).toMatch(/A：上方的墙，长 3670 mm/);
    expect(p).toMatch(/800~2600 mm 是飘窗（窗台高 450 mm）/);
    expect(p).toMatch(/主卧门」（向房间里开/);
    expect(p).toMatch(/主卫门」（向外开/);
    expect(p).toMatch(/双人床 1\.8m 1800×2000/);
    expect(p).toMatch(/两口人，要梳妆台/);
    // 留空要求和居住体检同一套数
    expect(p).toMatch(/衣柜前 600 mm/);
    expect(p).toMatch(/书桌前 700 mm/);
  });

  it('一轮通过：只请求一次，返回摆好的家具和设计说明', async () => {
    const fetch = replies(json(GOOD));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.rounds).toBe(1);
    expect(r.issues).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.note).toBe(GOOD.note);
    expect(r.furniture.map((f) => f.name)).toEqual(['双人床 1.8m', '床头柜', '床头柜', '衣柜']);
  });

  it('有问题时把上一版和问题交回 AI 修正一次，用第二版', async () => {
    const fetch = replies(json(BLOCKS_BAY), json(GOOD));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = promptOf(fetch, 1);
    expect(second).toMatch(/上一版布置/);
    expect(second).toMatch(/衣柜」挡住了 B 墙的飘窗/);
    expect(r.rounds).toBe(2);
    expect(r.issues).toEqual([]);
    expect(r.furniture).toHaveLength(4);
  });

  it('修正后仍有问题：不再请求，如实返回剩下的问题', async () => {
    const fetch = replies(json(BLOCKS_BAY), json(BLOCKS_BAY), json(GOOD));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.issues.map((i) => i.kind)).toContain('window');
  });

  it('家具库没有的东西会跳过，并交给 AI 修正', async () => {
    const fetch = replies(json({note: '', items: [{id: 'x', item: '水床', wall: 'A'}]}), json(GOOD));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(promptOf(fetch, 1)).toMatch(/家具库里没有「水床」/);
    expect(r.skipped).toEqual([]);
  });

  it('修正那一轮出错时用第一版，并说明', async () => {
    replies(json(BLOCKS_BAY), '抱歉，我做不到。');
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(r.rounds).toBe(1);
    expect(r.furniture).toHaveLength(2);
    expect(r.skipped.join('\n')).toMatch(/修正时出错/);
  });

  it('第一轮回复不是 JSON 时报中文错误', async () => {
    replies('抱歉，我做不到。');
    await expect(layoutRoom(settings, plan, 'master', {keepExisting: false})).rejects.toThrow(/没有按要求返回 JSON/);
  });

  it('保留已有家具：提示词里列出它们，检查时也算上', async () => {
    const kept = furnitureInRoom(plan, 'master');
    const fetch = replies(json(GOOD));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: true});
    const p = promptOf(fetch, 0);
    expect(p).toMatch(/已有家具/);
    expect(p).toMatch(new RegExp(kept[0]!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // 原有的床还在，新放的床会和它压在一起
    expect(r.issues.some((i) => i.kind === 'overlap')).toBe(true);
  });

  it('不支持的房间直接报错，不请求 AI', async () => {
    const fetch = replies(json(GOOD));
    await expect(layoutRoom(settings, plan, 'gbath', {keepExisting: false})).rejects.toThrow(/暂不支持/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('数字写成字符串也认', async () => {
    replies(json({note: '', items: [{id: 'a', item: '书架', wall: 'A', align: 'start', offset: '300'}]}));
    const r = await layoutRoom(settings, plan, 'master', {keepExisting: false});
    expect(r.furniture[0]!.cx).toBe(6600 + 300 + 400);
  });
});
