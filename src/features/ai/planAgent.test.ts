import {describe, expect, it, vi} from 'vitest';
import {createSamplePlan} from '../../model/samplePlan';
import {agentContext, applyActions, parseReply, runAgent} from './planAgent';
import {runCheckup} from '../../model/checkup';
import type {AiSettings} from './settings';

const replies: string[] = [];
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  complete: vi.fn(async () => replies.shift() ?? '{"reply":"好","actions":[]}'),
}));

const settings: AiSettings = {protocol: 'openai', baseUrl: 'http://x', apiKey: 'k', model: 'm', remember: false, thinking: false};

describe('AI 改方案', () => {
  const plan = createSamplePlan();
  const desk = plan.furniture.find((f) => f.type === 'desk' && f.cx < 3000)!;

  it('套用改动：认识的改、不认识的跳过', () => {
    const r = applyActions(plan, [
      {op: 'update', id: desk.id, cx: 3000, cy: 3070, rot: 180},
      {op: 'update', id: 'nope', cx: 1},
      {op: 'add', type: 'bookshelf', cx: 8000, cy: 9000},
      {op: 'add', type: 'spaceship', cx: 8000, cy: 9000},
      {op: 'remove', id: plan.furniture[0]!.id},
      {op: 'update', id: desk.id, cx: 1e9},
      'garbage',
    ]);
    expect(r.changes.map((c) => c.op)).toEqual(['update', 'add', 'remove']);
    expect(r.skipped).toBe(4);
    expect(r.plan.furniture.find((f) => f.id === desk.id)).toMatchObject({cx: 3000, cy: 3070, rot: 180});
    expect(r.plan.furniture.some((f) => f.type === 'bookshelf' && f.cx === 8000)).toBe(true);
    expect(plan.furniture.find((f) => f.id === desk.id)!.cx).toBe(desk.cx);
  });

  it('回复里取 JSON，取不到就当文字', () => {
    expect(parseReply('好的\n```json\n{"reply":"挪了","actions":[{"op":"remove","id":"a"}]}\n```').actions).toHaveLength(1);
    expect(parseReply('沙发和茶几隔 450 正好')).toEqual({reply: '沙发和茶几隔 450 正好', actions: []});
  });

  it('上下文里有家具 id、房间和体检问题', () => {
    const ctx = agentContext(plan, runCheckup(plan));
    expect(ctx).toContain(desk.id);
    expect(ctx).toContain('小孩房');
    expect(ctx).toContain('床尾');
  });

  it('改完自动体检；带出新问题时再改一轮', async () => {
    const shelf = plan.furniture.find((f) => f.type === 'bookshelf' && f.cx < 4580)!;
    // 第一轮：书桌挪到靠墙，但书架挪进了门扇扫过的地方
    replies.push(
      JSON.stringify({
        reply: '书桌挪到窗边了',
        actions: [
          {op: 'update', id: desk.id, cx: 3000, cy: 3070, rot: 180},
          {op: 'update', id: shelf.id, cx: 4200, cy: 3000},
        ],
      }),
      JSON.stringify({reply: '书架放回原处', actions: [{op: 'update', id: shelf.id, cx: shelf.cx, cy: shelf.cy}]}),
    );
    const stages: string[] = [];
    const turn = await runAgent({settings, plan, history: '', ask: '小孩房床尾太挤', onStage: (s) => stages.push(s)});
    expect(turn.rounds).toBe(2);
    expect(stages).toEqual(['thinking', 'checking', 'retrying', 'checking']);
    expect(turn.fixed.some((i) => i.id === `bed:${plan.furniture.find((f) => f.type === 'bed' && f.w === 1200)!.id}:foot`)).toBe(true);
    expect(turn.added.some((i) => i.rule === 'door')).toBe(false);
    // 书架挪过去又挪回来，最后不算改动
    expect(turn.changes.map((c) => c.id)).toEqual([desk.id]);
    expect(turn.reply).toContain('书架放回');
  });
});
