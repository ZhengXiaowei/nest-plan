import {describe, expect, it} from 'vitest';
import {daylight, solarPosition, sunDirOnPlan, DEFAULT_SITE} from './sun';
import {computeSunlight} from './sunlight';
import {createSamplePlan} from './samplePlan';
import type {Plan} from './types';

const deg = (r: number) => (r * 180) / Math.PI;

describe('太阳位置', () => {
  it('上海正午的高度角：夏至约 82°，冬至约 35°，方位正南', () => {
    const summer = solarPosition(DEFAULT_SITE, 172, 11.9);
    const winter = solarPosition(DEFAULT_SITE, 355, 11.9);
    expect(deg(summer.el)).toBeGreaterThan(80);
    expect(deg(summer.el)).toBeLessThan(83.5);
    expect(deg(winter.el)).toBeGreaterThan(34);
    expect(deg(winter.el)).toBeLessThan(36.5);
    expect(Math.abs(deg(winter.az) - 180)).toBeLessThan(5);
  });

  it('上午在东南，下午在西南', () => {
    expect(deg(solarPosition(DEFAULT_SITE, 355, 9).az)).toBeLessThan(180);
    expect(deg(solarPosition(DEFAULT_SITE, 355, 15).az)).toBeGreaterThan(180);
  });

  it('冬至白天比夏至短，乌鲁木齐比上海日出晚', () => {
    const w = daylight(DEFAULT_SITE, 355)!;
    const s = daylight(DEFAULT_SITE, 172)!;
    expect(w[1] - w[0]).toBeLessThan(s[1] - s[0]);
    expect(daylight({lat: 43.83, lng: 87.62}, 355)![0]).toBeGreaterThan(w[0] + 2);
  });

  it('图纸上方朝北时，正南的太阳在平面图下方', () => {
    const [x, y] = sunDirOnPlan(Math.PI, 0);
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(y).toBeCloseTo(1);
    // 图纸上方朝东（正北在图纸左边）：正南在图纸右边
    const [x2] = sunDirOnPlan(Math.PI, -90);
    expect(x2).toBeCloseTo(1);
  });
});

/** 4m × 4m 的单间，南墙中间一扇 1.8m 宽的窗，图纸上方朝北 */
function box(windows = true): Plan {
  const wall = (id: string, a: [number, number], b: [number, number]) => ({id, a, b, thickness: 200, kind: 'exterior' as const});
  return {
    version: 1, id: 't', name: 't', wallHeight: 2800,
    walls: [wall('n', [0, 0], [4000, 0]), wall('e', [4000, 0], [4000, 4000]), wall('s', [4000, 4000], [0, 4000]), wall('w', [0, 4000], [0, 0])],
    openings: windows ? [{id: 'o', kind: 'window', a: [1100, 4000], b: [2900, 4000], thickness: 200, sill: 900, head: 2400}] : [],
    rooms: [{id: 'r', name: '房间', poly: [[100, 100], [3900, 100], [3900, 3900], [100, 3900]], material: 'wood'}],
    furniture: [], demolished: [], measures: [], source: {kind: 'blank'},
  };
}

describe('室内日照', () => {
  it('南窗：冬至照进屋里的地面比夏至多', () => {
    const w = computeSunlight(box(), DEFAULT_SITE, 355, {cell: 200}).rooms[0]!;
    const s = computeSunlight(box(), DEFAULT_SITE, 172, {cell: 200}).rooms[0]!;
    expect(w.max).toBeGreaterThan(2);
    expect(w.avg).toBeGreaterThan(s.avg);
  });

  it('窗户朝北时冬至晒不到', () => {
    const r = computeSunlight(box(), {...DEFAULT_SITE, north: 180}, 355, {cell: 200}).rooms[0]!;
    expect(r.max).toBe(0);
  });

  it('没有窗户就晒不到', () => {
    expect(computeSunlight(box(false), DEFAULT_SITE, 172, {cell: 300}).rooms[0]!.max).toBe(0);
  });

  it('示例户型冬至有房间晒得到太阳', () => {
    const r = computeSunlight(createSamplePlan(), DEFAULT_SITE, 355, {cell: 300});
    expect(Math.max(...r.rooms.map((x) => x.max))).toBeGreaterThan(1);
  });
});
