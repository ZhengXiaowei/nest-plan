import {describe, expect, it} from 'vitest';
import {
  attachMarks,
  boxesFromRooms,
  boxesToDraft,
  clipAgainst,
  cutBoxes,
  isExterior,
  unionOutline,
  roomRect,
  scaleFromArea,
  snapToBoxes,
  suggestName,
  wallTypes,
  wallsFromBoxes,
  type Box,
} from './boxes';
import {draftToPlan} from './draft';

const box = (id: string, x0: number, y0: number, x1: number, y1: number, name = id): Box => ({id, name, x0, y0, x1, y1, source: 'manual'});

/** 两个左右相邻的房间：A 400×300，B 300×300，共用 x = 400 */
const two = () => [box('A', 0, 0, 400, 300), box('B', 400, 0, 700, 300)];

describe('方框生成墙', () => {
  it('两个相邻房间：共用边是隔墙，其余是外墙', () => {
    const walls = wallsFromBoxes(two());
    expect(walls).toHaveLength(7);
    const inner = walls.filter((w) => !isExterior(w));
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({axis: 'v', a: [400, 0], b: [400, 300], sides: ['A', 'B']});
    // 上边、下边各按房间分成两段
    expect(walls.filter((w) => w.axis === 'h' && w.a[1] === 0)).toHaveLength(2);
  });

  it('T 字接头：小房间贴在大房间下边一部分，下边按两侧不同切开', () => {
    const walls = wallsFromBoxes([box('A', 0, 0, 600, 300), box('B', 100, 300, 300, 500)]);
    const y300 = walls.filter((w) => w.axis === 'h' && w.a[1] === 300).sort((p, q) => p.a[0] - q.a[0]);
    expect(y300.map((w) => [w.a[0], w.b[0], isExterior(w)])).toEqual([
      [0, 100, true],
      [100, 300, false],
      [300, 600, true],
    ]);
  });

  it('相邻方框的边差半个像素也算贴在一起', () => {
    const walls = wallsFromBoxes([box('A', 0, 0, 400, 300), box('B', 400, 300.5, 700, 600), box('C', 0, 300, 400, 600)]);
    const y300 = walls.filter((w) => w.axis === 'h' && Math.abs(w.a[1] - 300) < 1);
    expect(y300.every((w) => !isExterior(w) || w.a[0] >= 400)).toBe(true);
    expect(y300.find((w) => w.a[0] === 0)?.sides).toEqual(['A', 'C']);
  });

  it('同一个房间的边不会被切碎：一整条边一段墙', () => {
    const walls = wallsFromBoxes([box('A', 0, 0, 400, 300)]);
    expect(walls).toHaveLength(4);
    expect(walls.every(isExterior)).toBe(true);
  });

  it('方框重叠时，落在别的方框里面的边不算墙', () => {
    const walls = wallsFromBoxes([box('A', 0, 0, 400, 300), box('B', 380, 0, 700, 300)]);
    // A 的右边 x=400 在 B 里面，B 的左边 x=380 在 A 里面：两侧不同，仍然各算一段隔墙；外圈完整
    expect(walls.filter(isExterior).length).toBeGreaterThanOrEqual(4);
  });
});

describe('墙类型和门窗', () => {
  it('点过的墙算核实，猜的和默认的不算；外墙总是核实', () => {
    const walls = wallsFromBoxes(two());
    const inner = walls.find((w) => !isExterior(w))!;
    let t = wallTypes(walls, [], 10).get(inner.id)!;
    expect(t).toMatchObject({kind: 'partition', verified: false});
    t = wallTypes(walls, [{at: [402, 150], kind: 'bearing', guessed: true}], 10).get(inner.id)!;
    expect(t).toMatchObject({kind: 'bearing', verified: false, guessed: true});
    t = wallTypes(walls, [{at: [402, 150], kind: 'bearing', guessed: true}, {at: [398, 100], kind: 'partition'}], 10).get(inner.id)!;
    expect(t).toMatchObject({kind: 'partition', verified: true});
    const outer = walls.find(isExterior)!;
    expect(wallTypes(walls, [], 10).get(outer.id)).toMatchObject({kind: 'exterior', verified: true});
  });

  it('门窗挂到最近的墙，离墙太远的不挂', () => {
    const walls = wallsFromBoxes(two());
    const got = attachMarks(walls, [{id: 'd', kind: 'door', at: [403, 120]}, {id: 'x', kind: 'window', at: [200, 150]}], 8);
    expect(got).toHaveLength(1);
    expect(got[0]!.wall.axis).toBe('v');
  });
});

