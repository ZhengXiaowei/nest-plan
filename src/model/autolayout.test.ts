import {describe, expect, it} from 'vitest';
import {
  checkLayout,
  furnitureInRoom,
  layoutRoomKind,
  placeItems,
  roomInfo,
  withRoomFurniture,
  type LayoutItem,
  type RoomInfo,
} from './autolayout';
import {createSamplePlan} from './samplePlan';
import type {Furniture} from './types';

const plan = createSamplePlan();
const master = () => roomInfo(plan, 'master')!;

/** 按名字摆，返回 AI 自取的 id → 家具 */
function place(info: RoomInfo, items: LayoutItem[], existing: Furniture[] = []) {
  const r = placeItems(info, items, existing);
  return {...r, by: new Map(r.placed.map((p) => [p.key, p.f]))};
}

const furn = (id: string, type: string, name: string, cx: number, cy: number, w: number, d: number, rot = 0): Furniture => ({
  id,
  type,
  name,
  cx,
  cy,
  w,
  d,
  rot,
  color: '#ccc',
});

describe('房间类型', () => {
  it('卧室、书房、客厅、餐厅可以布置', () => {
    expect(layoutRoomKind('主卧室')).toBe('bedroom');
    expect(layoutRoomKind('小孩房')).toBe('bedroom');
    expect(layoutRoomKind('子女房')).toBe('bedroom');
    expect(layoutRoomKind('次卧')).toBe('bedroom');
    expect(layoutRoomKind('书房')).toBe('study');
    expect(layoutRoomKind('客厅')).toBe('living');
    expect(layoutRoomKind('客餐厅')).toBe('living');
    expect(layoutRoomKind('餐厅')).toBe('dining');
  });

  it('厨卫、阳台、过道、玄关不可以（「厨房」不会被当成卧室）', () => {
    for (const name of ['厨房', '客卫浴', '主卫', '洗衣阳台', '休闲阳台', '过道', '走道', '玄关', '衣帽间', '储藏室']) {
      expect(layoutRoomKind(name), name).toBeNull();
    }
  });
});

describe('房间墙面', () => {
  it('主卧室：4 面墙的方位、长度和内向', () => {
    const {faces} = master();
    expect(faces.map((f) => [f.id, f.side, f.len])).toEqual([
      ['A', 'top', 3670],
      ['B', 'right', 3370],
      ['C', 'bottom', 3670],
      ['D', 'left', 3370],
    ]);
    expect(faces.map((f) => f.inward)).toEqual([
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ]);
    // start 是左 / 上端
    expect(faces[2]!.start).toEqual([6600, 3370]);
    expect(faces[3]!.start).toEqual([6600, 0]);
  });

  it('主卧室：右墙中间通往飘窗的开口按窗台 450 的窗算', () => {
    const right = master().faces.find((f) => f.side === 'right')!;
    expect(right.openings).toEqual([expect.objectContaining({kind: 'window', name: '飘窗', from: 800, to: 2600, sill: 450})]);
  });

  it('主卧室：左墙上的两扇门，开向主卧的给门扇正方形，开向主卫的给门口通道', () => {
    const info = master();
    const left = info.faces.find((f) => f.side === 'left')!;
    expect(left.openings.map((o) => [o.kind, o.name, o.from, o.to, o.swingsIn])).toEqual([
      ['door', '主卫门', 1198, 1983, false],
      ['door', '主卧门', 2400, 3280, true],
    ]);
    expect(info.keepOuts).toEqual(
      expect.arrayContaining([
        {rect: [6600, 2400, 7480, 3280], label: '主卧门的开门范围'},
        {rect: [6600, 1198, 7200, 1983], label: '主卫门的门口'},
      ]),
    );
  });

  it('L 形的餐厅：凹角处的内向也对，短于 300 mm 的边不算墙面', () => {
    const info = roomInfo(plan, 'dining')!;
    // 轮廓 8 条边里有 2 条只有 240 mm
    expect(info.faces).toHaveLength(6);
    for (const f of info.faces) {
      const mid: [number, number] = [(f.start[0] + f.end[0]) / 2 + f.inward[0] * 50, (f.start[1] + f.end[1]) / 2 + f.inward[1] * 50];
      expect(mid[0] > 2180 && mid[0] < 4820 && mid[1] > 5190 && mid[1] < 7960, `${f.id} 内向应指向房间`).toBe(true);
    }
  });
});

