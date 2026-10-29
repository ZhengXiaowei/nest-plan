import {describe, expect, it} from 'vitest';
import {createSamplePlan} from '../../model/samplePlan';
import {decodeData, encodeData, linkFor, mergeReply, parsePack, parseReply, readVoteLink, tally, type SharePack} from './share';

const plan = createSamplePlan();
const pack: SharePack = {
  v: 1,
  id: 's1',
  from: '小维',
  question: '客厅怎么摆？',
  at: 1,
  candidates: [
    {id: 'a', name: '方案 A', plan, savedAt: 1},
    {id: 'b', name: '方案 B', plan: {...plan, furniture: plan.furniture.slice(0, 10)}, savedAt: 2},
    {id: 'c', name: '方案 C', plan: {...plan, furniture: plan.furniture.slice(5)}, savedAt: 3},
  ],
};

describe('家人一起选', () => {
  it('三个方案压进一条链接，还原后一样', async () => {
    const data = await encodeData(pack);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    // 三份方案大部分相同，压缩后不到 8 KB
    expect(data.length).toBeLessThan(8000);
    const back = parsePack(await decodeData(data));
    expect(back.candidates.map((c) => c.name)).toEqual(['方案 A', '方案 B', '方案 C']);
    expect(back.candidates[0]!.plan.furniture).toHaveLength(plan.furniture.length);
  });

  it('链接里的东西当不可信：坏数据报错，怪颜色和超长文字被清掉', async () => {
    await expect(decodeData('not-valid')).rejects.toThrow();
    expect(() => parsePack({v: 1, candidates: []})).toThrow();
    const bad = parsePack({
      ...pack,
      candidates: [{id: 'x', name: 'x'.repeat(500), plan: {...plan, furniture: [{...plan.furniture[0]!, color: 'url(javascript:alert(1))'}]}}],
    });
    expect(bad.candidates[0]!.name.length).toBe(20);
    expect(bad.candidates[0]!.plan.furniture[0]!.color).toBe('#E8DCCB');
    expect(() => parseReply({v: 1})).toThrow();
  });

  it('回复链接很短，能认出来，同一个人以最后一次为准', async () => {
    const reply = {v: 1 as const, share: 's1', author: '妈妈', pick: 'b', pins: [{id: 'p', candidate: 'b', at: [1000, 2000] as [number, number], text: '这里放鞋柜'}], at: 5};
    const url = linkFor('reply', await encodeData(reply), 'https://example.com/');
    expect(url.length).toBeLessThan(400);
    const link = readVoteLink(`看看这个 ${url} 谢谢`)!;
    expect(link.kind).toBe('reply');
    const r = parseReply(await decodeData(link.data));
    expect(r.pins[0]!.text).toBe('这里放鞋柜');
    const replies = mergeReply(mergeReply([], r), {...r, pick: 'a', at: 9});
    expect(replies).toHaveLength(1);
    expect(tally(pack, [...replies, {...r, author: '爸爸', pick: 'a'}]).get('a')).toEqual(['妈妈', '爸爸']);
  });
});
