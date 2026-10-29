import {CATALOG} from '../../model/catalog';
import {diffCheckups, runCheckup, type Checkup, type Issue} from '../../model/checkup';
import {normAngle, planBounds, roomArea} from '../../model/geometry';
import {liveOpenings} from '../../model/walls';
import type {Furniture, Plan, Vec2} from '../../model/types';
import {uid} from '../../lib/id';
import {complete, extractJson} from './client';
import type {AiSettings} from './settings';

/**
 * AI 改方案：把户型、家具和体检结果交给用户自己的模型，模型回一组改动（挪、转、改尺寸、加、删），
 * 在本地校验后套到方案上，再跑一遍体检对比前后。改动引出新问题时让模型再改一轮。
 * 方案数据只发给用户自己填的接口，不经过栖图的服务器。
 */

export type Action =
  | {op: 'update'; id: string; cx?: number; cy?: number; rot?: number; w?: number; d?: number}
  | {op: 'add'; type: string; name?: string; cx: number; cy: number; w?: number; d?: number; rot?: number}
  | {op: 'remove'; id: string};

export interface Change {
  op: Action['op'];
  /** 改动后的家具 id（删掉的是原来的 id） */
  id: string;
  text: string;
  at: Vec2;
}

const r = Math.round;
const pt = (p: Vec2): Vec2 => [r(p[0]), r(p[1])];

const CATALOG_ITEMS = CATALOG.flatMap((g) => g.items);

function roomAt(plan: Plan, x: number, y: number): string {
  for (const room of plan.rooms) {
    let inside = false;
    const poly = room.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return room.name;
  }
  return '';
}

/** 给模型看的方案：只给改家具用得上的东西，数字取整 */
export function agentContext(plan: Plan, check: Checkup): string {
  const openings = liveOpenings(plan);
  const data = {
    rooms: plan.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      area: Number(roomArea(room).toFixed(1)),
      poly: room.poly.map(pt),
    })),
    doors: openings
      .filter((o) => o.kind !== 'window')
      .map((o) => ({
        id: o.id,
        name: o.name ?? (o.isEntry ? '入户门' : o.kind === 'slidingDoor' ? '推拉门' : '门'),
        a: pt(o.a),
        b: pt(o.b),
        ...(o.swing ? {swingHinge: pt(o.swing.hinge), swingLeaf: r(o.swing.leaf), opensToward: pt(o.swing.open)} : {}),
      })),
    windows: openings.filter((o) => o.kind === 'window').map((o) => ({a: pt(o.a), b: pt(o.b), sill: o.sill ?? 900})),
    furniture: plan.furniture.map((f) => ({
      id: f.id,
      type: f.type,
      name: f.name,
      cx: r(f.cx),
      cy: r(f.cy),
      w: r(f.w),
      d: r(f.d),
      rot: r(f.rot),
      room: roomAt(plan, f.cx, f.cy),
    })),
    issues: check.issues.map((i) => ({id: i.id, level: i.severity, title: i.title, furniture: i.furniture, at: pt(i.at)})),
    score: check.score,
  };
  const catalog = [...new Map(CATALOG_ITEMS.map((i) => [i.type, `${i.type}=${i.name} ${i.w}×${i.d}`])).values()].join('；');
  return `当前方案（JSON）：\n${JSON.stringify(data)}\n可添加的家具类型：${catalog}`;
}

export const AGENT_RULES = `你是栖图的家装设计助手，能直接帮用户改家具布置，用中文回答，口语、简短、具体。
坐标单位 mm，x 向右，y 向下（图纸上方 y 小）。房间 poly 是房间内墙面围成的多边形，墙在多边形外面。
家具 cx、cy 是中心；w 是宽、d 是深；rot 是顺时针角度。rot=0 时靠背 / 床头 / 柜背朝上（-y），正面朝下；rot=90 靠背朝右（+x）；rot=180 朝下；rot=270 朝左。rot 为 90 或 270 时家具在 x 方向占 d、在 y 方向占 w。
要求：家具完整放在房间多边形里，不压墙、不互相压着；平开门扫过的扇形（以 swingHinge 为圆心、swingLeaf 为半径，朝 opensToward 开）里不放家具；靠墙放的家具背面贴墙；床两侧、床尾、柜子前面留 500 到 600 mm；主要通道 750 到 900 mm。
issues 是体检发现的问题，用户让你解决时优先改它们。改动越少越好，不动墙和门窗。
只回一段 JSON，不要别的文字：
{"reply":"给用户看的说明，两三句话，说改了什么、为什么","actions":[...]}
actions 里每一项是下面三种之一，只写要改的字段：
{"op":"update","id":"家具id","cx":0,"cy":0,"rot":0,"w":0,"d":0}
{"op":"add","type":"类型","name":"名称","cx":0,"cy":0,"w":0,"d":0,"rot":0}
{"op":"remove","id":"家具id"}
用户只是提问、不需要改方案时 actions 给空数组。`;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const size = (v: unknown) => {
  const n = num(v);
  return n === undefined ? undefined : Math.min(8000, Math.max(100, Math.round(n)));
};

