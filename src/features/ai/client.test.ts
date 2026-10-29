import {afterEach, describe, expect, it, vi} from 'vitest';
import {canToggleThinking, complete, extractJson} from './client';
import {recognizeFloorplan} from './recognize';
import type {AiProtocol, AiSettings} from './settings';

const settings = (protocol: AiProtocol, change: Partial<AiSettings> = {}): AiSettings => ({
  protocol,
  baseUrl: 'https://ai.example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  remember: false,
  thinking: false,
  ...change,
});

/** 让下一次 fetch 返回这段 JSON；返回 mock，用来查看发出去的请求 */
const reply = (body: unknown) => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), {status: 200}));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

/** 最近一次请求的 JSON 正文 */
const sentBody = (fetch: ReturnType<typeof reply>) => JSON.parse(String(fetch.mock.calls.at(-1)![1].body)) as Record<string, unknown>;

const OPENAI_OK = {choices: [{message: {content: '可以'}, finish_reason: 'stop'}]};
const ANTHROPIC_OK = {content: [{type: 'text', text: '可以'}], stop_reason: 'end_turn'};
const DEEPSEEK = {baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash'};

afterEach(() => vi.unstubAllGlobals());

describe('户型识别：模型回复里没有 JSON', () => {
  // 复现：模型回了空内容，界面只显示「识别失败：Unexpected end of JSON input」
  it('空回复给出看得懂的原因，不再是 JSON 解析的英文报错', async () => {
    reply({choices: [{message: {content: ''}, finish_reason: 'stop'}]});
    const err = await recognizeFloorplan(settings('openai'), {dataUrl: 'data:image/png;base64,AAAA'}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/Unexpected end of JSON input/);
    expect((err as Error).message).toMatch(/空回复/);
  });
});

describe('complete：读 OpenAI 兼容接口的回复', () => {
  it('content 是分段数组时拼出文字（部分网关这么返回）', async () => {
    reply({choices: [{message: {content: [{type: 'text', text: '{"walls":'}, {type: 'text', text: '[]}'}]}, finish_reason: 'stop'}]});
    await expect(complete(settings('openai'), {text: 'hi'})).resolves.toBe('{"walls":[]}');
  });

  it('输出上限被深度思考用完、正式回复为空时说明原因', async () => {
    reply({choices: [{message: {content: '', reasoning_content: '先看看这张图……'}, finish_reason: 'length'}]});
    await expect(complete(settings('openai'), {text: 'hi'})).rejects.toThrow(/深度思考/);
  });

  it('只返回思考过程、没有正式回复时说明原因', async () => {
    reply({choices: [{message: {content: null, reasoning_content: '嗯……'}, finish_reason: 'stop'}]});
    await expect(complete(settings('openai'), {text: 'hi'})).rejects.toThrow(/思考过程/);
  });

  it('content 为 null 时报空回复', async () => {
    reply({choices: [{message: {content: null}, finish_reason: 'stop'}]});
    await expect(complete(settings('openai'), {text: 'hi'})).rejects.toThrow(/空回复/);
  });
});

describe('complete：读 Anthropic 接口的回复', () => {
  it('输出上限用完、没有文字时说明原因', async () => {
    reply({content: [{type: 'thinking', thinking: '……'}], stop_reason: 'max_tokens'});
    await expect(complete(settings('anthropic'), {text: 'hi'})).rejects.toThrow(/深度思考/);
  });

  it('正常回复照常返回文字', async () => {
    reply({content: [{type: 'text', text: '可以'}], stop_reason: 'end_turn'});
    await expect(complete(settings('anthropic'), {text: 'hi'})).resolves.toBe('可以');
  });
});

describe('深度思考开关（目前只认 DeepSeek）', () => {
  it('认得出 DeepSeek 的接口地址，两种协议都算', () => {
    expect(canToggleThinking({baseUrl: 'https://api.deepseek.com'})).toBe(true);
    expect(canToggleThinking({baseUrl: 'https://api.deepseek.com/v1/'})).toBe(true);
    expect(canToggleThinking({baseUrl: 'https://api.deepseek.com/anthropic'})).toBe(true);
    expect(canToggleThinking({baseUrl: 'https://api.openai.com/v1'})).toBe(false);
    expect(canToggleThinking({baseUrl: 'https://proxy.example.test/deepseek'})).toBe(false);
    expect(canToggleThinking({baseUrl: 'api.deepseek.com'})).toBe(false);
    expect(canToggleThinking({baseUrl: ''})).toBe(false);
  });

  it('开关关着：OpenAI 协议的请求里带上 thinking disabled', async () => {
    const fetch = reply(OPENAI_OK);
    await complete(settings('openai', DEEPSEEK), {text: 'hi'});
    expect(sentBody(fetch).thinking).toEqual({type: 'disabled'});
  });

  it('开关关着：Anthropic 协议的请求里也带上 thinking disabled', async () => {
    const fetch = reply(ANTHROPIC_OK);
    await complete(settings('anthropic', {...DEEPSEEK, baseUrl: 'https://api.deepseek.com/anthropic'}), {text: 'hi'});
    expect(sentBody(fetch).thinking).toEqual({type: 'disabled'});
  });

  it('开关打开：不带 thinking，用 DeepSeek 默认的思考', async () => {
    const fetch = reply(OPENAI_OK);
    await complete(settings('openai', {...DEEPSEEK, thinking: true}), {text: 'hi'});
    expect(sentBody(fetch)).not.toHaveProperty('thinking');
  });

  it('测试连接固定不开思考，不受开关影响', async () => {
    const fetch = reply(OPENAI_OK);
    await complete(settings('openai', {...DEEPSEEK, thinking: true}), {text: 'hi', thinking: false});
    expect(sentBody(fetch).thinking).toEqual({type: 'disabled'});
  });

  it('不是 DeepSeek 的接口什么都不加，免得严格的接口报错', async () => {
    const fetch = reply(OPENAI_OK);
    await complete(settings('openai'), {text: 'hi'});
    expect(sentBody(fetch)).not.toHaveProperty('thinking');
  });

  it('DeepSeek 思考用完额度时，提示去「连接 AI」里关掉深度思考', async () => {
    reply({choices: [{message: {content: '', reasoning_content: '……'}, finish_reason: 'length'}]});
    await expect(complete(settings('openai', {...DEEPSEEK, thinking: true}), {text: 'hi'})).rejects.toThrow(/在「连接 AI」里关掉「深度思考」/);
  });
});

describe('extractJson', () => {
  it('取出代码块里的 JSON', () => {
    expect(extractJson('好的：\n```json\n{"walls":[]}\n```')).toEqual({walls: []});
  });

  it('取出夹在文字中间的 JSON', () => {
    expect(extractJson('结果是 {"walls":[1]} 以上')).toEqual({walls: [1]});
  });

  it('回复里没有 JSON 时带上模型原话', () => {
    expect(() => extractJson('抱歉，我无法识别这张图片。')).toThrow(/没有按要求返回 JSON.*抱歉，我无法识别这张图片/);
  });

  it('JSON 写到一半被截断时说明可能被截断', () => {
    expect(() => extractJson('```json\n{"walls":[{"a":[1,2],"b":[3,4]},{"a":[5,6')).toThrow(/截断/);
    expect(() => extractJson('{"walls":[[1,2')).toThrow(/截断/);
  });
});
