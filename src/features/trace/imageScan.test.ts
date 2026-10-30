import {describe, expect, it} from 'vitest';
import type {Opening, Plan, Wall, WallKind} from '../../model/types';
import {createSamplePlan} from '../../model/samplePlan';
import {rasterPlan} from './__fixtures__/raster';
import {autoBox, guessFromImage, snapEdge, wallThickness} from './imageScan';
import {wallsFromBoxes, type Box} from './boxes';

const W = (id: string, a: [number, number], b: [number, number], kind: WallKind, thickness = kind === 'partition' ? 120 : 240): Wall => ({id, a, b, kind, thickness});

/** 8 × 5 m 两室：中间一面墙（承重或隔墙）上有门，上边外墙有窗，下边外墙有入户门 */
function twoRooms(middle: WallKind): Plan {
  const door: Opening = {id: 'd', kind: 'door', a: [4000, 2000], b: [4000, 2900], thickness: middle === 'partition' ? 120 : 240};
  return {
    version: 1,
    id: 'p',
    name: 't',
    wallHeight: 2800,
    walls: [
      W('t1', [0, 0], [1500, 0], 'exterior'),
      W('t2', [3000, 0], [8000, 0], 'exterior'),
      W('r', [8000, 0], [8000, 5000], 'exterior'),
      W('b1', [8000, 5000], [6000, 5000], 'exterior'),
      W('b2', [5000, 5000], [0, 5000], 'exterior'),
      W('l', [0, 5000], [0, 0], 'exterior'),
      W('m1', [4000, 0], [4000, 2000], middle),
      W('m2', [4000, 2900], [4000, 5000], middle),
    ],
    openings: [
      {id: 'win', kind: 'window', a: [1500, 0], b: [3000, 0], thickness: 240},
      {id: 'e', kind: 'door', a: [5000, 5000], b: [6000, 5000], thickness: 240, isEntry: true},
      door,
    ],
    rooms: [],
    furniture: [],
    demolished: [],
    measures: [],
    source: {kind: 'blank'},
  };
}

function boxesOf(toPx: (x: number, y: number) => [number, number]): Box[] {
  const r = (id: string, x0: number, y0: number, x1: number, y1: number): Box => {
    const [a, b] = [toPx(x0, y0), toPx(x1, y1)];
    return {id, name: id, x0: a[0], y0: a[1], x1: b[0], y1: b[1], source: 'manual'};
  };
  return [r('A', 0, 0, 4000, 5000), r('B', 4000, 0, 8000, 5000)];
}

describe('墙厚', () => {
  it('实心墙 240 mm、1 mm = 0.1 px 时约 24 像素', () => {
    expect(wallThickness(rasterPlan(twoRooms('bearing')).g)).toBeGreaterThanOrEqual(22);
    expect(wallThickness(rasterPlan(twoRooms('bearing')).g)).toBeLessThanOrEqual(26);
    expect(wallThickness(rasterPlan(createSamplePlan()).g)).toBeGreaterThanOrEqual(22);
    expect(wallThickness(rasterPlan(createSamplePlan()).g)).toBeLessThanOrEqual(26);
  });
});

describe('边吸附', () => {
  it('横边吸到附近墙线中心', () => {
    const {g, toPx} = rasterPlan(twoRooms('bearing'));
    const [x0, y] = toPx(3000, 0);
    const [x1] = toPx(8000, 0);
    expect(Math.abs(snapEdge(g, 'h', y + 15, x0, x1, 30)! - y)).toBeLessThanOrEqual(1);
    // 附近没有墙线
    expect(snapEdge(g, 'h', toPx(0, 2500)[1], toPx(500, 0)[0], toPx(3500, 0)[0], 20)).toBeNull();
  });
});

describe('双击自动框', () => {
  it('示例户型的小孩房：门洞被截断，框到墙中心线，误差不超过一个墙厚', () => {
    const plan = createSamplePlan();
    const {g, toPx} = rasterPlan(plan);
    const t = wallThickness(g)!;
    const box = autoBox(g, toPx(3000, 1500), t)!;
    expect(box).not.toBeNull();
    const [ex0, ey0] = toPx(1700, -120);
    const [ex1, ey1] = toPx(4700, 3490);
    expect(Math.abs(box.x0 - ex0)).toBeLessThanOrEqual(t);
    expect(Math.abs(box.y0 - ey0)).toBeLessThanOrEqual(t);
    expect(Math.abs(box.x1 - ex1)).toBeLessThanOrEqual(t);
    expect(Math.abs(box.y1 - ey1)).toBeLessThanOrEqual(t);
  });

  it('点在户型外面或墙上：不框', () => {
    const {g, toPx} = rasterPlan(createSamplePlan());
    expect(autoBox(g, [5, 5], 24)).toBeNull();
    expect(autoBox(g, toPx(2000, 3600), 24)).toBeNull();
  });
});

describe('按图猜', () => {
  it('实心的中间墙猜成承重，门、窗、入户门都猜到', () => {
    const {g, toPx} = rasterPlan(twoRooms('bearing'));
    const walls = wallsFromBoxes(boxesOf(toPx));
    const t = wallThickness(g)!;
    const {wallMarks, marks} = guessFromImage(g, walls, t);
    expect(wallMarks).toHaveLength(1);
    expect(wallMarks[0]!.at[0]).toBeCloseTo(toPx(4000, 0)[0], 0);
    const kinds = marks.map((m) => m.kind).sort();
    expect(kinds).toEqual(['door', 'entry', 'window']);
    const near = (k: string, x: number, y: number) => {
      const m = marks.find((mm) => mm.kind === k)!;
      const [px, py] = toPx(x, y);
      return Math.hypot(m.at[0] - px, m.at[1] - py);
    };
    expect(near('door', 4000, 2450)).toBeLessThan(t);
    expect(near('window', 2250, 0)).toBeLessThan(t);
    expect(near('entry', 5500, 5000)).toBeLessThan(t);
  });

  it('空心的中间墙是非承重，门照样猜到', () => {
    const {g, toPx} = rasterPlan(twoRooms('partition'));
    const {wallMarks, marks} = guessFromImage(g, wallsFromBoxes(boxesOf(toPx)), wallThickness(g)!);
    expect(wallMarks).toHaveLength(0);
    expect(marks.filter((m) => m.kind === 'door')).toHaveLength(1);
  });
});
