import type {Furniture, Plan} from '../../model/types';
import {
  checkLayout,
  footprint,
  furnitureInRoom,
  layoutRoomKind,
  placeItems,
  roomInfo,
  type Face,
  type FaceOpening,
  type LayoutIssue,
  type LayoutItem,
  type LayoutRoomKind,
  type RoomInfo,
} from '../../model/autolayout';
import {CATALOG} from '../../model/catalog';
import {FRONT_NEED} from '../../model/checkup';
import {roomArea} from '../../model/geometry';
import {AiError, complete, extractJson} from './client';
import type {AiSettings} from './settings';

/**
 * AI 一键布置房间：把房间的墙面、门窗、家具库和用户需求交给 AI，让它只给「放什么、靠哪面墙」的清单，
 * 坐标由 model/autolayout 算。摆出来有问题就把上一版和问题清单交回 AI 修正一次，最多两轮。
 */

export interface RoomLayoutResult {
  /** 新放的家具（还没写进方案） */
  furniture: Furniture[];
  note: string;
  /** 最终还剩的问题 */
  issues: LayoutIssue[];
  /** 没放上的家具和原因 */
  skipped: string[];
  /** 调用了几次 AI */
  rounds: number;
}

const CATALOG_NAME: Record<string, string> = {wardrobe: '衣柜', dresser: '梳妆台', desk: '书桌', bookshelf: '书架', cabinet: '柜子'};

/** 留空要求直接取居住体检的数值，AI 布置和体检用同一套标准 */
const CLEARANCE = `- 留空：${['wardrobe', 'dresser', 'desk', 'bookshelf', 'cabinet']
  .map((t) => `${CATALOG_NAME[t] ?? t}前 ${FRONT_NEED[t]!.need} mm`)
  .join('，')}；床边和床尾留 500 mm，双人床两侧都要能下床；餐桌坐人的一边离墙 600 mm 以上；不要摆得太满。`;

const SYSTEM = `你是室内设计师，给一个房间摆家具。只输出一个 JSON 对象，不要解释。
你只决定放什么、靠哪面墙、怎么对齐；精确坐标由程序计算，程序也会尽量自动避开门口和窗。
格式：{"note": "一两句中文设计说明", "items": [每件家具一项]}
每件家具选一种放法：
1. 靠墙：{"id": "自取的短名", "item": "家具库里的名字", "wall": "墙编号", "align": "start" | "center" | "end", "offset": 离对齐端多少 mm, "gap": 离墙多少 mm, "w": 宽度 mm}
   家具的背面（床头、沙发靠背、柜子背板）贴着这面墙。start 是这面墙在图纸上靠左或靠上的一端，end 是靠右或靠下的一端。offset、gap、w 可以不写；柜子类可以用 w 加宽。
2. 挨着另一件：{"id", "item", "beside": "那一件的 id", "side": "start" | "end", "gap": mm}——朝向相同、背面对齐，例如床头柜放在床的两侧。
3. 在另一件正前方：{"id", "item", "front": "那一件的 id", "gap": mm}——面朝那一件，例如书桌前的椅子（gap 可以为负，塞进桌下）、沙发前的茶几（gap 约 400）。
4. 房间正中：{"id", "item", "center": true, "rot": 0 或 90}——例如餐桌、地毯。
要求：
- 家具名只能用家具库里的，原样照抄。
- 门扇开启的范围和门口要空出来；高过窗台的家具（衣柜、书架）不要挡窗。
${CLEARANCE}
- 设计说明里用「图纸上方的墙」「靠窗」这类说法，不要说东南西北。`;

const KIND_NAME: Record<LayoutRoomKind, string> = {bedroom: '卧室', living: '客厅', dining: '餐厅', study: '书房'};
const SIDE_NAME: Record<Face['side'], string> = {top: '上方', right: '右侧', bottom: '下方', left: '左侧'};
const r = Math.round;

function describeOpening(o: FaceOpening): string {
  const at = `${r(o.from)}~${r(o.to)} mm 是`;
  switch (o.kind) {
    case 'window':
      return `${at}${o.name}（窗台高 ${r(o.sill)} mm）`;
    case 'door':
      return o.swingsIn
        ? `${at}门「${o.name}」（向房间里开，门扇扫过约 ${r(o.leaf ?? 900)} × ${r(o.leaf ?? 900)} mm）`
        : `${at}门「${o.name}」（向外开，门口要留通道）`;
    case 'slidingDoor':
      return `${at}推拉门「${o.name}」（门口要留通道）`;
    default:
      return `${at}${o.name}（没有墙，要留通道）`;
  }
}

