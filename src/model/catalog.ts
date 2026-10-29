/**
 * 家具库。尺寸与配色沿用 wy51ai/floorplan-3d（MIT）的家具库，
 * 另外补充了 3D 用的高度（mm）。
 */
export interface CatalogItem {
  type: string;
  name: string;
  w: number;
  d: number;
  color: string;
}

export interface CatalogGroup {
  category: string;
  items: CatalogItem[];
}

const g = (category: string, rows: [string, string, number, number, string][]): CatalogGroup => ({
  category,
  items: rows.map(([type, name, w, d, color]) => ({type, name, w, d, color})),
});

export const CATALOG: CatalogGroup[] = [
  g('卧室', [
    ['bed', '双人床 1.8m', 1800, 2000, '#C9D6DF'], ['bed', '双人床 1.5m', 1500, 2000, '#D8C7DC'],
    ['bed', '单人床', 1200, 2000, '#E8D5B5'], ['crib', '婴儿床', 1250, 700, '#EFE3D0'],
    ['nightstand', '床头柜', 450, 400, '#E8DCCB'], ['wardrobe', '衣柜', 2000, 600, '#EFE6D8'],
    ['wardrobe', '小衣柜', 1200, 550, '#EFE6D8'], ['dresser', '梳妆台', 1000, 450, '#EFE6D8'],
    ['desk', '书桌', 1200, 600, '#E2CFB4'], ['chair', '椅子', 450, 480, '#CFC6B8'],
    ['bookshelf', '书架', 800, 300, '#E2CFB4'], ['baycushion', '飘窗垫', 520, 1800, '#E7DCCD'],
  ]),
  g('客厅', [
    ['sofa', '三人沙发', 2400, 900, '#B7C4B0'], ['sofa', '双人沙发', 1700, 880, '#C3CBD6'],
    ['cornersofa', '转角沙发', 2800, 1700, '#B7C4B0'], ['armchair', '单人沙发', 850, 850, '#D6B99A'],
    ['beanbag', '懒人沙发', 800, 800, '#E0B98F'], ['coffeetable', '茶几', 1300, 650, '#E8DCCB'],
    ['sidetable', '边几', 500, 500, '#D9C3A3'], ['tvstand', '电视柜', 2400, 400, '#E2CFB4'],
    ['rug', '地毯', 2400, 1700, '#D9CBB8'], ['shoecab', '鞋柜', 1000, 350, '#EFE6D8'],
    ['shoecab', '玄关柜', 1400, 380, '#E6DCCC'], ['floorlamp', '落地灯', 450, 450, '#3D3A34'],
    ['plant', '绿植', 500, 500, '#A9C39B'], ['plant', '大绿植', 700, 700, '#9DBB8C'],
  ]),
  g('餐厨', [
    ['table', '餐桌', 1400, 800, '#E2CFB4'], ['table', '六人餐桌', 1800, 900, '#D8C2A2'],
    ['roundtable', '圆桌', 1000, 1000, '#E2CFB4'], ['chair', '餐椅', 450, 480, '#CFC6B8'],
    ['island', '岛台', 1800, 900, '#E9E5DE'], ['barstool', '吧椅', 420, 420, '#6B5D4C'],
    ['counter', '橱柜台面', 1600, 600, '#E9E5DE'], ['stove', '燃气灶', 750, 450, '#DCDCDC'],
    ['ksink', '水槽', 800, 450, '#E1E6EA'], ['fridge', '冰箱', 700, 700, '#DFE4E8'],
    ['cabinet', '餐边柜', 1600, 400, '#EFE6D8'],
  ]),
  g('卫浴', [
    ['toilet', '马桶', 400, 700, '#FFFFFF'], ['vanity', '浴室柜', 800, 500, '#EEF1F3'],
    ['vanity', '双盆浴室柜', 1200, 500, '#EEF1F3'], ['shower', '淋浴房', 900, 900, '#E4EDF2'],
    ['bathtub', '浴缸', 1600, 750, '#EEF3F6'], ['washer', '洗衣机', 600, 600, '#E6EBEE'],
    ['waterheater', '电热水器', 800, 450, '#F4F4F2'], ['cabinet', '储物柜', 1000, 400, '#EFE6D8'],
  ]),
  g('家电', [
    ['tv', '65 寸电视', 1450, 80, '#1D1D1F'], ['tv', '55 寸电视', 1230, 80, '#1D1D1F'],
    ['fridge', '对开门冰箱', 910, 700, '#C9CED3'], ['aircon', '柜机空调', 500, 380, '#F6F7F8'],
    ['acwall', '挂机空调', 900, 250, '#F6F7F8'], ['dishwasher', '洗碗机', 600, 600, '#C9CED3'],
    ['ovencol', '蒸烤箱高柜', 600, 600, '#EFE6D8'], ['dryer', '烘干机', 600, 600, '#E6EBEE'],
    ['purifier', '空气净化器', 400, 300, '#F4F4F2'],
  ]),
  g('书房 · 休闲', [
    ['desk', '长书桌', 1600, 700, '#D8C2A2'], ['officechair', '办公椅', 620, 620, '#4A4F55'],
    ['bookshelf', '大书架', 1600, 350, '#E2CFB4'], ['piano', '立式钢琴', 1500, 600, '#1F1D1B'],
    ['treadmill', '跑步机', 800, 1800, '#3A3A3C'], ['armchair', '阅读椅', 750, 800, '#C9A98A'],
  ]),
];

/** 3D 中家具的大致高度（mm） */
export const FURNITURE_HEIGHT: Record<string, number> = {
  bed: 450, crib: 900, nightstand: 500, wardrobe: 2400, dresser: 750, desk: 750, chair: 850,
  bookshelf: 2000, baycushion: 80, sofa: 800, cornersofa: 800, armchair: 800, beanbag: 450,
  coffeetable: 400, sidetable: 550, tvstand: 450, rug: 12, shoecab: 1100, floorlamp: 1600,
  plant: 1200, table: 750, roundtable: 750, island: 900, barstool: 750, counter: 850,
  stove: 870, ksink: 870, fridge: 1800, cabinet: 900, toilet: 750, vanity: 850, shower: 2000,
  bathtub: 580, washer: 850, waterheater: 450, tv: 850, aircon: 1750, acwall: 300,
  dishwasher: 850, ovencol: 2100, dryer: 850, purifier: 700, officechair: 1100, piano: 1250,
  treadmill: 1400,
};

/** 离地高度（挂墙类家具） */
export const FURNITURE_ELEVATION: Record<string, number> = {
  acwall: 2200, waterheater: 1900, tv: 600,
};

export function catalogColor(type: string): string {
  for (const group of CATALOG) for (const item of group.items) if (item.type === type) return item.color;
  return '#E5E7EB';
}