function describeUpdate(before: Furniture, after: Furniture): string {
  const parts: string[] = [];
  if (Math.hypot(after.cx - before.cx, after.cy - before.cy) >= 1) parts.push(`挪了 ${Math.round(Math.hypot(after.cx - before.cx, after.cy - before.cy))} mm`);
  if (after.rot !== before.rot) parts.push('转了方向');
  if (after.w !== before.w || after.d !== before.d) parts.push(`改成 ${after.w}×${after.d}`);
  return `${before.name}${parts.join('、')}`;
}

/** 校验并套用改动：不认识的 id、类型和不合理的数字直接跳过 */
export function applyActions(plan: Plan, actions: unknown): {plan: Plan; changes: Change[]; skipped: number} {
  if (!Array.isArray(actions)) return {plan, changes: [], skipped: 0};
  const b = planBounds(plan);
  const pad = 2000;
  const inBounds = (x: number, y: number) => x > b.minX - pad && x < b.maxX + pad && y > b.minY - pad && y < b.maxY + pad;
  let furniture = plan.furniture;
  const changes: Change[] = [];
  let skipped = 0;
  for (const raw of actions as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      continue;
    }
    if (raw.op === 'update') {
      const f = furniture.find((x) => x.id === raw.id);
      if (!f) {
        skipped++;
        continue;
      }
      const cx = num(raw.cx) ?? f.cx;
      const cy = num(raw.cy) ?? f.cy;
      if (!inBounds(cx, cy)) {
        skipped++;
        continue;
      }
      const rot = num(raw.rot);
      const next: Furniture = {...f, cx: Math.round(cx), cy: Math.round(cy), rot: rot === undefined ? f.rot : normAngle(Math.round(rot)), w: size(raw.w) ?? f.w, d: size(raw.d) ?? f.d};
      if (next.cx === f.cx && next.cy === f.cy && next.rot === f.rot && next.w === f.w && next.d === f.d) continue;
      furniture = furniture.map((x) => (x.id === f.id ? next : x));
      changes.push({op: 'update', id: f.id, text: describeUpdate(f, next), at: [next.cx, next.cy]});
    } else if (raw.op === 'add') {
      const item = CATALOG_ITEMS.find((i) => i.type === raw.type);
      const cx = num(raw.cx);
      const cy = num(raw.cy);
      if (!item || cx === undefined || cy === undefined || !inBounds(cx, cy)) {
        skipped++;
        continue;
      }
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 20) : item.name;
      const f: Furniture = {
        id: uid('f'),
        type: item.type,
        name,
        cx: Math.round(cx),
        cy: Math.round(cy),
        w: size(raw.w) ?? item.w,
        d: size(raw.d) ?? item.d,
        rot: normAngle(Math.round(num(raw.rot) ?? 0)),
        color: item.color,
      };
      furniture = f.type === 'rug' ? [f, ...furniture] : [...furniture, f];
      changes.push({op: 'add', id: f.id, text: `加了${name}`, at: [f.cx, f.cy]});
    } else if (raw.op === 'remove') {
      const f = furniture.find((x) => x.id === raw.id);
      if (!f) {
        skipped++;
        continue;
      }
      furniture = furniture.filter((x) => x.id !== f.id);
      changes.push({op: 'remove', id: f.id, text: `拿走了${f.name}`, at: [f.cx, f.cy]});
    } else skipped++;
  }
  return {plan: changes.length ? {...plan, furniture} : plan, changes, skipped};
}

