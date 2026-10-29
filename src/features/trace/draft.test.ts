import {describe, expect, it} from 'vitest';
import {
  attachOpenings,
  dist,
  draftFromRecognized,
  draftToPlan,
  emptyDraft,
  moveVertex,
  needsReview,
  openingOnWall,
  projectOnSegment,
  scaleFromDimensions,
  snapPoint,
  tidyWalls,
  type Draft,
  type DraftWall,
  type P,
} from './draft';
import {createSamplePlan} from '../../model/samplePlan';
import type {RecognizedPlan} from '../ai/recognize';

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

/** 可复现的伪随机数，模拟 AI 坐标的误差：返回 [-amp, amp] 之间的值 */
function noise(seed: number) {
  let s = seed;
  return (amp: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 * amp - amp;
  };
}

describe('规整 AI 识别的墙', () => {
  // 示例户型（毫米）当标准答案，换成 1 像素 = 10 mm 的图（墙厚 24 像素），再给每个端点加上随机误差
  for (const [amp, seed] of [[3, 7], [3, 11], [3, 23], [6, 7], [6, 11], [6, 23]] as const) {
    it(`示例户型加上 ±${amp} 像素误差（第 ${seed} 组）：横竖的墙全部拉正，位置不跑偏，没有墙缩成点`, () => {
      const k = 0.1;
      const px = (p: readonly [number, number]): P => [(p[0] + 400) * k, (p[1] + 400) * k];
      const truth = createSamplePlan().walls.map((w) => ({a: px(w.a), b: px(w.b), thickness: w.thickness * k}));
      const rand = noise(seed);
      const shake = (p: P): [number, number] => [p[0] + rand(amp), p[1] + rand(amp)];
      const recognized: RecognizedPlan = {
        walls: truth.map((w) => ({a: shake(w.a), b: shake(w.b), thickness: w.thickness})),
        openings: [],
        rooms: [],
        dimensions: [],
      };
      const walls = draftFromRecognized(recognized).walls;

      expect(walls).toHaveLength(truth.length);
      walls.forEach((w, i) => {
        const t = truth[i]!;
        // 垂直于墙的方向：拉正后的位置离真实位置不超过误差加上 1/4 墙厚（对齐同一条线时会挪一点）
        const q = t.a[1] === t.b[1] ? 1 : 0;
        expect(w.a[q], `第 ${i} 面墙应是${q ? '水平' : '竖直'}的`).toBe(w.b[q]);
        expect(Math.abs(w.a[q]! - t.a[q]!)).toBeLessThanOrEqual(amp + 6);
        expect(dist(w.a, w.b), `第 ${i} 面墙不该缩成点`).toBeGreaterThan(1);
      });
    });
  }

  it('墙角接上：歪一点、差一点的四面墙变成闭合的矩形', () => {
    const [top, right, bottom, left] = tidyWalls(
      [wall('top', [2, 1], [98, -1]), wall('right', [101, 3], [99, 78]), wall('bottom', [97, 81], [3, 79]), wall('left', [-1, 77], [1, 2])],
      10,
    );
    expect(top!.a).toEqual([0, 0]);
    expect(top!.b).toEqual([100, 0]);
    expect(right!.a).toEqual([100, 0]);
    expect(right!.b).toEqual([100, 80]);
    expect(bottom!.a).toEqual([100, 80]);
    expect(bottom!.b).toEqual([0, 80]);
    expect(left!.a).toEqual([0, 80]);
    expect(left!.b).toEqual([0, 0]);
  });

  it('丁字接头：差一点没碰到的墙伸到对面墙的中心线上', () => {
    const [, inner] = tidyWalls([wall('top', [0, 0], [100, 0]), wall('inner', [50, 6], [50, 80])], 10);
    expect(inner!.a).toEqual([50, 0]);
  });

  it('冲过头的墙收回到对面墙的中心线上', () => {
    const [, inner] = tidyWalls([wall('top', [0, 0], [100, 0]), wall('inner', [50, -5], [50, 80])], 10);
    expect(inner!.a).toEqual([50, 0]);
  });

  it('同一条线上断开的两段墙对齐成一条线', () => {
    const [l, r] = tidyWalls([wall('l', [0, 50], [48, 50]), wall('r', [52, 52], [100, 52])], 10);
    expect(l!.a[1]).toBe(r!.a[1]);
    expect(l!.a[1]).toBe(51);
  });

  it('离得远的平行墙不受影响', () => {
    const [l, r] = tidyWalls([wall('l', [0, 50], [40, 50]), wall('r', [200, 52], [300, 52])], 10);
    expect(l!.a[1]).toBe(50);
    expect(r!.a[1]).toBe(52);
  });

  it('斜墙原样保留', () => {
    const diag = wall('d', [0, 0], [100, 60]);
    expect(tidyWalls([diag], 10)[0]).toEqual(diag);
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