describe('比例和生成户型', () => {
  it('房间按墙厚一半内缩：外墙 120 mm、隔墙 60 mm', () => {
    const walls = wallsFromBoxes(two());
    const types = wallTypes(walls, [], 10);
    // 1 像素 = 10 mm
    expect(roomRect(two()[0]!, walls, types, 10)).toEqual({x0: 12, y0: 12, x1: 394, y1: 288});
  });

  it('填套内面积反推比例，房间尺寸误差 3% 以内', () => {
    const boxes = two();
    const walls = wallsFromBoxes(boxes);
    const types = wallTypes(walls, [], 10);
    // 真实比例 10 mm/px 时的内缩面积
    const real = boxes.reduce((s, b) => {
      const r = roomRect(b, walls, types, 10);
      return s + (r.x1 - r.x0) * (r.y1 - r.y0) * 100;
    }, 0);
    const s = scaleFromArea(boxes, walls, types, real / 1e6)!;
    expect(Math.abs(s - 10) / 10).toBeLessThan(0.03);
    expect(scaleFromArea(boxes, walls, types, 0)).toBeNull();
  });

  it('生成户型：墙、门（入户门）、房间，猜的墙带待核实', () => {
    const draft = boxesToDraft(
      {
        boxes: two(),
        marks: [{id: 'm1', kind: 'door', at: [400, 150]}, {id: 'm2', kind: 'entry', at: [100, 300]}],
        wallMarks: [{at: [400, 150], kind: 'bearing', guessed: true}],
      },
      10,
    );
    const plan = draftToPlan(draft, 10);
    expect(plan.walls).toHaveLength(7);
    const inner = plan.walls.find((w) => w.kind === 'bearing')!;
    expect(inner.unverified).toBe(true);
    expect(inner.thickness).toBe(240);
    expect(plan.walls.filter((w) => w.kind === 'exterior').every((w) => !w.unverified)).toBe(true);
    expect(plan.openings).toHaveLength(2);
    const entry = plan.openings.find((o) => o.isEntry)!;
    expect(Math.hypot(entry.b[0] - entry.a[0], entry.b[1] - entry.a[1])).toBe(1000);
    expect(plan.rooms.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('门比墙长时收到墙长的 80%', () => {
    const draft = boxesToDraft({boxes: [box('A', 0, 0, 100, 100)], marks: [{id: 's', kind: 'slidingDoor', at: [50, 0]}], wallMarks: []}, 10);
    const o = draftToPlan(draft, 10).openings[0]!;
    expect(Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1])).toBe(800);
  });
});

describe('画框的便利', () => {
  it('新方框的边吸到旁边方框的边', () => {
    const a = box('A', 0, 0, 400, 300);
    const b = snapToBoxes(box('B', 406, 4, 700, 296), [a], 10);
    expect([b.x0, b.y0, b.y1]).toEqual([400, 0, 300]);
    expect(b.x1).toBe(700);
  });

  it('默认名按序号，不重名', () => {
    expect(suggestName([box('A', 0, 0, 1, 1, '房间 2')])).toBe('房间 3');
  });
});

describe('AI 房间转方框', () => {
  it('外接矩形，相邻的边对齐成同一条线', () => {
    const boxes = boxesFromRooms(
      [
        {name: '客厅', poly: [[0, 0], [398, 0], [398, 300], [0, 300]]},
        {name: '主卧', poly: [[405, 2], [700, 2], [700, 298], [405, 298]]},
      ],
      12,
    );
    expect(boxes[0]!.x1).toBe(boxes[1]!.x0);
    expect(wallsFromBoxes(boxes).filter((w) => !isExterior(w))).toHaveLength(1);
  });
});

describe('自动框和已有方框重叠', () => {
  it('切掉重叠部分，保留双击点那边', () => {
    const r = clipAgainst({x0: 0, y0: 0, x1: 600, y1: 300}, [box('K', 0, 0, 250, 300)], [400, 150]);
    expect(r).toEqual({x0: 250, y0: 0, x1: 600, y1: 300});
    expect(clipAgainst({x0: 0, y0: 0, x1: 600, y1: 300}, [box('K', 0, 0, 250, 300)], [100, 150])).toBeNull();
  });
});

describe('拖新框切开已有方框', () => {
  it('压住下半截：原来的缩到上半截；完全盖住的去掉', () => {
    const got = cutBoxes([box('W', 0, 0, 200, 300), box('X', 500, 0, 600, 100)], {x0: -10, y0: 200, x1: 300, y1: 300});
    expect(got.map((b) => [b.id, b.x0, b.y0, b.x1, b.y1])).toEqual([
      ['W', 0, 0, 200, 200],
      ['X', 500, 0, 600, 100],
    ]);
    expect(cutBoxes([box('W', 0, 0, 200, 300)], {x0: -1, y0: -1, x1: 201, y1: 301})).toEqual([]);
  });
});

describe('L 形房间', () => {
  it('两个方框同名：中间的墙默认敞开，不生成墙', () => {
    const boxes = [box('a', 0, 0, 400, 300, '主卧'), box('b', 400, 0, 600, 200, '主卧')];
    const walls = wallsFromBoxes(boxes);
    const inner = walls.find((w) => !isExterior(w))!;
    expect(inner.sameRoom).toBe(true);
    expect(wallTypes(walls, [], 10).get(inner.id)).toMatchObject({open: true});
    expect(draftToPlan(boxesToDraft({boxes, marks: [], wallMarks: []}, 10), 10).walls.every((w) => w.kind === 'exterior')).toBe(true);
    // 合成一个 L 形房间
    const plan = draftToPlan(boxesToDraft({boxes, marks: [], wallMarks: []}, 10), 10);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]!.poly).toHaveLength(6);
    // 外圈都按外墙收 120 mm（12 像素），拐角处也对
    const d = boxesToDraft({boxes, marks: [], wallMarks: []}, 10).rooms[0]!.poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(new Set(d.map((p) => p.join()))).toEqual(new Set(['12,12', '588,12', '588,188', '388,188', '388,288', '12,288']));
    // 用户点过的照用户的
    expect(wallTypes(walls, [{at: [400, 100], kind: 'partition'}], 10).get(inner.id)).toMatchObject({open: false});
  });
});

describe('方框合并的轮廓', () => {
  it('两个方框拼成 L 形：6 个顶点，面积对', () => {
    const poly = unionOutline([{x0: 0, y0: 0, x1: 400, y1: 300}, {x0: 400, y0: 0, x1: 600, y1: 200}]);
    expect(poly).toHaveLength(6);
    const area = Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0)) / 2;
    expect(area).toBe(400 * 300 + 200 * 200);
  });
});