interface AgentReply {
  reply?: unknown;
  actions?: unknown;
}

/** 模型回复里取 JSON；取不到时整段当成文字回答 */
export function parseReply(text: string): {reply: string; actions: unknown[]} {
  try {
    const j = extractJson<AgentReply>(text);
    return {reply: typeof j.reply === 'string' ? j.reply : '', actions: Array.isArray(j.actions) ? j.actions : []};
  } catch {
    return {reply: text.trim(), actions: []};
  }
}

export interface AgentTurn {
  reply: string;
  plan: Plan;
  changes: Change[];
  /** 套用的全部改动，方案在等待期间被改了时可以重新套 */
  actions: unknown[];
  before: Checkup;
  after: Checkup;
  fixed: Issue[];
  added: Issue[];
  /** 没完全解决、但从要改变成了建议调 */
  eased: Issue[];
  rounds: number;
}

export type AgentStage = 'thinking' | 'checking' | 'retrying';

/**
 * 跑一轮：问模型 → 套用改动 → 体检对比；改动带出新问题时再问一轮（最多两轮）。
 */
export async function runAgent(opts: {
  settings: AiSettings;
  plan: Plan;
  history: string;
  ask: string;
  signal?: AbortSignal;
  onStage?: (s: AgentStage) => void;
}): Promise<AgentTurn> {
  const {settings, history, ask, signal, onStage} = opts;
  const before = runCheckup(opts.plan);
  let plan = opts.plan;
  let check = before;
  const actions: unknown[] = [];
  const replies: string[] = [];
  let rounds = 0;
  let prompt = history ? `之前的对话：\n${history}\n\n用户：${ask}` : `用户：${ask}`;

  for (; rounds < 2; ) {
    onStage?.(rounds === 0 ? 'thinking' : 'retrying');
    const text = await complete(settings, {
      system: `${AGENT_RULES}\n\n${agentContext(plan, check)}`,
      text: prompt,
      maxTokens: 3000,
      signal,
    });
    rounds++;
    const parsed = parseReply(text);
    if (parsed.reply) replies.push(parsed.reply);
    const applied = applyActions(plan, parsed.actions);
    if (!applied.changes.length) break;
    onStage?.('checking');
    const next = runCheckup(applied.plan);
    const dd = diffCheckups(check, next);
    const added = [...dd.added, ...dd.worsened];
    plan = applied.plan;
    actions.push(...parsed.actions);
    check = next;
    if (!added.length || rounds >= 2) break;
    prompt = `你刚才的改动已经套用到方案上（上面是改后的方案）。改完体检多了这些问题：\n${added
      .map((i) => `- ${i.title}（${i.id}）`)
      .join('\n')}\n请在改后的方案上再给一组 actions 把它们修掉；修不了就给空数组，并在 reply 里说明原因。`;
  }
  const d = diffCheckups(before, check);
  return {reply: replies.join('\n\n') || '我没想好怎么改，换个说法试试？', plan, changes: diffFurniture(opts.plan, plan), actions, before, after: check, fixed: d.fixed, added: [...d.added, ...d.worsened], eased: d.eased, rounds};
}

/** 前后两版方案的家具差别，按最终结果说（改了两轮又改回去的不算） */
export function diffFurniture(before: Plan, after: Plan): Change[] {
  const old = new Map(before.furniture.map((f) => [f.id, f]));
  const out: Change[] = [];
  for (const f of after.furniture) {
    const o = old.get(f.id);
    if (!o) out.push({op: 'add', id: f.id, text: `加了${f.name}`, at: [f.cx, f.cy]});
    else if (o.cx !== f.cx || o.cy !== f.cy || o.rot !== f.rot || o.w !== f.w || o.d !== f.d)
      out.push({op: 'update', id: f.id, text: describeUpdate(o, f), at: [f.cx, f.cy]});
  }
  const now = new Set(after.furniture.map((f) => f.id));
  for (const o of before.furniture) if (!now.has(o.id)) out.push({op: 'remove', id: o.id, text: `拿走了${o.name}`, at: [o.cx, o.cy]});
  return out;
}

/** 方案在等模型时被改过：把同一组改动套到最新的方案上 */
export function reapply(plan: Plan, actions: unknown[]): Plan {
  return applyActions(plan, actions).plan;
}

