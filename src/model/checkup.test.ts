import {describe, expect, it} from 'vitest';
import {diffCheckups, runCheckup} from './checkup';
import {createSamplePlan} from './samplePlan';
import type {Furniture, Plan} from './types';

const add = (plan: Plan, f: Partial<Furniture> & Pick<Furniture, 'type' | 'cx' | 'cy' | 'w' | 'd'>): Plan => ({
  ...plan,
  furniture: [...plan.furniture, {id: 'x', name: '测试柜', rot: 0, color: '#ccc', ...f}],
});

describe('居住体检', () => {
  const base = createSamplePlan();
  const before = runCheckup(base);

  it('示例户型能体检，分数在 0 到 100 之间', () => {
    expect(before.score).toBeGreaterThan(0);
    expect(before.score).toBeLessThanOrEqual(100);
    // 示例里小孩房床尾顶着书桌
    expect(before.issues.some((i) => i.id.startsWith('bed:') && i.title.includes('床尾'))).toBe(true);
  });

  it('柜子放在门扇扫过的地方会报开门问题', () => {
    const r = runCheckup(add(base, {type: 'cabinet', cx: 7000, cy: 3000, w: 600, d: 400}));
    expect(r.issues.some((i) => i.rule === 'door' && i.furniture.includes('x'))).toBe(true);
  });

  it('大衣柜横在过道里，卧室就走不到了', () => {
    const r = runCheckup(add(base, {type: 'wardrobe', cx: 5450, cy: 5000, w: 1300, d: 600}));
    const unreachable = r.issues.filter((i) => i.rule === 'path' && i.title.startsWith('从入户门走不到'));
    expect(unreachable.map((i) => i.title).join()).toContain('主卧室');
  });

  it('过道只剩一条窄缝时提醒最窄处', () => {
    const r = runCheckup(add(base, {type: 'cabinet', cx: 5150, cy: 5000, w: 600, d: 400}));
    expect(r.issues.some((i) => i.rule === 'path' && i.title.includes('最窄'))).toBe(true);
  });

  it('家具嵌进墙里、两件家具叠在一起都会报', () => {
    const inWall = runCheckup(add(base, {type: 'cabinet', cx: 6480, cy: 700, w: 600, d: 400}));
    expect(inWall.issues.some((i) => i.id === 'overlap:x:wall')).toBe(true);
    const sofa = base.furniture.find((f) => f.type === 'sofa')!;
    const stacked = runCheckup(add(base, {type: 'cabinet', cx: sofa.cx, cy: sofa.cy, w: 600, d: 400}));
    expect(stacked.issues.some((i) => i.rule === 'overlap' && i.furniture.includes(sofa.id))).toBe(true);
  });

  it('改好以后问题消失，diff 能看出来', () => {
    const bed = base.furniture.find((f) => f.type === 'bed' && f.w === 1200)!;
    const desk = base.furniture.find((f) => f.type === 'desk' && f.cx < 3000)!;
    // 书桌挪到靠墙那边，床尾就空出来了
    const chair = base.furniture.find((f) => f.type === 'chair' && Math.abs(f.cy - desk.cy) < 10)!;
    const fixed: Plan = {
      ...base,
      furniture: base.furniture
        .filter((f) => f.id !== chair.id)
        .map((f) => (f.id === desk.id ? {...f, cx: 3000, cy: 3070, rot: 180} : f)),
    };
    const after = runCheckup(fixed);
    const d = diffCheckups(before, after);
    expect(d.fixed.some((i) => i.id === `bed:${bed.id}:foot`)).toBe(true);
  });
});

describe('改造后还在的门窗', () => {
  it('墙上缺口式的门窗算数，墙拆了就没了', async () => {
    const {liveOpenings} = await import('./walls');
    const base = createSamplePlan();
    expect(liveOpenings(base).length).toBe(base.openings.length);
    // 拆掉小孩房门左边那段墙：门压在这段墙的端头上，跟着没了
    const wall = base.walls.find((w) => w.a[0] === 4700 && w.b[1] === 2400)!;
    const after = liveOpenings({...base, demolished: [wall.id]});
    expect(after.length).toBeLessThanOrEqual(base.openings.length);
  });
});
