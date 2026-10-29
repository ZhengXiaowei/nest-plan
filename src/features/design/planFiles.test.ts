import {describe, expect, it} from 'vitest';
import {parsePlan} from './planFiles';
import {createSamplePlan} from '../../model/samplePlan';

describe('parsePlan', () => {
  it('读回栖图自己导出的方案', () => {
    const plan = createSamplePlan();
    const back = parsePlan(JSON.parse(JSON.stringify({app: 'nestplan', version: 1, plan})));
    expect(back.walls).toHaveLength(plan.walls.length);
    expect(back.furniture).toHaveLength(plan.furniture.length);
    expect(back.rooms.map((r) => r.id)).toEqual(plan.rooms.map((r) => r.id));
  });

  it('读原版 floorplan-3d 导出的布置：家具、房间、拆墙、测量线', () => {
    const base = createSamplePlan();
    const room = base.rooms[0]!;
    const partitionIndex = base.walls.findIndex((w) => w.kind === 'partition');
    const bearingIndex = base.walls.findIndex((w) => w.kind === 'bearing');
    const legacy = {
      furniture: [{id: 'x', type: 'bed', name: '双人床', cx: 1000, cy: 2000, w: 1800, d: 2000, rot: 90, color: '#c9d6df'}, {type: 'bad'}],
      rooms: {[room.id]: {name: '书房', mat: 'walnut'}},
      demolished: [`w${partitionIndex}`, `w${bearingIndex}`, 'nope'],
      measures: [{a: {x: 0, y: 0}, b: {x: 1000, y: 0}}],
    };
    const plan = parsePlan(legacy);
    expect(plan.furniture).toHaveLength(1);
    expect(plan.furniture[0]).toMatchObject({type: 'bed', cx: 1000, rot: 90});
    expect(plan.rooms[0]).toMatchObject({name: '书房', material: 'walnut'});
    // 原版 w0 是第一段墙，承重墙不能被文件拆掉
    expect(plan.demolished).toEqual([base.walls[partitionIndex]!.id]);
    expect(plan.measures).toHaveLength(1);
  });

  it('不认识的文件报错', () => {
    expect(() => parsePlan({hello: 1})).toThrow();
    expect(() => parsePlan({app: 'nestplan', plan: {walls: [{a: 1}], rooms: [], furniture: []}})).toThrow();
  });
});
