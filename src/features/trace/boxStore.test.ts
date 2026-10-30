import {beforeEach, describe, expect, it} from 'vitest';
import {boxScale, useBoxStore} from './boxStore';
import {wallTypes, wallsFromBoxes} from './boxes';

const st = () => useBoxStore.getState();

beforeEach(() => {
  st().reset();
  st().addBox({name: 'A', x0: 0, y0: 0, x1: 400, y1: 300});
  st().addBox({name: 'B', x0: 400, y0: 0, x1: 700, y1: 300});
});

describe('点墙', () => {
  it('门笔刷：点一下放门，再点一下去掉；撤销能回来', () => {
    st().setBrush('door');
    st().tapWall([402, 150], 10);
    expect(st().marks).toHaveLength(1);
    st().tapWall([400, 160], 10);
    expect(st().marks).toHaveLength(0);
    st().undo();
    expect(st().marks).toHaveLength(1);
  });

  it('换笔刷点已有的门：换成新的类型', () => {
    st().setBrush('door');
    st().tapWall([400, 150], 10);
    st().setBrush('slidingDoor');
    st().tapWall([400, 150], 10);
    expect(st().marks.map((m) => m.kind)).toEqual(['slidingDoor']);
  });

  it('入户门只有一个', () => {
    st().setBrush('entry');
    st().tapWall([100, 0], 10);
    st().tapWall([600, 300], 10);
    expect(st().marks.filter((m) => m.kind === 'entry')).toHaveLength(1);
  });

  it('承重墙笔刷：切换承重和非承重，外墙点了不变；敞开再点改回', () => {
    const inner = () => {
      const walls = wallsFromBoxes(st().boxes);
      return wallTypes(walls, st().wallMarks, 30).get(walls.find((w) => w.sides[0] && w.sides[1])!.id)!;
    };
    st().setBrush('bearing');
    st().tapWall([400, 150], 10);
    expect(inner()).toMatchObject({kind: 'bearing', verified: true});
    st().tapWall([400, 150], 10);
    expect(inner()).toMatchObject({kind: 'partition', verified: true});
    st().setBrush('open');
    st().tapWall([400, 150], 10);
    expect(inner().open).toBe(true);
    st().tapWall([400, 150], 10);
    expect(inner().open).toBe(false);
    const before = st().wallMarks.length;
    st().setBrush('bearing');
    st().tapWall([200, 0], 10);
    expect(st().wallMarks).toHaveLength(before);
  });

  it('按图猜的结果替换之前猜的，用户点过的留着；都核对过后不再算猜的', () => {
    st().setBrush('door');
    st().tapWall([400, 100], 10);
    st().applyGuess({wallMarks: [{at: [400, 150], kind: 'bearing', guessed: true}], marks: [{kind: 'window', at: [200, 0], guessed: true}]}, 'x');
    st().applyGuess({wallMarks: [], marks: [{kind: 'window', at: [600, 0], guessed: true}]}, 'y');
    expect(st().marks.map((m) => [m.kind, !!m.guessed])).toEqual([['door', false], ['window', true]]);
    st().verifyAll(10);
    expect(st().marks.every((m) => !m.guessed)).toBe(true);
    expect(st().wallMarks.every((m) => !m.guessed)).toBe(true);
  });
});

describe('比例', () => {
  it('量墙优先，其次面积，最后图上标注', () => {
    expect(boxScale(st())).toBeNull();
    st().setHintScale(12);
    expect(boxScale(st())).toMatchObject({source: 'hint', mmPerPixel: 12});
    st().setArea('19.5');
    expect(boxScale(st())?.source).toBe('area');
    const wall = wallsFromBoxes(st().boxes).find((w) => w.axis === 'h')!;
    st().setMeasure({wallId: wall.id, mm: String(Math.round((wall.b[0] - wall.a[0]) * 10))});
    expect(boxScale(st())).toMatchObject({source: 'measure'});
    expect(boxScale(st())!.mmPerPixel).toBeCloseTo(10, 1);
  });
});