/** 保留的家具贴着哪面墙 */
function whereIs(info: RoomInfo, f: Furniture): string {
  const [x0, y0, x1, y1] = footprint(f);
  for (const face of info.faces) {
    const line = face.side === 'top' || face.side === 'bottom' ? face.start[1] : face.start[0];
    const gap = face.side === 'top' ? y0 - line : face.side === 'bottom' ? line - y1 : face.side === 'left' ? x0 - line : line - x1;
    if (gap >= -50 && gap <= 150) return `贴着 ${face.id} 墙`;
  }
  return '在房间中间';
}

function describeRoom(info: RoomInfo, kind: LayoutRoomKind, kept: readonly Furniture[], request?: string): string {
  const xs = info.room.poly.map((p) => p[0]);
  const ys = info.room.poly.map((p) => p[1]);
  const lines = [
    `房间：${info.room.name}（${KIND_NAME[kind]}），约 ${roomArea(info.room).toFixed(1)} ㎡，外接 ${r(Math.max(...xs) - Math.min(...xs))} × ${r(Math.max(...ys) - Math.min(...ys))} mm。`,
    '墙面（上下左右指图纸方向；区间从这面墙的 start 端量起）：',
    ...info.faces.map((f) => `- ${f.id}：${SIDE_NAME[f.side]}的墙，长 ${r(f.len)} mm${f.openings.length ? '；' + f.openings.map(describeOpening).join('；') : ''}。`),
    kept.length
      ? `已有家具（保留，不要再放一样的，也不要压到它们）：\n${kept.map((f) => `- ${f.name}（${r(f.w)} × ${r(f.d)} mm），${whereIs(info, f)}`).join('\n')}`
      : '已有家具：无。',
    `需求：${request?.trim() || '没有特别要求，按这类房间的常见做法布置。'}`,
    '家具库（名字 宽×深 mm）：',
    ...CATALOG.map((g) => `${g.category}：${g.items.map((it) => `${it.name} ${it.w}×${it.d}`).join('、')}`),
  ];
  return lines.join('\n');
}

interface Layout {
  note: string;
  items: LayoutItem[];
}

const NUMERIC = ['offset', 'gap', 'w', 'rot'] as const;

/** 解析 AI 的清单；数字写成字符串也认 */
function parseLayout(text: string): Layout {
  const raw = extractJson<{note?: unknown; items?: unknown}>(text);
  if (!Array.isArray(raw.items) || !raw.items.length) throw new AiError('AI 没有给出布置清单，换个说法再试一次。');
  const items = raw.items
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, i) => {
      const it: Record<string, unknown> = {...x, id: String(x.id ?? `item${i + 1}`), item: String(x.item ?? '')};
      for (const k of NUMERIC) if (typeof it[k] === 'string' && it[k] !== '' && Number.isFinite(Number(it[k]))) it[k] = Number(it[k]);
      return it as unknown as LayoutItem;
    });
  return {note: typeof raw.note === 'string' ? raw.note : '', items};
}

export async function layoutRoom(
  settings: AiSettings,
  plan: Plan,
  roomId: string,
  opts: {request?: string; keepExisting: boolean; signal?: AbortSignal},
): Promise<RoomLayoutResult> {
  const info = roomInfo(plan, roomId);
  if (!info) throw new AiError('找不到这个房间。');
  const kind = layoutRoomKind(info.room.name);
  if (!kind) throw new AiError(`「${info.room.name}」这类房间暂不支持 AI 布置。`);
  const kept = opts.keepExisting ? furnitureInRoom(plan, roomId) : [];
  const context = describeRoom(info, kind, kept, opts.request);

  const ask = async (text: string) => parseLayout(await complete(settings, {system: SYSTEM, text, maxTokens: 3000, signal: opts.signal}));
  const solve = (layout: Layout) => {
    const {placed, skipped} = placeItems(info, layout.items, kept);
    const furniture = placed.map((p) => p.f);
    return {layout, furniture, skipped, issues: checkLayout(plan, info, [...kept, ...furniture])};
  };
  const result = (s: ReturnType<typeof solve>, rounds: number): RoomLayoutResult => ({
    furniture: s.furniture,
    note: s.layout.note,
    issues: s.issues,
    skipped: s.skipped,
    rounds,
  });

  const first = solve(await ask(context));
  if (!first.issues.length && !first.skipped.length) return result(first, 1);

  const problems = [...first.issues.map((i) => (i.advice ? `${i.message}（${i.advice}）` : i.message)), ...first.skipped];
  const repair = `${context}

上一版布置：
\`\`\`json
${JSON.stringify(first.layout)}
\`\`\`
程序按上一版摆出来有这些问题：
${problems.map((p) => `- ${p}`).join('\n')}
请修正后输出完整的新 JSON（格式同上）。`;
  try {
    return result(solve(await ask(repair)), 2);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const why = e instanceof Error ? e.message : String(e);
    return {...result(first, 1), skipped: [...first.skipped, `AI 修正时出错（${why}），用的是第一版`]};
  }
}
