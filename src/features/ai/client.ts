import type {AiSettings} from './settings';

/**
 * 最小的多模态对话客户端，支持两类协议：
 * - OpenAI 兼容的 /chat/completions（OpenAI、各家兼容网关、本地模型服务等）
 * - Anthropic Messages API（/v1/messages）
 * 只做「发一轮、拿文本」，流式和工具调用留到 AI 助手阶段再加。
 */

export interface AiImage {
  /** data:image/png;base64,... */
  dataUrl: string;
}

export interface AiRequest {
  system?: string;
  text: string;
  images?: AiImage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function splitDataUrl(dataUrl: string): {mediaType: string; data: string} {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new AiError('图片格式不正确');
  return {mediaType: m[1]!, data: m[2]!};
}

export async function complete(settings: AiSettings, req: AiRequest): Promise<string> {
  return settings.protocol === 'anthropic' ? completeAnthropic(settings, req) : completeOpenAI(settings, req);
}

async function completeOpenAI(s: AiSettings, req: AiRequest): Promise<string> {
  const content = [
    ...(req.images ?? []).map((img) => ({type: 'image_url', image_url: {url: img.dataUrl}})),
    {type: 'text', text: req.text},
  ];
  const res = await fetch(`${trimSlash(s.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}`},
    body: JSON.stringify({
      model: s.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [...(req.system ? [{role: 'system', content: req.system}] : []), {role: 'user', content}],
    }),
  });
  if (!res.ok) throw new AiError(await errorText(res), res.status);
  const json = (await res.json()) as {
    choices?: {finish_reason?: string; message?: {content?: unknown; reasoning_content?: string; reasoning?: string}}[];
  };
  const choice = json.choices?.[0];
  const text = partsText(choice?.message?.content);
  if (!text.trim()) {
    throw emptyReply(choice?.finish_reason === 'length', Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning));
  }
  return text;
}

/** content 一般是字符串；部分网关返回分段数组 [{type: 'text', text}]，拼起来 */
function partsText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c: {text?: unknown} | string) => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : '')).join('');
}

/**
 * 模型没给出正式回复。最常见的是带深度思考的模型：思考把输出上限用完了，正式回复是空的。
 * 不说清楚的话，后面解析 JSON 只会报一句看不懂的英文。
 */
function emptyReply(outOfTokens: boolean, thought: boolean): AiError {
  if (outOfTokens) {
    return new AiError('模型用完了输出上限也没给出回复，多半是深度思考把额度占满了。换一个不带深度思考的模型，或者在接口那边关掉深度思考再试。');
  }
  if (thought) return new AiError('模型只返回了思考过程，没有给出正式回复。换一个不带深度思考的模型再试。');
  return new AiError('模型返回了空回复。检查模型名是否正确，或者换一个模型再试。');
}

async function completeAnthropic(s: AiSettings, req: AiRequest): Promise<string> {
  const content = [
    ...(req.images ?? []).map((img) => {
      const {mediaType, data} = splitDataUrl(img.dataUrl);
      return {type: 'image', source: {type: 'base64', media_type: mediaType, data}};
    }),
    {type: 'text', text: req.text},
  ];
  const res = await fetch(`${trimSlash(s.baseUrl)}/v1/messages`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': '2023-06-01',
      // 浏览器直连需要显式声明；密钥由用户自己填写并只保存在本机
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: s.model,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.system ? {system: req.system} : {}),
      messages: [{role: 'user', content}],
    }),
  });
  if (!res.ok) throw new AiError(await errorText(res), res.status);
  const json = (await res.json()) as {content?: {type: string; text?: string}[]; stop_reason?: string};
  const blocks = json.content ?? [];
  const text = blocks.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (!text.trim()) throw emptyReply(json.stop_reason === 'max_tokens', blocks.some((c) => c.type === 'thinking'));
  return text;
}

async function errorText(res: Response) {
  try {
    const body = await res.text();
    return `接口返回 ${res.status}：${body.slice(0, 300)}`;
  } catch {
    return `接口返回 ${res.status}`;
  }
}

/** 从模型回复里取出第一段 JSON（兼容包在 ```json 代码块里的情况） */
export function extractJson<T>(text: string): T {
  const raw = jsonCandidate(text);
  if (raw === null) {
    const said = text.trim().replace(/\s+/g, ' ');
    if (!said) throw emptyReply(false, false);
    throw new AiError(`模型没有按要求返回 JSON，它的回复是：「${said.length > 60 ? `${said.slice(0, 60)}…` : said}」。确认这个模型支持图片输入，或者换一个模型再试。`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AiError('模型返回的 JSON 不完整，可能是回复太长被截断了。换一张更清晰、更简单的户型图，或者换一个模型再试。');
  }
}

/** 回复里像 JSON 的那一段；一个 { 都没有时返回 null */
function jsonCandidate(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  if (fenced?.includes('{')) return fenced;
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = text.lastIndexOf('}');
  // 没有收尾的 }：多半是被截断了，交给 JSON.parse 报错
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}
