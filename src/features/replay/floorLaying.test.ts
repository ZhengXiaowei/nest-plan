import {describe, expect, it} from 'vitest';
import type {MaterialId, Plan, Wall} from '../../model/types';
import {createSamplePlan} from '../../model/samplePlan';
import {pointInPolygon} from '../../model/geometry';
import {floorLaying, layingCount, layingOrder, plankJoint, PLANK_LEN, PLANK_ROW, type Laying} from './floorLaying';

const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({id, a, b, thickness: 200, kind: 'exterior'});

/** 一个 4 × 3 m 的房间，门开在下边（y = 3000） */
const oneRoom = (material: MaterialId): Plan => ({
  version: 1,
  id: 'p',
  name: '测试',
  wallHeight: 2800,
  walls: [wall('t', [0, 0], [4000, 0]), wall('r', [4000, 0], [4000, 3000]), wall('b', [4000, 3000], [0, 3000]), wall('l', [0, 3000], [0, 0])],
  openings: [{id: 'd', kind: 'door', a: [1500, 3000], b: [2400, 3000], thickness: 200, isEntry: true}],
  rooms: [{id: 'A', name: '卧室', poly: [[100, 100], [3900, 100], [3900, 2900], [100, 2900]], material}],
  furniture: [],
  demolished: [],
  measures: [],
  source: {kind: 'blank'},
});

/** 世界坐标（m）落在第几块，和着色器同一个算法 */
function orderAt(l: Laying, x: number, z: number): number {
  const p = x * l.dir[0] + z * l.dir[1];
  const row = Math.floor(p / l.rowSize);
  const q = l.dir[1] !== 0 ? x : z;
  const col = l.kind === 'planks' ? Math.floor((q - plankJoint(Math.floor(-z / PLANK_ROW))) / l.colSize) : Math.floor(q / l.colSize);
  return layingOrder(l, row, col);
}

describe('铺地方向', () => {
  it('门在房间下方：从上边开始一排排往下铺', () => {
    const l = floorLaying(oneRoom('tile800'), oneRoom('tile800').rooms[0]!);
    expect(l.kind).toBe('tiles');
    expect(l.dir).toEqual([0, 1]);
    expect(l.rowSize).toBe(0.8);
    // 上边的砖比下边（门口）的先铺
    expect(orderAt(l, 2, 0.3)).toBeLessThan(orderAt(l, 2, 2.7));
    // 同一排 S 形：第一排从左往右，第二排从右往左
    expect(orderAt(l, 0.5, 0.3)).toBeLessThan(orderAt(l, 3.5, 0.3));
    expect(orderAt(l, 3.5, 1.0)).toBeLessThan(orderAt(l, 0.5, 1.0));
  });

  it('门在右边：沿 x 铺向右边', () => {
    const p = oneRoom('tile600');
    p.openings = [{id: 'd', kind: 'door', a: [4000, 1000], b: [4000, 1900], thickness: 200}];
    const l = floorLaying(p, p.rooms[0]!);
    expect(l.dir).toEqual([1, 0]);
    expect(orderAt(l, 0.3, 1.5)).toBeLessThan(orderAt(l, 3.7, 1.5));
  });

  it('木地板只沿 z 推进，一排 0.18 m、一块 1.8 m，相邻两排板缝错开', () => {
    const p = oneRoom('wood');
    p.openings = [{id: 'd', kind: 'door', a: [4000, 1000], b: [4000, 1900], thickness: 200}];
    const l = floorLaying(p, p.rooms[0]!);
    expect(l.kind).toBe('planks');
    expect(Math.abs(l.dir[0])).toBe(0);
    expect([l.rowSize, l.colSize]).toEqual([PLANK_ROW, PLANK_LEN]);
    expect(plankJoint(0)).not.toBe(plankJoint(1));
    // 同一块板内（同一排、板缝之间）顺序相同
    const z = 1.0;
    const j = plankJoint(Math.floor(-z / PLANK_ROW));
    expect(orderAt(l, j + 0.1, z)).toBe(orderAt(l, j + 1.7, z));
    expect(orderAt(l, j - 0.1, z)).not.toBe(orderAt(l, j + 0.1, z));
  });

  it('地毯和水磨石整片推开', () => {
    expect(floorLaying(oneRoom('carpet'), oneRoom('carpet').rooms[0]!).kind).toBe('sweep');
    const l = floorLaying(oneRoom('terrazzo'), oneRoom('terrazzo').rooms[0]!);
    expect(l.kind).toBe('sweep');
    expect(l.pStart).toBeCloseTo(0.1);
    expect(l.pEnd).toBeCloseTo(2.9);
    expect(layingCount(l)).toBe(1);
  });

  it('示例户型每个房间里的点都落在 0 到块数之间', () => {
    const plan = createSamplePlan();
    for (const room of plan.rooms) {
      const l = floorLaying(plan, room);
      const xs = room.poly.map((p) => p[0]);
      const ys = room.poly.map((p) => p[1]);
      for (let x = Math.min(...xs) + 50; x < Math.max(...xs); x += 170) {
        for (let y = Math.min(...ys) + 50; y < Math.max(...ys); y += 170) {
          if (!pointInPolygon([x, y], room.poly) || l.kind === 'sweep') continue;
          const o = orderAt(l, x / 1000, y / 1000);
          expect(o, `${room.name} ${x},${y}`).toBeGreaterThanOrEqual(0);
          expect(o, `${room.name} ${x},${y}`).toBeLessThan(layingCount(l));
        }
      }
    }
  });
});
