import {describe, expect, it} from 'vitest';
import type {Plan, Wall} from '../../model/types';
import {createSamplePlan} from '../../model/samplePlan';
import {blocked, buildColliders, pointInPolygon} from '../view3d/walk';
import {buildTimeline, cameraAt, captionAt, progress} from './timeline';
import {planRoute, tourRooms} from './route';

const wall = (id: string, a: [number, number], b: [number, number], extra: Partial<Wall> = {}): Wall => ({id, a, b, thickness: 200, kind: 'partition', ...extra});

/** 两个房间：左 4m、右 3m，中间隔墙开一扇门，入户门在左边上墙 */
const twoRooms = (): Plan => ({
  version: 1,
  id: 'p',
  name: '测试',
  wallHeight: 2800,
  walls: [
    wall('t', [0, 0], [7000, 0], {kind: 'exterior'}),
    wall('r', [7000, 0], [7000, 4000], {kind: 'exterior'}),
    wall('b', [7000, 4000], [0, 4000], {kind: 'exterior'}),
    wall('l', [0, 4000], [0, 0], {kind: 'exterior'}),
    wall('m', [4000, 0], [4000, 4000]),
    wall('n', [1000, 2000], [3000, 2000], {added: true}),
    wall('x', [5000, 3000], [6500, 3000]),
  ],
  openings: [
    {id: 'e', kind: 'door', a: [1500, 0], b: [2400, 0], thickness: 200, isEntry: true},
    {id: 'd', kind: 'door', a: [4000, 1200], b: [4000, 2100], thickness: 200},
  ],
  rooms: [
    {id: 'A', name: '客厅', poly: [[100, 100], [3900, 100], [3900, 3900], [100, 3900]], material: 'wood'},
    {id: 'B', name: '卧室', poly: [[4100, 100], [6900, 100], [6900, 3900], [4100, 3900]], material: 'tile800'},
  ],
  furniture: [{id: 's', type: 'sofa', name: '沙发', cx: 2000, cy: 3300, w: 2000, d: 900, rot: 0, color: '#999'}],
  demolished: ['x'],
  measures: [],
  source: {kind: 'blank'},
});

describe('漫游路线', () => {
  it('走遍两个房间，路线不穿墙也不穿家具', () => {
    const p = twoRooms();
    const route = planRoute(p);
    expect(route.legs.map((l) => l.to.room.name)).toEqual(['客厅', '卧室']);
    const c = buildColliders(p);
    for (const leg of route.legs) {
      for (let i = 1; i < leg.path.length; i++) {
        const [a, b] = [leg.path[i - 1]!, leg.path[i]!];
        for (let s = 0; s <= 20; s++) expect(blocked(c, [a[0] + ((b[0] - a[0]) * s) / 20, a[1] + ((b[1] - a[1]) * s) / 20], 0.12)).toBe(false);
      }
    }
  });

  it('示例户型每个够大的房间都去到', () => {
    const p = createSamplePlan();
    const route = planRoute(p);
    expect(route.legs.length).toBe(tourRooms(p).length);
    for (const leg of route.legs) expect(pointInPolygon([leg.to.at[0] * 1000, leg.to.at[1] * 1000], leg.to.room.poly)).toBe(true);
  });
});

describe('时间线', () => {
  it('章节按顺序排，没有改动的章节跳过', () => {
    const tl = buildTimeline(twoRooms());
    expect(tl.chapters.map((c) => c.id)).toEqual(['raw', 'demolish', 'build', 'paint', 'furnish', 'walk', 'done']);
    for (let i = 1; i < tl.chapters.length; i++) expect(tl.chapters[i]!.start).toBeCloseTo(tl.chapters[i - 1]!.end);
    const plain = buildTimeline({...twoRooms(), demolished: [], walls: twoRooms().walls.filter((w) => !w.added), furniture: []});
    expect(plain.chapters.map((c) => c.id)).toEqual(['raw', 'paint', 'walk', 'done']);
  });

  it('拆墙在砌墙之前，家具在铺地之后', () => {
    const tl = buildTimeline(twoRooms());
    expect(tl.demolish.get('x')!.start).toBeLessThan(tl.build.get('n')!.start);
    expect(progress(tl.furniture.get('s'), tl.chapters.find((c) => c.id === 'paint')!.end)).toBe(0);
    expect(progress(tl.furniture.get('s'), tl.duration)).toBe(1);
  });

  it('相机连续：相邻两帧不会跳', () => {
    const tl = buildTimeline(createSamplePlan());
    let prev = cameraAt(tl, 0).pos;
    for (let t = 1 / 30; t <= tl.duration; t += 1 / 30) {
      const cur = cameraAt(tl, t).pos;
      expect(Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2])).toBeLessThan(0.6);
      prev = cur;
    }
  });

  it('漫游时字幕显示所在房间', () => {
    const p = twoRooms();
    const tl = buildTimeline(p);
    const walk = tl.chapters.find((c) => c.id === 'walk')!;
    const names = new Set<string>();
    for (let t = walk.start; t < walk.end; t += 0.5) {
      const c = cameraAt(tl, t);
      names.add(captionAt(tl, p, t, [c.pos[0], c.pos[2]]).title);
    }
    expect(names).toContain('客厅');
    expect(names).toContain('卧室');
  });
});
