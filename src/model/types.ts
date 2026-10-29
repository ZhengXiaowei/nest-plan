/**
 * 栖图户型数据模型。
 * 单位一律为毫米（mm），坐标系 x 向右、y 向下，原点由户型自身决定。
 * 3D 场景里换算成米，y 轴朝上，平面坐标 (x, y) 映射到 (x, z)。
 */

export type Vec2 = readonly [x: number, y: number];

/** 承重墙 / 外墙 / 可拆非承重墙 / 矮墙 */
export type WallKind = 'bearing' | 'exterior' | 'partition' | 'low';

export interface Wall {
  id: string;
  /** 墙体中心线起点 */
  a: Vec2;
  /** 墙体中心线终点 */
  b: Vec2;
  thickness: number;
  kind: WallKind;
  /** 不填则使用 plan.wallHeight；矮墙默认 1000 */
  height?: number;
  /** 改造时新砌的墙（毛坯里没有） */
  added?: boolean;
}

/** 平面图上的测量线 */
export interface Measure {
  id: string;
  a: Vec2;
  b: Vec2;
}

export type OpeningKind = 'window' | 'door' | 'slidingDoor';

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** 洞口中心线起点 */
  a: Vec2;
  /** 洞口中心线终点 */
  b: Vec2;
  /** 洞口所在墙厚 */
  thickness: number;
  name?: string;
  /** 窗台高（窗） */
  sill?: number;
  /** 洞口顶高 */
  head?: number;
  /** 平开门：铰链点、门扇关闭方向、开启方向 */
  swing?: {hinge: Vec2; closed: Vec2; open: Vec2; leaf: number};
  isEntry?: boolean;
}

export type MaterialId =
  | 'wood'
  | 'walnut'
  | 'tile800'
  | 'tile600'
  | 'marble'
  | 'antislip'
  | 'terrazzo'
  | 'carpet';

export interface Material {
  name: string;
  /** 元 / ㎡（含辅料的粗估单价） */
  price: number;
  swatch: string;
}

export interface Room {
  id: string;
  name: string;
  /** 内轮廓多边形，顺时针或逆时针均可 */
  poly: Vec2[];
  material: MaterialId;
  /** 名称标注位置，不填取多边形中心 */
  labelAt?: Vec2;
  /** false 表示不计入面积和预算（例如飘窗） */
  counted?: boolean;
}

export interface Furniture {
  id: string;
  type: string;
  name: string;
  cx: number;
  cy: number;
  /** 宽（局部 x） */
  w: number;
  /** 深（局部 y） */
  d: number;
  /** 旋转角度，顺时针，单位度 */
  rot: number;
  color: string;
}

export interface PlanSource {
  /** 'sample' 示例户型；'image' 来自图片还原；'dxf' 来自 CAD */
  kind: 'sample' | 'image' | 'dxf' | 'blank';
  /** 图片还原时的标定比例：1 像素 = ? mm */
  mmPerPixel?: number;
  note?: string;
}

export interface Plan {
  version: 1;
  id: string;
  name: string;
  wallHeight: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: Furniture[];
  /** 改造时拆除的墙 id（只能是非承重墙），用于改造回放 */
  demolished: string[];
  measures: Measure[];
  source: PlanSource;
}
