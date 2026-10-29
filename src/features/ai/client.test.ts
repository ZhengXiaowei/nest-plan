import {afterEach, describe, expect, it, vi} from 'vitest';
import {complete, extractJson} from './client';
import {recognizeFloorplan} from './recognize';
import type {AiProtocol, AiSettings} from './settings';

const settings = (protocol: AiProtocol): AiSettings => ({
  protocol,
  baseUrl: 'https://ai.example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  remember: false,
});

/** 让下一次 fetch 返回这段 JSON */
const reply = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {status: 200})));

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
