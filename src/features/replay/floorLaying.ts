import type {MaterialId, Opening, Plan, Room, Vec2} from '../../model/types';
import {polygonCentroid} from '../../model/geometry';
import {distToSegment, liveOpenings} from '../../model/walls';

/**
 * 回放「铺地」：每个房间怎么铺。纯函数，单位 m，平面 (x, y) 对应 3D (x, z)。
 * 从离门最远的一边一排排铺向门口（铺砖工不踩刚铺的砖），每排 S 形逐块。
 * 块的边界取在世界坐标的整倍数上，和地面贴图（view3d/models 的 floorMaterial）的砖缝、板缝对齐。
 */

/** tiles：方砖；planks：木地板（沿 x 方向的长板，按排错缝）；sweep：水磨石、地毯这类整片推开 */
export type LayingKind = 'tiles' | 'planks' | 'sweep';

export interface Laying {
  kind: LayingKind;
  /** 推进方向：世界 xz 平面上的单位向量，轴向，指向门 */
  dir: Vec2;
  /** 一排的宽度（沿推进方向）和一块的长度（沿排的方向），m；sweep 时无意义 */
  rowSize: number;
  colSize: number;
  /** 第一排的全局行号 floor(p / rowSize)，p = xz·dir */
  rowStart: number;
  rows: number;
  /** 排方向上第一块的全局列号；木地板的列号按板缝偏移后算 */
  colStart: number;
  cols: number;
  /** 推进方向上的起止（p 的范围），sweep 用 */
  pStart: number;
  pEnd: number;
}

/** 木地板：一排 0.18 m，一块 1.8 m；贴图里两排的板缝分别在 x ≡ 0.6 和 1.2（mod 1.8） */
export const PLANK_ROW = 0.18;
export const PLANK_LEN = 1.8;
/** 第 k 排（k = floor(-z / 0.18)）的板缝偏移 */
export const plankJoint = (k: number) => (((k % 2) + 2) % 2 === 0 ? 0.6 : 1.2);

const TILE: Partial<Record<MaterialId, number>> = {tile800: 0.8, tile600: 0.6, antislip: 0.3, marble: 1.2};

/** 房间的门：轮廓边上的门和推拉门；多扇门时取离入户门最近的那扇（从那扇门进出） */
function roomDoor(plan: Plan, room: Room): Vec2 | null {
  const openings = liveOpenings(plan);
  const entry = openings.find((o) => o.isEntry);
  const mid = (o: Opening): Vec2 => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  const onEdge = (o: Opening) => {
    const p = mid(o);
    return room.poly.some((a, i) => distToSegment(p, a, room.poly[(i + 1) % room.poly.length]!) <= o.thickness / 2 + 150);
  };
  const doors = openings.filter((o) => o.kind !== 'window' && onEdge(o));
  if (!doors.length) return entry ? mid(entry) : null;
  if (!entry) return mid(doors[0]!);
  const e = mid(entry);
  const d2 = (o: Opening) => (mid(o)[0] - e[0]) ** 2 + (mid(o)[1] - e[1]) ** 2;
  return mid([...doors].sort((a, b) => d2(a) - d2(b))[0]!);
}

export function floorLaying(plan: Plan, room: Room): Laying {
  const poly = room.poly.map(([x, y]): Vec2 => [x / 1000, y / 1000]);
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const c = polygonCentroid(room.poly);
  const door = roomDoor(plan, room);
  const dx = door ? (door[0] - c[0]) / Math.max(1, (x1 - x0) * 1000) : 0;
  const dz = door ? (door[1] - c[1]) / Math.max(1, (z1 - z0) * 1000) : 1;

  const tile = TILE[room.material];
  const kind: LayingKind = room.material === 'wood' || room.material === 'walnut' ? 'planks' : tile ? 'tiles' : 'sweep';
  // 木地板的板沿 x 方向，只能沿 z 一排排铺；其他按门所在的主方向
  const alongZ = kind === 'planks' || Math.abs(dz) >= Math.abs(dx);
  const sign = (alongZ ? dz : dx) >= 0 ? 1 : -1;
  const dir: Vec2 = alongZ ? [0, sign] : [sign, 0];

  const ps = poly.map((p) => p[0] * dir[0] + p[1] * dir[1]);
  const qs = poly.map((p) => (alongZ ? p[0] : p[1]));
  const [pMin, pMax, qMin, qMax] = [Math.min(...ps), Math.max(...ps), Math.min(...qs), Math.max(...qs)];

  const rowSize = kind === 'planks' ? PLANK_ROW : (tile ?? 1);
  const colSize = kind === 'planks' ? PLANK_LEN : (tile ?? 1);
  const rowStart = Math.floor(pMin / rowSize);
  const rows = Math.max(1, Math.ceil(pMax / rowSize) - rowStart);
  // 木地板的列号按「x - 板缝」算，板缝最多偏 1.2 m，起点多留一块
  const colStart = Math.floor((qMin - (kind === 'planks' ? 1.2 : 0)) / colSize);
  const cols = Math.max(1, Math.ceil(qMax / colSize) - colStart);
  return {kind, dir, rowSize, colSize, rowStart, rows, colStart, cols, pStart: pMin, pEnd: pMax};
}

/** 铺设顺序（全局行列号 → 第几块），测试和着色器用同一个公式 */
export function layingOrder(l: Laying, row: number, col: number): number {
  const r = row - l.rowStart;
  const k = col - l.colStart;
  return r * l.cols + (r % 2 === 0 ? k : l.cols - 1 - k);
}

/** 一共多少块（sweep 记 1） */
export const layingCount = (l: Laying) => (l.kind === 'sweep' ? 1 : l.rows * l.cols);
