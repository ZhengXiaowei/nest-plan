import {describe, expect, it} from 'vitest';
import type {Furniture, Opening, Plan, Wall} from './types';
import {activeWalls, pushOut, renovationStats, snapFurniture, snapMeasurePoint, wallPieces, wallRects} from './walls';
import {createSamplePlan} from './samplePlan';
import {normalizePlan, usePlanStore} from '../store/planStore';

const wall = (id: string, a: [number, number], b: [number, number], kind: Wall['kind'] = 'partition'): Wall => ({id, a, b, thickness: 200, kind});
const door = (a: [number, number], b: [number, number]): Opening => ({id: 'd', kind: 'door', a, b, thickness: 200});
const sofa = (cx: number, cy: number): Furniture => ({id: 'f', type: 'sofa', name: '沙发', cx, cy, w: 2000, d: 900, rot: 0, color: '#999'});

const plan = (walls: Wall[], extra: Partial<Plan> = {}): Plan => ({
  version: 1,
  id: 'p',
  name: 't',
  wallHeight: 2800,
  walls,
  openings: [],
  rooms: [],
  furniture: [],
  demolished: [],
  measures: [],
  source: {kind: 'blank'},
  ...extra,
});

describe('墙在门窗处断开', () => {
  it('中间开门，墙分成两段', () => {
    expect(wallPieces(wall('w', [0, 0], [4000, 0]), [door([1000, 0], [1900, 0])])).toEqual([
      [[0, 0], [1000, 0]],
      [[1900, 0], [4000, 0]],
    ]);
  });
  it('门窗贴着墙端点时不留碎段，别的墙上的门不影响', () => {
    const w = wall('w', [0, 0], [0, 3000]);
    expect(wallPieces(w, [door([0, 0], [0, 900]), door([1000, 0], [1900, 0])])).toEqual([[[0, 900], [0, 3000]]]);
  });
});

describe('拆改', () => {
  it('拆掉的墙不算有效墙，统计按米', () => {
    const p = plan([wall('a', [0, 0], [3000, 0]), {...wall('b', [0, 0], [0, 2000]), added: true}], {demolished: ['a']});
    expect(activeWalls(p).map((w) => w.id)).toEqual(['b']);
    expect(renovationStats(p)).toEqual({demolishedM: 3, addedM: 2});
  });

  it('承重墙和外墙不能拆，非承重墙可拆可恢复，新砌的墙直接删', () => {
    usePlanStore
      .getState()
      .loadPlan(plan([wall('b', [0, 0], [1000, 0], 'bearing'), wall('e', [0, 0], [0, 1000], 'exterior'), wall('n', [0, 500], [1000, 500]), {...wall('x', [500, 0], [500, 1000]), added: true}]));
    const s = usePlanStore.getState();
    expect(s.toggleDemolish('b')).toBe('bearing');
    expect(s.toggleDemolish('e')).toBe('exterior');
    expect(s.toggleDemolish('n')).toBe('demolished');
    expect(usePlanStore.getState().plan.demolished).toEqual(['n']);
    expect(s.toggleDemolish('n')).toBe('restored');
    expect(s.toggleDemolish('x')).toBe('removed');
    expect(usePlanStore.getState().plan.walls.map((w) => w.id)).toEqual(['b', 'e', 'n']);
    s.undo();
    expect(usePlanStore.getState().plan.walls).toHaveLength(4);
  });

  it('旧存档补齐测量和拆墙字段', () => {
    const old = {...plan([])} as Partial<Plan>;
    delete old.measures;
    expect(normalizePlan(old as Plan).measures).toEqual([]);
  });
});

describe('吸附', () => {
  const rects = wallRects(plan([wall('top', [0, 0], [5000, 0]), wall('left', [0, 0], [0, 4000]), wall('diag', [0, 0], [3000, 3000])]));

  it('斜墙不参与吸附', () => {
    expect(rects).toHaveLength(2);
  });

  it('家具靠近墙面时贴上去', () => {
    // 墙内侧面 y=100，沙发半深 450，中心应在 550
    expect(snapFurniture(rects, sofa(2000, 590), 2000, 590, 60)).toEqual([2000, 550]);
    // 离得远就只按 10mm 网格取整
    expect(snapFurniture(rects, sofa(2000, 1503), 2000, 1503, 60)).toEqual([2000, 1500]);
  });

  it('放进墙里的家具被推出来', () => {
    expect(pushOut(rects, sofa(2000, 200))).toEqual([2000, 550]);
  });

  it('测量点贴墙面，Shift 锁水平', () => {
    expect(snapMeasurePoint(rects, [1203, 130], 50, null, false)).toEqual([1200, 100]);
    expect(snapMeasurePoint(rects, [3000, 1900], 50, [1000, 2000], true)).toEqual([3000, 2000]);
  });
});

describe('示例户型', () => {
  it('带测量字段，拆墙列表为空', () => {
    const p = createSamplePlan();
    expect(p.measures).toEqual([]);
    expect(p.demolished).toEqual([]);
  });
});

describe('墙角补齐', () => {
  it('L 形相接各延长对方半个墙厚，T 形不变', async () => {
    const {withCorners} = await import('./walls');
    const out = withCorners([wall('h', [0, 0], [3000, 0]), wall('v', [0, 0], [0, 2000]), wall('t', [1500, 0], [1500, 2000])]);
    expect(out[0]).toMatchObject({a: [-100, 0], b: [3000, 0]});
    expect(out[1]).toMatchObject({a: [0, -100], b: [0, 2000]});
    expect(out[2]).toMatchObject({a: [1500, 0], b: [1500, 2000]});
  });
});
