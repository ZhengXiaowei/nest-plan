/**
 * 示例户型：数据移植自开源项目 wy51ai/floorplan-3d（MIT License，Copyright (c) 2026 wuyi）
 * https://github.com/wy51ai/floorplan-3d
 * 原项目按户型图尺寸标注推算出墙体、门窗、房间和默认家具，这里换算成栖图的数据模型。
 * 原始数据以「矩形」描述墙体，这里转成「中心线 + 厚度」。
 */
import type {Furniture, MaterialId, Opening, Plan, Room, Vec2, Wall, WallKind} from './types';
import {catalogColor} from './catalog';

type Rect = [x0: number, y0: number, x1: number, y1: number];

/** 矩形 → 中心线 + 厚度 */
function rectToSegment([x0, y0, x1, y1]: Rect): {a: Vec2; b: Vec2; thickness: number} {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w >= h) {
    const y = (y0 + y1) / 2;
    return {a: [Math.min(x0, x1), y], b: [Math.max(x0, x1), y], thickness: h};
  }
  const x = (x0 + x1) / 2;
  return {a: [x, Math.min(y0, y1)], b: [x, Math.max(y0, y1)], thickness: w};
}

const KIND: Record<string, WallKind> = {b: 'bearing', e: 'exterior', n: 'partition', low: 'low'};

const WALL_RECTS: [...Rect, string][] = [
  // 顶部外墙
  [1580, -240, 2120, 0, 'b'], [1580, 0, 1820, 300, 'b'], [2120, -240, 4580, 0, 'e'], [4580, -240, 5140, 0, 'e'],
  [5760, -240, 6050, 0, 'e'], [6050, -240, 6600, 0, 'b'], [6360, 0, 6600, 300, 'b'], [6600, -240, 9960, 0, 'e'],
  [9960, -240, 10510, 0, 'b'], [10270, 0, 10510, 300, 'b'],
  // 右侧外墙
  [10270, 300, 10510, 800, 'e'], [10270, 2600, 10510, 3090, 'e'], [10270, 3090, 10510, 4260, 'b'],
  [10270, 5740, 10510, 6370, 'b'], [9960, 6370, 10510, 6610, 'b'], [10270, 6610, 10510, 7400, 'b'],
  [10270, 9770, 10510, 10560, 'b'], [9960, 10560, 10510, 10800, 'b'],
  // 底部 / 阳台
  [4580, 10560, 9960, 10800, 'e'], [10510, 10560, 12090, 10800, 'e'], [11850, 9960, 12090, 10560, 'e'],
  // 客厅左墙（入户门两侧）
  [4580, 9200, 4820, 10560, 'e'], [4580, 7960, 4820, 8310, 'e'],
  // 餐厅 / 厨房外墙
  [3620, 7960, 4580, 8200, 'e'], [2180, 7960, 3620, 8200, 'b'], [2180, 7590, 2420, 7960, 'b'], [2180, 7400, 2420, 7590, 'n'],
  [-240, 7960, 2180, 8200, 'e'], [-240, 3610, 0, 7960, 'e'],
  // 洗衣阳台
  [0, 4950, 200, 5190, 'n'], [200, 4950, 1275, 5190, 'low'], [1580, 3370, 2420, 3825, 'b'],
  [2180, 4430, 2420, 5796, 'n'], [2090, 4950, 2180, 5190, 'n'],
  // 客卫
  [2420, 4950, 4580, 5190, 'n'], [4580, 3280, 4820, 4075, 'n'], [4580, 4860, 4820, 5190, 'n'], [2420, 3370, 4580, 3610, 'n'],
  // 小孩房 / 主卫
  [4580, 0, 4820, 2400, 'n'], [4820, 2080, 6360, 2320, 'n'], [6360, 300, 6600, 1198, 'n'], [6360, 1983, 6600, 2400, 'n'],
  // 过道 / 主卧 / 子女房
  [6083, 3370, 6600, 3707, 'b'], [6360, 3280, 6600, 3370, 'n'], [6600, 3370, 9960, 3610, 'n'], [9960, 3370, 10270, 3610, 'b'],
  [6083, 4600, 6323, 6610, 'n'], [6323, 6370, 9960, 6610, 'n'],
];

const WINDOW_RECTS: Rect[] = [
  [5140, -240, 5760, 0], [1580, 300, 1820, 3370], [-240, 3370, 1580, 3610], [2180, 3825, 2420, 4430],
  [10510, 6370, 12090, 6610], [11850, 6610, 12090, 9960],
];

/** 飘窗（主卧 / 子女房） */
const BAY_RECTS: Rect[] = [
  [10510, 660, 11130, 760], [11030, 760, 11130, 2650], [10510, 2650, 11130, 2750],
  [10510, 4110, 11130, 4210], [11030, 4210, 11130, 5785], [10510, 5785, 11130, 5885],
];

