/**
 * 平面图外圈尺寸标注：四边各两道，里面一道按墙分段，外面一道是总长。
 * 只看横平竖直的墙；每一边取「从外面看过去最先碰到的墙」，再把连到这些墙上的
 * 主要墙体的墙面投影到这条边上作为分段点。
 */
import type {Wall} from './types';

export interface DimChain {
  /** 水平的一道（标在上下两边） */
  horiz: boolean;
  /** 这道线所在的 y（水平）或 x（竖直） */
  at: number;
  /** 分段点，从小到大 */
  ticks: number[];
  /** 文字放在线的哪一侧：-1 往坐标小的一侧 */
  side: -1 | 1;
}

const INNER = 750;
const OUTER = 1300;
const EPS = 2;
/** 比这薄的隔墙不进尺寸线，免得太碎 */
const MIN_T = 180;

type Seg = {u0: number; u1: number; v: number; t: number};

/** 只按毛坯的墙标注，改造新砌的墙不算 */
export function dimensionChains(allWalls: readonly Wall[]): DimChain[] {
  const walls = allWalls.filter((w) => !w.added && w.kind !== 'low');
  if (!walls.length) return [];
  const horiz = walls.filter((w) => Math.abs(w.a[1] - w.b[1]) < EPS);
  const vert = walls.filter((w) => Math.abs(w.a[0] - w.b[0]) < EPS);
  const out: DimChain[] = [];

  // 四个方向统一换成 (u 沿边, v 越小越靠外) 来算
  const sides = [
    {horiz: true, sign: 1, along: horiz, across: vert, u: 0, v: 1},
    {horiz: true, sign: -1, along: horiz, across: vert, u: 0, v: 1},
    {horiz: false, sign: 1, along: vert, across: horiz, u: 1, v: 0},
    {horiz: false, sign: -1, along: vert, across: horiz, u: 1, v: 0},
  ] as const;

  for (const s of sides) {
    const toSeg = (w: Wall): Seg => {
      const a = w.a[s.u]!;
      const b = w.b[s.u]!;
      return {u0: Math.min(a, b), u1: Math.max(a, b), v: w.a[s.v]! * s.sign, t: w.thickness};
    };
    const along = s.along.map(toSeg);
    if (!along.length) continue;
    const lo = Math.min(...along.map((g) => g.u0 - g.t / 2));
    const hi = Math.max(...along.map((g) => g.u1 + g.t / 2));

    // 沿边每 50mm 取一次最靠外的墙
    const facade = new Set<Seg>();
    for (let u = lo; u <= hi; u += 50) {
      let best: Seg | null = null;
      for (const g of along) if (u >= g.u0 - g.t / 2 && u <= g.u1 + g.t / 2 && (!best || g.v < best.v)) best = g;
      if (best) facade.add(best);
    }
    const front = [...facade];
    const outerV = Math.min(...front.map((g) => g.v - g.t / 2));

    const ticks: number[] = [];
    const on = (u: number, v: number) => front.some((g) => u >= g.u0 - g.t && u <= g.u1 + g.t && Math.abs(v - g.v) <= g.t);
    // 连到外墙上的主要墙体（不算薄隔墙）：两个墙面
    for (const w of s.across) {
      if (w.thickness < MIN_T) continue;
      const u = w.a[s.u]!;
      const ends = [w.a[s.v]! * s.sign, w.b[s.v]! * s.sign];
      if (ends.some((v) => on(u, v))) ticks.push(u - w.thickness / 2, u + w.thickness / 2);
    }
    // 两端没有墙相交时，用外墙自己的端点
    if (ticks.length < 2) ticks.push(lo, hi);
    ticks.sort((a, b) => a - b);
    const merged: number[] = [];
    for (const t of ticks) if (!merged.length || t - merged.at(-1)! > 30) merged.push(Math.round(t));
    if (merged.length < 2) continue;

    const at = (v: number) => v * s.sign;
    out.push({horiz: s.horiz, at: at(outerV - INNER), ticks: merged, side: s.sign === 1 ? -1 : 1});
    out.push({horiz: s.horiz, at: at(outerV - OUTER), ticks: [merged[0]!, merged.at(-1)!], side: s.sign === 1 ? -1 : 1});
  }
  return out;
}
