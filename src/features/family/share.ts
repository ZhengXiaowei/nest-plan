import type {Plan, Vec2} from '../../model/types';
import {parsePlan} from '../design/planFiles';
import {uid} from '../../lib/id';

/**
 * 家人一起选：不需要服务器。
 * 候选方案压缩后整个放进链接的 # 后面（# 后面的内容浏览器不会发给任何服务器），
 * 家人打开链接投票、在图上留言，再生成一条很短的回复链接发回来，导入后在本机汇总。
 */

export interface Candidate {
  id: string;
  name: string;
  note?: string;
  plan: Plan;
  savedAt: number;
}

/** 发出去的一组候选 */
export interface SharePack {
  v: 1;
  id: string;
  /** 发起人的称呼 */
  from: string;
  question: string;
  candidates: Candidate[];
  at: number;
}

/** 留在图上的一条意见 */
export interface Pin {
  id: string;
  candidate: string;
  at: Vec2;
  text: string;
}

/** 家人的回复 */
export interface Reply {
  v: 1;
  share: string;
  author: string;
  /** 最喜欢的方案，可以不选 */
  pick: string | null;
  pins: Pin[];
  at: number;
}

/* ---------- 压缩成链接 ---------- */

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 解压后最多 2 MB，防止恶意链接撑爆内存 */
const MAX_JSON = 2_000_000;

export async function encodeData(data: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeData(text: string): Promise<unknown> {
  const raw = await pipe(fromBase64Url(text.trim()), new DecompressionStream('deflate-raw'));
  if (raw.length > MAX_JSON) throw new Error('内容太大');
  return JSON.parse(new TextDecoder().decode(raw));
}

/* ---------- 校验：链接是别人发来的，内容一律当不可信 ---------- */

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const COLOR = /^#[0-9a-f]{3,8}$/i;

function cleanPlan(raw: unknown): Plan {
  const p = parsePlan(raw);
  return {
    ...p,
    name: str(p.name, 40, '方案'),
    openings: p.openings.filter(
      (o) => isVec(o.a) && isVec(o.b) && isNum(o.thickness) && (!o.swing || (isVec(o.swing.hinge) && isVec(o.swing.open) && isVec(o.swing.closed) && isNum(o.swing.leaf))),
    ),
    furniture: p.furniture.map((f) => ({
      ...f,
      id: str(f.id, 40, uid('f')),
      type: str(f.type, 30, 'cabinet'),
      name: str(f.name, 20, '家具'),
      rot: isNum(f.rot) ? f.rot : 0,
      color: typeof f.color === 'string' && COLOR.test(f.color) ? f.color : '#E8DCCB',
    })),
    rooms: p.rooms.map((r) => ({...r, name: str(r.name, 20, '房间')})),
  };
}

export function parsePack(data: unknown): SharePack {
  const d = data as Partial<SharePack>;
  if (!d || d.v !== 1 || !Array.isArray(d.candidates) || !d.candidates.length) throw new Error('链接里没有方案');
  const candidates = d.candidates.slice(0, 6).map((c) => ({
    id: str(c.id, 40, uid('c')),
    name: str(c.name, 20, '方案'),
    note: str(c.note, 200) || undefined,
    plan: cleanPlan(c.plan),
    savedAt: isNum(c.savedAt) ? c.savedAt : Date.now(),
  }));
  return {v: 1, id: str(d.id, 40) || uid('s'), from: str(d.from, 20), question: str(d.question, 100), candidates, at: isNum(d.at) ? d.at : Date.now()};
}

export function parseReply(data: unknown): Reply {
  const d = data as Partial<Reply>;
  if (!d || d.v !== 1 || typeof d.share !== 'string') throw new Error('不是栖图的回复');
  const pins = (Array.isArray(d.pins) ? d.pins : []).slice(0, 60).flatMap((p) =>
    p && isVec(p.at) && typeof p.text === 'string' && p.text.trim()
      ? [{id: str(p.id, 40, uid('p')), candidate: str(p.candidate, 40), at: p.at, text: p.text.trim().slice(0, 200)}]
      : [],
  );
  return {v: 1, share: d.share.slice(0, 40), author: str(d.author, 20).trim() || '家人', pick: typeof d.pick === 'string' ? d.pick.slice(0, 40) : null, pins, at: isNum(d.at) ? d.at : Date.now()};
}

/* ---------- 链接 ---------- */

export type VoteLink = {kind: 'pack'; data: string} | {kind: 'reply'; data: string};

/** #/vote?d=…（一组方案）或 #/vote?r=…（回复） */
export function linkFor(kind: VoteLink['kind'], data: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/vote?${kind === 'pack' ? 'd' : 'r'}=${data}`;
}

/** 从链接或 hash 里认出要导入的内容；用户也可能直接粘贴整条链接 */
export function readVoteLink(text: string): VoteLink | null {
  const m = /[?&]([dr])=([A-Za-z0-9_-]+)/.exec(text);
  if (!m) return null;
  return {kind: m[1] === 'd' ? 'pack' : 'reply', data: m[2]!};
}

/** 把最新的回复按作者合并：同一个人再发一次，以新的为准 */
export function mergeReply(replies: Reply[], r: Reply): Reply[] {
  return [...replies.filter((x) => x.author !== r.author), r].sort((a, b) => a.at - b.at);
}

/** 每个方案得了几票、谁投的 */
export function tally(pack: SharePack, replies: Reply[]): Map<string, string[]> {
  const out = new Map(pack.candidates.map((c) => [c.id, [] as string[]]));
  for (const r of replies) if (r.pick && out.has(r.pick)) out.get(r.pick)!.push(r.author);
  return out;
}