const DOORS: {name: string; rect: Rect; hinge: Vec2; closed: Vec2; open: Vec2; leaf: number; entry?: boolean}[] = [
  {name: '小孩房门', rect: [4580, 2400, 4820, 3280], hinge: [4580, 3280], closed: [0, -1], open: [-1, 0], leaf: 880},
  {name: '主卧门', rect: [6360, 2400, 6600, 3280], hinge: [6600, 3280], closed: [0, -1], open: [1, 0], leaf: 880},
  {name: '主卫门', rect: [6360, 1198, 6600, 1983], hinge: [6360, 1198], closed: [0, 1], open: [-1, 0], leaf: 785},
  {name: '客卫门', rect: [4580, 4075, 4820, 4860], hinge: [4580, 4860], closed: [0, -1], open: [-1, 0], leaf: 785},
  {name: '子女房门', rect: [6083, 3707, 6323, 4600], hinge: [6323, 4600], closed: [0, -1], open: [1, 0], leaf: 893},
  {name: '入户门', rect: [4580, 8310, 4820, 9200], hinge: [4820, 9200], closed: [0, -1], open: [1, 0], leaf: 890, entry: true},
];

const SLIDING_RECTS: Rect[] = [
  [10270, 7400, 10510, 9770],
  [1275, 4950, 2090, 5190],
];

const R = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const ROOMS: Room[] = [
  {id: 'master', name: '主卧室', poly: R(6600, 0, 10270, 3370), material: 'wood', labelAt: [8435, 2420]},
  {id: 'mbath', name: '主卫浴', poly: R(4820, 0, 6360, 2080), material: 'antislip', labelAt: [5980, 1780]},
  {id: 'kid', name: '小孩房', poly: R(1820, 0, 4580, 3370), material: 'wood', labelAt: [3380, 2330]},
  {id: 'gbath', name: '客卫浴', poly: R(2420, 3610, 4580, 4950), material: 'antislip', labelAt: [3760, 4620]},
  {id: 'laundry', name: '洗衣阳台', poly: R(0, 3610, 2180, 4950), material: 'antislip', labelAt: [1250, 4330]},
  {id: 'child', name: '子女房', poly: R(6323, 3610, 10270, 6370), material: 'wood', labelAt: [8850, 4850]},
  {id: 'kitchen', name: '厨房', poly: R(0, 5190, 2180, 7960), material: 'tile600', labelAt: [1300, 6500]},
  {
    id: 'dining', name: '餐厅', material: 'tile800', labelAt: [3900, 5520],
    poly: [[2420, 5190], [4820, 5190], [4820, 7960], [2420, 7960], [2420, 7400], [2180, 7400], [2180, 5796], [2420, 5796]],
  },
  {
    id: 'hall', name: '过道', material: 'tile800', labelAt: [5450, 4450],
    poly: [[4820, 2320], [6360, 2320], [6360, 3370], [6083, 3370], [6083, 6610], [4820, 6610]],
  },
  {id: 'living', name: '客厅', poly: R(4820, 6610, 10270, 10560), material: 'tile800', labelAt: [7600, 7560]},
  {id: 'balcony', name: '休闲阳台', poly: R(10510, 6610, 11850, 10560), material: 'walnut', labelAt: [11180, 9450]},
  {
    id: 'bay1', name: '主卧飘窗', material: 'marble', counted: false,
    poly: [[10270, 800], [10510, 800], [10510, 760], [11030, 760], [11030, 2650], [10510, 2650], [10510, 2600], [10270, 2600]],
  },
  {
    id: 'bay2', name: '子女房飘窗', material: 'marble', counted: false,
    poly: [[10270, 4260], [10510, 4260], [10510, 4210], [11030, 4210], [11030, 5785], [10510, 5785], [10510, 5740], [10270, 5740]],
  },
];

type FRow = [type: string, name: string, cx: number, cy: number, w: number, d: number, rot?: number, color?: string];

