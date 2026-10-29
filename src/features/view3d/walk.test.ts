import {describe, expect, it} from 'vitest';
import type {Plan, Wall} from '../../model/types';
import {createSamplePlan} from '../../model/samplePlan';
import {blocked, buildColliders, doorCollider, doorsOf, openingsOnActiveWalls, pointInPolygon, startPose, tryMove} from './walk';

const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({id, a, b, thickness: 200, kind: 'partition'});
// 4m × 3m 的房间，上墙中间一扇门
const room = (): Plan => ({
  version: 1,
  id: 'p',
  name: 't',
  wallHeight: 2800,
  walls: [wall('t', [0, 0], [4000, 0]), wall('r', [4000, 0], [4000, 3000]), wall('b', [4000, 3000], [0, 3000]), wall('l', [0, 3000], [0, 0])],
  openings: [
    {id: 'd', kind: 'door', a: [1500, 0], b: [2400, 0], thickness: 200, isEntry: true, swing: {hinge: [1500, 0], closed: [1, 0], open: [0, 1], leaf: 900}},
  ],
  rooms: [{id: 'r', name: '客厅', poly: [[100, 100], [3900, 100], [3900, 2900], [100, 2900]], material: 'wood'}],
  furniture: [],
  demolished: [],
  measures: [],
  source: {kind: 'blank'},
});

describe('碰撞', () => {
  it('门洞能穿过，墙不能', () => {
    const c = buildColliders(room());
    // 门洞中间 (1.95, 0) 不挡；墙上 (0.5, 0) 挡
    expect(blocked(c, [1.95, 0])).toBe(false);
    expect(blocked(c, [0.5, 0])).toBe(true);
  });

  it('撞墙时沿墙滑动', () => {
    const c = buildColliders(room());
    // 贴着左墙往左上走，x 被挡住，z 继续走
    const [x, z] = tryMove(c, [0.4, 1.5], -0.1, 0.1);
    expect(x).toBeCloseTo(0.4);
    expect(z).toBeCloseTo(1.6);
  });

  it('拆掉的墙不再挡人，上面的门也一起没了', () => {
    const p = {...room(), demolished: ['t']};
    expect(blocked(buildColliders(p), [0.5, 0])).toBe(false);
    expect(openingsOnActiveWalls(p)).toHaveLength(0);
  });

  it('关着的门挡在洞口上', () => {
    const [d] = doorsOf(room().openings);
    expect(blocked([doorCollider(d!)], [1.95, 0])).toBe(true);
  });
});

describe('起点', () => {
  it('从入户门往屋里走一步，面朝屋内', () => {
    const {pos, yaw} = startPose(room());
    expect(pos[0]).toBeCloseTo(1.95);
    expect(pos[1]).toBeCloseTo(0.8);
    // 朝 +z（屋内）看：yaw = π
    expect(Math.abs(yaw)).toBeCloseTo(Math.PI);
  });

  it('示例户型的起点在某个房间里', () => {
    const p = createSamplePlan();
    const {pos} = startPose(p);
    expect(p.rooms.some((r) => pointInPolygon([pos[0] * 1000, pos[1] * 1000], r.poly))).toBe(true);
  });
});

describe('家具碰撞', () => {
  it('沙发挡人，地毯不挡', () => {
    const p = room();
    p.furniture = [
      {id: 's', type: 'sofa', name: '沙发', cx: 2000, cy: 2000, w: 2000, d: 900, rot: 0, color: '#999'},
      {id: 'r', type: 'rug', name: '地毯', cx: 1000, cy: 1000, w: 1600, d: 1200, rot: 0, color: '#999'},
    ];
    const c = buildColliders(p);
    expect(blocked(c, [2.0, 1.6])).toBe(true);
    expect(blocked(c, [1.0, 1.0])).toBe(false);
  });
});
