import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {Plan, Wall} from '../../model/types';
import {buildTimeline} from './timeline';
import {buildReplayScene} from './replayScene';

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


const snapshot = (root: THREE.Object3D) => {
  const out: number[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.updateMatrixWorld(true);
    out.push(...o.matrixWorld.elements.map((x) => Math.round(x * 1e6)), o.visible ? 1 : 0);
  });
  return out;
};

describe('回放场景', () => {
  it('同一时刻的画面每次一样（导出视频逐帧一致）', () => {
    const p = twoRooms();
    const tl = buildTimeline(p);
    const s = buildReplayScene(p, tl);
    const dem = tl.demolish.get('x')!;
    const at = dem.start + dem.dur * 0.55;
    s.apply(at);
    const a = snapshot(s.root);
    s.apply(tl.duration);
    s.apply(0);
    s.apply(at);
    expect(snapshot(s.root)).toEqual(a);
    s.dispose();
  });

  it('拆墙：开拆前是整面墙，拆完碎块全部清走', () => {
    const p = twoRooms();
    const tl = buildTimeline(p);
    const s = buildReplayScene(p, tl);
    const dem = tl.demolish.get('x')!;
    const blocks: THREE.Object3D[] = [];
    // 拆的墙 x 长 1.5 m、高 2.8 m：碎块在 rubble 组里，单独一组
    s.apply(dem.start + dem.dur * 0.6);
    s.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent !== s.root && o.parent?.children.length && o.parent.children.length > 10 && o.rotation.order === 'YXZ') blocks.push(o);
    });
    expect(blocks.length).toBeGreaterThan(10);
    // 拆到 60% 时有的已经落地（离地很近），有的还在墙上
    const ys = blocks.map((o) => o.position.y);
    expect(Math.min(...ys)).toBeLessThan(0.2);
    s.apply(dem.start + dem.dur);
    expect(blocks.every((o) => !o.parent!.visible || !o.visible)).toBe(true);
    s.dispose();
  });

  it('砌墙：砌到一半时下半部分砌好，最上面一皮只砌了一部分', () => {
    const p = twoRooms();
    const tl = buildTimeline(p);
    const s = buildReplayScene(p, tl);
    const bld = tl.build.get('n')!;
    s.apply(bld.start + bld.dur * 0.5);
    // 新砌的墙 n：从 (1, 2) 到 (3, 2)，长 2 m；找出这面墙的各皮
    const courses: THREE.Mesh[] = [];
    s.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && Math.abs(m.position.z - 2) < 0.01 && Math.abs(m.scale.y - 0.2) < 1e-6 && m.scale.z === 0.2) courses.push(m);
    });
    const visible = courses.filter((c) => c.visible);
    expect(visible.length).toBeGreaterThan(3);
    expect(visible.length).toBeLessThan(courses.length);
    const lowest = visible.reduce((a, c) => (c.position.y < a.position.y ? c : a));
    const highest = visible.reduce((a, c) => (c.position.y > a.position.y ? c : a));
    expect(lowest.scale.x).toBeCloseTo(2, 2);
    expect(highest.scale.x).toBeLessThan(2);
    s.dispose();
  });
});
