import {describe, expect, it} from 'vitest';
import {
  attachOpenings,
  draftToPlan,
  emptyDraft,
  moveVertex,
  needsReview,
  openingOnWall,
  projectOnSegment,
  scaleFromDimensions,
  snapPoint,
  type Draft,
  type DraftWall,
} from './draft';

const wall = (id: string, a: [number, number], b: [number, number], thickness = 6): DraftWall => ({
  id,
  a,
  b,
  thickness,
  kind: 'partition',
  source: 'manual',
});

const box = (): Draft => ({
  ...emptyDraft(),
  walls: [
    wall('top', [0, 0], [100, 0]),
    wall('right', [100, 0], [100, 80]),
    wall('bottom', [100, 80], [0, 80]),
    wall('left', [0, 80], [0, 0]),
  ],
});

describe('projectOnSegment', () => {
  it('投影并夹在线段内', () => {
    expect(projectOnSegment([50, 10], [0, 0], [100, 0])).toMatchObject({t: 0.5, point: [50, 0], dist: 10});
    expect(projectOnSegment([-20, 0], [0, 0], [100, 0]).t).toBe(0);
  });
});

describe('snapPoint', () => {
  it('优先吸附到已有端点', () => {
    expect(snapPoint(box(), [97, 3], {radius: 6})).toMatchObject({p: [100, 0], kind: 'endpoint'});
  });

  it('接近水平时锁成水平线', () => {
    const r = snapPoint(emptyDraft(), [60, 205], {radius: 4, from: [0, 200]});
    expect(r).toMatchObject({p: [60, 200], kind: 'axis'});
  });

  it('按住 Shift 时不锁轴', () => {
    const r = snapPoint(emptyDraft(), [60, 205], {radius: 4, from: [0, 200], free: true});
    expect(r.p).toEqual([60, 205]);
  });

  it('锁轴后贴到已有墙上（T 形接头）', () => {
    const r = snapPoint(box(), [53, 83], {radius: 5, from: [52, 120]});
    expect(r.kind).toBe('wall');
    expect(r.p).toEqual([52, 80]);
  });

  it('与已有端点对齐', () => {
    const r = snapPoint(box(), [203, 47], {radius: 5});
    expect(r.guides.x).toBeUndefined();
    const r2 = snapPoint(box(), [98, 140], {radius: 5});
    expect(r2.p[0]).toBe(100);
    expect(r2.guides.x).toBe(100);
  });
});

describe('门窗', () => {
  it('放在墙上并收回到墙内', () => {
    const o = openingOnWall(wall('w', [0, 0], [100, 0]), [5, 2], 30, 'door');
    expect(o.a).toEqual([0, 0]);
    expect(o.b).toEqual([30, 0]);
    expect(o.wallId).toBe('w');
  });

  it('AI 识别的门窗贴到最近的墙', () => {
    const d = box();
    d.openings.push({id: 'o', kind: 'window', wallId: null, a: [20, 3], b: [40, 3], source: 'ai'});
    const out = attachOpenings(d, 9);
    expect(out.openings[0]).toMatchObject({wallId: 'top', a: [20, 0], b: [40, 0]});
  });

  it('拖墙角时相连的墙一起动，门窗跟着贴回', () => {
    const d = attachOpenings(
      {...box(), openings: [{id: 'o', kind: 'window', wallId: 'top', a: [20, 0], b: [40, 0], source: 'manual'}]},
      0,
    );
    const moved = moveVertex(moveVertex(d, [0, 0], [0, 10]), [100, 0], [100, 10]);
    expect(moved.walls.find((w) => w.id === 'left')!.b).toEqual([0, 10]);
    expect(moved.openings[0]!.a).toEqual([20, 10]);
  });
});

describe('标定与换算', () => {
  it('尺寸标注取中位数', () => {
    const d: Draft = {
      ...emptyDraft(),
      dimensions: [
        {a: [0, 0], b: [100, 0], mm: 1000},
        {a: [0, 0], b: [100, 0], mm: 1100},
        {a: [0, 0], b: [100, 0], mm: 9000},
      ],
    };
    expect(scaleFromDimensions(d)).toBe(11);
  });

  it('像素草稿换算成毫米户型，平移到原点', () => {
    const d = box();
    d.walls = d.walls.map((w) => ({...w, a: [w.a[0] + 50, w.a[1] + 20], b: [w.b[0] + 50, w.b[1] + 20]}));
    d.openings.push({id: 'o', kind: 'door', wallId: 'top', a: [70, 20], b: [79, 20], source: 'manual'});
    d.rooms.push({id: 'r', name: '主卧', poly: [[50, 20], [150, 20], [150, 100], [50, 100]], source: 'manual'});
    const plan = draftToPlan(d, 40);
    // 手描隔墙按常见厚度 120，门跟墙一样厚
    expect(plan.walls[0]).toMatchObject({a: [0, 0], b: [4000, 0], thickness: 120});
    expect(plan.openings[0]).toMatchObject({kind: 'door', thickness: 120, a: [800, 0], b: [1160, 0]});
    expect(plan.openings[0]!.swing?.leaf).toBe(360);
    expect(plan.rooms[0]).toMatchObject({material: 'wood', poly: [[0, 0], [4000, 0], [4000, 3200], [0, 3200]]});
  });
});

describe('手放门窗', () => {
  it('按记下的真实宽度重新摆，中点不变', () => {
    const d = box();
    // 放的时候比例估错了：图上只占 2 像素
    d.openings.push({id: 'o', kind: 'door', wallId: 'top', a: [49, 0], b: [51, 0], widthMm: 900, source: 'manual'});
    const plan = draftToPlan(d, 40);
    expect(plan.openings[0]).toMatchObject({a: [1550, 0], b: [2450, 0]});
    expect(plan.openings[0]!.swing?.leaf).toBe(900);
  });
});

describe('墙厚', () => {
  it('识别出来的墙按图上厚度换算，手描的墙按类型给默认值', () => {
    const d = box();
    d.walls[0] = {...d.walls[0]!, source: 'ai', thickness: 6};
    d.walls[1] = {...d.walls[1]!, kind: 'exterior'};
    const plan = draftToPlan(d, 40);
    expect(plan.walls.map((w) => w.thickness).slice(0, 3)).toEqual([240, 240, 120]);
  });
});

describe('校对', () => {
  it('低置信度且未确认的需要校对', () => {
    expect(needsReview({confidence: 0.4})).toBe(true);
    expect(needsReview({confidence: 0.4, confirmed: true})).toBe(false);
    expect(needsReview({confidence: 0.9})).toBe(false);
    expect(needsReview({})).toBe(false);
  });
});
