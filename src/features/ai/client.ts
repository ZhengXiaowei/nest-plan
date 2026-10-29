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
  const json = (await res.json()) as {choices?: {message?: {content?: string}}[]};
  return json.choices?.[0]?.message?.content ?? '';
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
  const json = (await res.json()) as {content?: {type: string; text?: string}[]};
  return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
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
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw) as T;
}