describe('摆放', () => {
  it('四个方位靠墙：背面贴墙，旋转角 0 / 90 / 180 / 270', () => {
    const {by} = place(master(), [
      {id: 'bed', item: '双人床 1.8m', wall: 'A', align: 'center'},
      {id: 'r', item: '书架', wall: 'B', align: 'start'},
      {id: 'b', item: '书架', wall: 'C', align: 'end'},
      {id: 'l', item: '书架', wall: 'D', align: 'start'},
    ]);
    expect(by.get('bed')).toMatchObject({type: 'bed', cx: 8435, cy: 1000, rot: 0, w: 1800, d: 2000});
    expect(by.get('r')).toMatchObject({cx: 10270 - 150, cy: 400, rot: 90});
    expect(by.get('b')).toMatchObject({cx: 10270 - 400, cy: 3370 - 150, rot: 180});
    expect(by.get('l')).toMatchObject({cx: 6600 + 150, cy: 400, rot: 270});
  });

  it('对齐端的距离、离墙距离和加宽（加宽有上下限）', () => {
    const {by} = place(master(), [
      {id: 'a', item: '书架', wall: 'A', align: 'start', offset: 300, gap: 100},
      {id: 'b', item: '衣柜', wall: 'A', align: 'end', w: 9000},
      {id: 'c', item: '衣柜', wall: 'C', align: 'end', w: 100},
    ]);
    expect(by.get('a')).toMatchObject({cx: 6600 + 300 + 400, cy: 100 + 150});
    // 加宽不超过墙长
    expect(by.get('b')!.w).toBe(3670);
    // 不小于家具库宽度的一半
    expect(by.get('c')!.w).toBe(1000);
  });

  it('床头柜挨着床：朝向相同、背面对齐', () => {
    const {by} = place(master(), [
      {id: 'bed', item: '双人床 1.8m', wall: 'A', align: 'center'},
      {id: 'n1', item: '床头柜', beside: 'bed', side: 'start'},
      {id: 'n2', item: '床头柜', beside: 'bed', side: 'end', gap: 50},
    ]);
    expect(by.get('n1')).toMatchObject({cx: 8435 - 900 - 225, cy: 200, rot: 0});
    expect(by.get('n2')).toMatchObject({cx: 8435 + 900 + 50 + 225, cy: 200, rot: 0});
  });

  it('挨着竖墙上的家具时，start 是上侧', () => {
    const {by} = place(master(), [
      {id: 'desk', item: '书桌', wall: 'B', align: 'end'},
      {id: 'shelf', item: '书架', beside: 'desk', side: 'start'},
    ]);
    const desk = by.get('desk')!;
    expect(desk).toMatchObject({rot: 90, cx: 10270 - 300, cy: 3370 - 600});
    // 书架在书桌上方、背面同样贴右墙
    expect(by.get('shelf')).toMatchObject({rot: 90, cx: 10270 - 150, cy: 3370 - 1200 - 400});
  });

  it('椅子在书桌正前方：面朝书桌，可以塞进桌下', () => {
    const {by} = place(master(), [
      {id: 'desk', item: '书桌', wall: 'A', align: 'start'},
      {id: 'chair', item: '椅子', front: 'desk', gap: -150},
    ]);
    const desk = by.get('desk')!;
    expect(by.get('chair')).toMatchObject({rot: 180, cx: desk.cx, cy: 600 - 150 + 240});
  });

  it('房间正中：可以转 90°', () => {
    const {by} = place(master(), [{id: 'rug', item: '地毯', center: true, rot: 90}]);
    expect(by.get('rug')).toMatchObject({cx: 8435, cy: 1685, rot: 90});
  });

  it('靠墙时自动避开相邻墙上的门扫过的范围', () => {
    // 下墙靠左会压到主卧门开门的正方形（x 6600~7480），滑到它右边
    const {by} = place(master(), [{id: 'wd', item: '衣柜', wall: 'C', align: 'start'}]);
    expect(by.get('wd')).toMatchObject({cx: 7480 + 1000, rot: 180});
  });

  it('靠墙时避开本面墙上的门口', () => {
    // 原本压在主卫门口（1198~1983），滑到门口上方
    const {by} = place(master(), [{id: 'a', item: '书架', wall: 'D', align: 'start', offset: 1100}]);
    expect(by.get('a')!.cy).toBe(1198 - 400);
  });

  it('靠墙时避开已经放好的家具', () => {
    const {by} = place(master(), [
      {id: 'b', item: '书架', wall: 'A', align: 'start'},
      {id: 'c', item: '书架', wall: 'A', align: 'start'},
    ]);
    expect(by.get('b')!.cx).toBe(6600 + 400);
    // c 和 b 压着，滑到 b 右边
    expect(by.get('c')!.cx).toBe(6600 + 800 + 400);
  });

  it('高家具从飘窗开口前挪开，矮家具可以放在飘窗前', () => {
    const {by} = place(master(), [
      {id: 'shelf', item: '书架', wall: 'B', align: 'center'},
      {id: 'bed', item: '单人床', wall: 'B', align: 'center'},
    ]);
    // 书架高 2000，滑出飘窗开口（800~2600）到上面的墙段
    expect(by.get('shelf')!.cy).toBe(400);
    // 单人床高 450，不挡窗台 450 的飘窗，原地放
    expect(by.get('bed')!.cy).toBe(1685);
  });

  it('放不下、家具库没有、引用不存在的会被跳过并说明原因', () => {
    const {placed, skipped} = place(master(), [
      {id: 'x', item: '飞天床', wall: 'A'},
      {id: 'y', item: '床头柜', beside: 'nobody'},
      {id: 'z', item: '衣柜', wall: 'Z'},
      {id: 'ok', item: '床头柜', wall: 'A'},
    ]);
    expect(placed.map((p) => p.key)).toEqual(['ok']);
    expect(skipped).toHaveLength(3);
    expect(skipped.join('\n')).toMatch(/飞天床/);
    expect(skipped.join('\n')).toMatch(/nobody/);
    expect(skipped.join('\n')).toMatch(/Z/);
  });

  it('家具名不区分空格', () => {
    const {by} = place(master(), [{id: 'bed', item: '双人床1.8m', wall: 'A'}]);
    expect(by.get('bed')?.name).toBe('双人床 1.8m');
  });
});