const FURNITURE: FRow[] = [
  // 主卧
  ['bed', '双人床', 8300, 1000, 1800, 2000, 0, '#C9D6DF'], ['nightstand', '床头柜', 7150, 220, 450, 400],
  ['nightstand', '床头柜', 9450, 220, 450, 400], ['wardrobe', '衣柜', 8800, 3070, 2400, 600, 180],
  ['baycushion', '飘窗垫', 10770, 1705, 520, 1800],
  // 主卫
  ['shower', '淋浴房', 5270, 450, 900, 900], ['toilet', '马桶', 5170, 1500, 400, 700, 270], ['vanity', '浴室柜', 6110, 700, 800, 500, 90],
  // 小孩房
  ['bed', '单人床', 2420, 1000, 1200, 2000, 0, '#E8D5B5'], ['desk', '书桌', 2120, 2700, 1200, 600, 270],
  ['chair', '椅子', 2700, 2700, 450, 480, 90], ['wardrobe', '衣柜', 4280, 1000, 1600, 600, 90], ['bookshelf', '书架', 3500, 150, 800, 300],
  // 客卫
  ['shower', '淋浴区', 2870, 4280, 900, 1340], ['toilet', '马桶', 3560, 3960, 400, 700], ['vanity', '浴室柜', 4150, 3850, 700, 480],
  // 洗衣阳台
  ['washer', '洗衣机', 300, 3960, 600, 600, 270], ['vanity', '洗衣池', 250, 4600, 600, 500, 270],
  // 厨房
  ['counter', '橱柜台面', 300, 6575, 2770, 600, 270], ['counter', '橱柜台面', 1390, 7660, 1580, 600, 180],
  ['stove', '燃气灶', 300, 6200, 750, 450, 270], ['ksink', '水槽', 1400, 7680, 800, 450, 180],
  // 餐厅
  ['fridge', '冰箱', 2770, 5540, 700, 700], ['table', '餐桌', 3600, 6650, 1400, 800, 90],
  ['chair', '餐椅', 2940, 6320, 450, 480, 270], ['chair', '餐椅', 2940, 6980, 450, 480, 270],
  ['chair', '餐椅', 4260, 6320, 450, 480, 90], ['chair', '餐椅', 4260, 6980, 450, 480, 90],
  ['cabinet', '餐边柜', 3500, 7785, 1600, 350, 180],
  // 客厅
  ['rug', '地毯', 7600, 8950, 2600, 1800], ['tvstand', '电视柜', 7600, 6810, 2400, 400], ['sofa', '三人沙发', 7600, 10110, 3000, 900, 180],
  ['coffeetable', '茶几', 7600, 8900, 1300, 650], ['armchair', '单人沙发', 9500, 8900, 850, 850, 90],
  ['shoecab', '鞋柜', 4995, 9900, 1000, 350, 270], ['plant', '绿植', 9950, 10250, 500, 500], ['plant', '绿植', 5250, 7050, 500, 500],
  // 子女房
  ['bed', '双人床', 7323, 5500, 1500, 2000, 270, '#D8C7DC'], ['wardrobe', '衣柜', 8500, 3910, 2000, 600],
  ['desk', '书桌', 9500, 6070, 1200, 600, 180], ['chair', '椅子', 9500, 5480, 450, 480], ['baycushion', '飘窗垫', 10770, 4997, 520, 1575],
  // 休闲阳台
  ['roundtable', '茶桌', 11180, 8200, 600, 600], ['armchair', '休闲椅', 11180, 7520, 750, 750, 0, '#D6B99A'],
  ['armchair', '休闲椅', 11180, 8880, 750, 750, 180, '#D6B99A'], ['plant', '绿植', 11550, 10250, 500, 500],
];

export function createSamplePlan(): Plan {
  const walls: Wall[] = WALL_RECTS.map(([x0, y0, x1, y1, k], i) => ({
    id: `w${i + 1}`,
    kind: KIND[k] ?? 'partition',
    ...rectToSegment([x0, y0, x1, y1]),
  }));

  const openings: Opening[] = [
    ...WINDOW_RECTS.map((r, i): Opening => ({id: `win${i + 1}`, kind: 'window', sill: 900, head: 2400, ...rectToSegment(r)})),
    ...BAY_RECTS.map((r, i): Opening => ({id: `bay${i + 1}`, kind: 'window', name: '飘窗', sill: 450, head: 2400, ...rectToSegment(r)})),
    ...DOORS.map((d, i): Opening => ({
      id: `door${i + 1}`,
      kind: 'door',
      name: d.name,
      head: 2100,
      isEntry: d.entry,
      swing: {hinge: d.hinge, closed: d.closed, open: d.open, leaf: d.leaf},
      ...rectToSegment(d.rect),
    })),
    ...SLIDING_RECTS.map((r, i): Opening => ({id: `slide${i + 1}`, kind: 'slidingDoor', head: 2200, ...rectToSegment(r)})),
  ];

  const furniture: Furniture[] = FURNITURE.map(([type, name, cx, cy, w, d, rot = 0, color], i) => ({
    id: `f${i + 1}`,
    type,
    name,
    cx,
    cy,
    w,
    d,
    rot,
    color: color ?? catalogColor(type),
  }));

  return {
    version: 1,
    id: 'sample',
    name: '示例户型 · 三室两厅',
    wallHeight: 2800,
    walls,
    openings,
    rooms: ROOMS.map((r) => ({...r, poly: [...r.poly], material: r.material as MaterialId})),
    furniture,
    demolished: [],
    measures: [],
    source: {kind: 'sample', note: '数据来自 wy51ai/floorplan-3d（MIT）'},
  };
}