describe('布局检查', () => {
  it('合理的主卧布置：床、两侧床头柜、避开门的衣柜，没有问题', () => {
    const info = master();
    const {placed, skipped} = placeItems(info, [
      {id: 'bed', item: '双人床 1.8m', wall: 'A', align: 'center'},
      {id: 'n1', item: '床头柜', beside: 'bed', side: 'start'},
      {id: 'n2', item: '床头柜', beside: 'bed', side: 'end'},
      {id: 'wd', item: '衣柜', wall: 'C', align: 'end'},
    ]);
    expect(skipped).toEqual([]);
    expect(checkLayout(info, placed.map((p) => p.f))).toEqual([]);
  });

  it('两件压在一起', () => {
    const issues = checkLayout(master(), [furn('a', 'desk', '书桌', 8000, 1000, 1200, 600), furn('b', 'bookshelf', '书架', 8300, 1100, 800, 300)]);
    expect(issues.filter((i) => i.kind === 'overlap')).toEqual([expect.objectContaining({ids: ['a', 'b']})]);
  });

  it('地毯、塞进桌下的椅子、电视柜上方的电视不算压着', () => {
    const issues = checkLayout(master(), [
      furn('rug', 'rug', '地毯', 8400, 1600, 2400, 1700),
      furn('desk', 'desk', '书桌', 8400, 1600, 1200, 600),
      furn('chair', 'chair', '椅子', 8400, 1900, 450, 480, 180),
      furn('stand', 'tvstand', '电视柜', 8400, 3170, 2400, 400, 180),
      furn('tv', 'tv', '65 寸电视', 8400, 3300, 1450, 80, 180),
    ]);
    expect(issues.filter((i) => i.kind === 'overlap')).toEqual([]);
  });

  it('伸出房间', () => {
    const issues = checkLayout(master(), [furn('a', 'wardrobe', '衣柜', 6700, 1000, 2000, 600, 90)]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'outside', ids: ['a']})]));
  });

  it('挡住开门的范围', () => {
    const issues = checkLayout(master(), [furn('a', 'bookshelf', '书架', 7000, 3200, 800, 300, 180)]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'door', message: expect.stringMatching(/主卧门/)})]));
  });

  it('衣柜挡飘窗要报，同一位置放床不报', () => {
    const wd = checkLayout(master(), [furn('a', 'wardrobe', '衣柜', 10270 - 300, 1700, 2000, 600, 90)]);
    expect(wd).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'window'})]));
    const bed = checkLayout(master(), [furn('b', 'bed', '单人床', 10270 - 1000, 1700, 1200, 2000, 90)]);
    expect(bed.filter((i) => i.kind === 'window')).toEqual([]);
  });

  it('衣柜前留空不够', () => {
    const issues = checkLayout(master(), [
      furn('wd', 'wardrobe', '衣柜', 9270, 3070, 2000, 600, 180),
      furn('x', 'armchair', '单人沙发', 9270, 2400, 850, 850),
    ]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'clearance', ids: ['wd'], message: expect.stringMatching(/600/)})]));
  });

  it('床尾贴墙、双人床一侧贴墙都要报', () => {
    // 1.8m 床竖着放在左上角：床尾离下墙不到 500，左侧贴着左墙
    const issues = checkLayout(master(), [furn('bed', 'bed', '双人床 1.8m', 6600 + 900, 3370 - 1000 - 300, 1800, 2000)]);
    const msgs = issues.filter((i) => i.kind === 'clearance').map((i) => i.message);
    expect(msgs.join('\n')).toMatch(/床尾/);
    expect(msgs.join('\n')).toMatch(/床边/);
  });

  it('单人床一侧贴墙没关系', () => {
    // 放在右上角，右侧贴墙，左侧留空够
    const issues = checkLayout(master(), [furn('bed', 'bed', '单人床', 10270 - 600, 1000, 1200, 2000)]);
    expect(issues).toEqual([]);
  });
});

describe('写回方案', () => {
  const bed = furn('new', 'bed', '双人床 1.8m', 8435, 1000, 1800, 2000);
  const rug = furn('newrug', 'rug', '地毯', 8435, 1685, 2400, 1700);

  it('默认清掉本房间原有家具，其他房间不动，地毯放最底层', () => {
    const before = furnitureInRoom(plan, 'master');
    expect(before.length).toBeGreaterThan(0);
    const next = withRoomFurniture(plan, 'master', [bed, rug], false);
    expect(furnitureInRoom(next, 'master').map((f) => f.id).sort()).toEqual(['new', 'newrug']);
    expect(next.furniture.length).toBe(plan.furniture.length - before.length + 2);
    expect(next.furniture[0]!.id).toBe('newrug');
    // 其他房间的家具原样保留
    const kid = furnitureInRoom(plan, 'kid').map((f) => f.id);
    expect(furnitureInRoom(next, 'kid').map((f) => f.id)).toEqual(kid);
  });

  it('保留模式不清原有家具', () => {
    const before = furnitureInRoom(plan, 'master').length;
    const next = withRoomFurniture(plan, 'master', [bed], true);
    expect(furnitureInRoom(next, 'master')).toHaveLength(before + 1);
  });
});
