import type {P} from './draft';
import {isExterior, type BoxWall, type Mark, type MarkKind, type WallMark} from './boxes';

/**
 * 看户型图：估墙厚、方框边吸到墙线、双击自动框房间、按图猜承重墙和门窗。
 * 纯函数，输入是灰度图（0 黑 ~ 255 白），坐标是图片像素。
 */

export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

/** 比这个暗的算墙线 */
export const DARK = 110;

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    // 透明当白
    const a = rgba[j + 3]! / 255;
    const l = 0.299 * rgba[j]! + 0.587 * rgba[j + 1]! + 0.114 * rgba[j + 2]!;
    data[i] = Math.round(l * a + 255 * (1 - a));
  }
  return {w, h, data};
}

const dark = (g: Gray, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.data[y * g.w + x]! < DARK;

/**
 * 典型墙厚（像素）：沿行、列统计暗像素连续段的长度，取 ≥ 4 像素、按长度加权最常见的那个。
 * 实心墙会产生大量同样长的段；文字笔画太短，墙本身沿长度方向的段太长，都被排除。
 */
export function wallThickness(g: Gray): number | null {
  const max = Math.max(8, Math.round(Math.max(g.w, g.h) * 0.06));
  const hist = new Float64Array(max + 2);
  const scan = (n: number, len: number, at: (i: number, k: number) => boolean) => {
    for (let i = 0; i < n; i += 2) {
      let run = 0;
      for (let k = 0; k <= len; k++) {
        if (k < len && at(i, k)) run++;
        else {
          if (run >= 4 && run <= max) hist[run] = hist[run]! + run;
          run = 0;
        }
      }
    }
  };
  scan(g.h, g.w, (y, x) => g.data[y * g.w + x]! < DARK);
  scan(g.w, g.h, (x, y) => g.data[y * g.w + x]! < DARK);
  let best = 0;
  let bestV = 0;
  for (let i = 4; i <= max; i++) {
    const v = hist[i - 1]! * 0.5 + hist[i]! + hist[i + 1]! * 0.5;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best || null;
}

/**
 * 把一条方框边吸到附近墙线的中心。
 * axis 'h'：横边，at 是 y，[s0, s1] 是 x 范围；'v' 反过来。
 * 在 at ± range 内逐行算暗像素占比，找占比高的一条带，返回带中心；附近没有墙线时返回 null。
 * merge：相隔不到这么多像素的两条线算同一面墙（空心墙画成两条细线），取两条线中间。
 */
export function snapEdge(g: Gray, axis: 'h' | 'v', at: number, s0: number, s1: number, range: number, merge = 0): number | null {
  const lo = Math.round(Math.min(s0, s1));
  const hi = Math.round(Math.max(s0, s1));
  const m = Math.round((hi - lo) * 0.1);
  const [a, b] = [lo + m, hi - m];
  if (b - a < 4) return null;
  const half = Math.max(0, Math.round(merge / 2));
  // 看的范围比 range 宽一些，免得墙线被范围截掉一半、中心算偏
  const pad = Math.round(range) + half;
  const from = Math.round(at - range) - pad;
  const to = Math.round(at + range) + pad;
  const raw: number[] = [];
  for (let v = from - half; v <= to + half; v++) raw.push(lineDark(g, axis, v, a, b));
  const score: number[] = [];
  for (let i = 0; i <= to - from; i++) {
    let v = 0;
    for (let d = 0; d <= half * 2; d++) v = Math.max(v, raw[i + d]!);
    score.push(v);
  }
  // 占比高的几条带，选中心在 range 以内、离原位置近、占比又高的
  let best: number | null = null;
  let bestV = -1;
  for (let i = 0; i < score.length; i++) {
    if (score[i]! < 0.25) continue;
    let j = i;
    let top = 0;
    while (j < score.length && score[j]! >= 0.25) top = Math.max(top, score[j++]!);
    // 带内取占比到峰值一半以上的那段的中心
    let p = i;
    while (score[p]! < top * 0.5) p++;
    let q = j - 1;
    while (score[q]! < top * 0.5) q--;
    const center = from + (p + q) / 2;
    i = j;
    if (Math.abs(center - at) > range) continue;
    const v = top * (1 - (Math.abs(center - at) / (range + 1)) * 0.5);
    if (v > bestV) {
      bestV = v;
      best = center;
    }
  }
  return best;
}

/** 一行（axis 'h'，第 v 行的 [a, b]）或一列里暗像素的占比 */
function lineDark(g: Gray, axis: 'h' | 'v', v: number, a: number, b: number): number {
  let c = 0;
  for (let u = a; u <= b; u++) if (axis === 'h' ? dark(g, u, v) : dark(g, v, u)) c++;
  return c / Math.max(1, b - a + 1);
}

/** 自动框时，一条边上暗像素占比到这么多就算碰到墙（墙上开门、一侧敞开也还有四成以上） */
const WALL_HIT = 0.4;

/**
 * 双击自动框：从双击点撑开一个矩形，四条边轮流往外推一格；
 * 推出去的那一行（列）在当前跨度上暗像素占四成以上就算碰到墙，这条边停下，跨度变了再重新看。
 * 文字、门扇线这类零星的线挡不住，敞开的过道也不会让房间漏出去（只看矩形，不看连通）。
 * 停下的是墙的内侧，最后把四条边往外吸到墙中心线。推到图片边缘（点在户型外面）时返回 null。
 */
export function autoBox(g: Gray, p: P, t: number): {x0: number; y0: number; x1: number; y1: number} | null {
  const {w, h} = g;
  let px = Math.round(p[0]);
  let py = Math.round(p[1]);
  if (px < 0 || py < 0 || px >= w || py >= h) return null;
  // 点在文字或细线上：挪到附近的空白处；点在实心墙里就不框
  if (dark(g, px, py)) {
    let found = false;
    const r = Math.ceil(t * 0.6);
    for (let d = 1; d <= r && !found; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
        if (!dark(g, px + dx, py + dy)) {
          px += dx;
          py += dy;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }
  let [x0, x1, y0, y1] = [px, px, py, py];
  // 跨度太小时按 10 个墙厚（约 2.4 米）看：双击点常在房间名文字旁边，刚开始又容易从门洞漏出去
  const hit = (axis: 'h' | 'v', v: number, a: number, b: number) => {
    const c = (a + b) / 2;
    const half = Math.max((b - a) / 2, t * 5);
    return lineDark(g, axis, v, Math.round(c - half), Math.round(c + half)) >= WALL_HIT;
  };
  for (let round = 0; round < 4; round++) {
    // 撑开：四条边轮流往外推，碰到墙停
    for (let iter = 0; iter < w + h; iter++) {
      const before = [x0, x1, y0, y1].join();
      if (!hit('v', x0 - 1, y0, y1)) x0--;
      if (!hit('v', x1 + 1, y0, y1)) x1++;
      if (!hit('h', y0 - 1, x0, x1)) y0--;
      if (!hit('h', y1 + 1, x0, x1)) y1++;
      if (x0 <= 0 || y0 <= 0 || x1 >= w - 1 || y1 >= h - 1) return null;
      if ([x0, x1, y0, y1].join() === before) break;
    }
    // 收回：四边一起撑时，某条边可能趁另一方向还窄，从半开的墙（客餐厅之间这种）钻了过去。
    // 用撑完后的跨度，从双击点往外重新找第一道墙，有更近的就收回到那里，再撑一轮
    const before = [x0, x1, y0, y1].join();
    /** 从 from 一格格走到 to，下一格是墙就停在这里 */
    const firstWall = (from: number, to: number, step: 1 | -1, isWall: (v: number) => boolean) => {
      for (let v = from; v !== to; v += step) if (isWall(v + step)) return v;
      return to;
    };
    x0 = firstWall(px, x0, -1, (v) => hit('v', v, y0, y1));
    x1 = firstWall(px, x1, 1, (v) => hit('v', v, y0, y1));
    y0 = firstWall(py, y0, -1, (v) => hit('h', v, x0, x1));
    y1 = firstWall(py, y1, 1, (v) => hit('h', v, x0, x1));
    if ([x0, x1, y0, y1].join() === before) break;
  }
  if (x1 - x0 < t * 2 || y1 - y0 < t * 2) return null;
  // 内墙面往外到墙中心线：实心墙半个墙厚，空心墙两条线中间
  const snap = (axis: 'h' | 'v', v: number, s0: number, s1: number, dir: 1 | -1) =>
    snapEdge(g, axis, v + (dir * t) / 2, s0, s1, t * 0.75, t * 1.1) ?? v + (dir * t) / 2;
  return {
    x0: snap('v', x0, y0, y1, -1),
    x1: snap('v', x1, y0, y1, 1),
    y0: snap('h', y0, x0, x1, -1),
    y1: snap('h', y1, x0, x1, 1),
  };
}

/**
 * 一段墙沿长度方向，每个像素处跨过墙中心线的暗段有多厚。
 * 两头各留一个墙厚不看（墙角处是别的墙）。
 */
export function wallProfile(g: Gray, wall: BoxWall, t: number): {start: number; runs: number[]} {
  const h = wall.axis === 'h';
  const line = Math.round(h ? wall.a[1] : wall.a[0]);
  const s0 = Math.round((h ? wall.a[0] : wall.a[1]) + t);
  const s1 = Math.round((h ? wall.b[0] : wall.b[1]) - t);
  const reach = Math.ceil(t * 1.5);
  const near = t * 0.6;
  const runs: number[] = [];
  for (let s = s0; s <= s1; s++) {
    let best = 0;
    let run = 0;
    let runStart = 0;
    for (let k = -reach; k <= reach + 1; k++) {
      const isDark = k <= reach && (h ? dark(g, s, line + k) : dark(g, line + k, s));
      if (isDark) {
        if (!run) runStart = k;
        run++;
      } else if (run) {
        // 跨过或挨着中心线附近的暗段才算这面墙
        if (runStart <= near && runStart + run - 1 >= -near) best = Math.max(best, run);
        run = 0;
      }
    }
    runs.push(best);
  }
  return {start: s0, runs};
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** 连续满足条件的段：[起点下标, 长度] */
function spans(runs: number[], ok: (v: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < runs.length) {
    if (!ok(runs[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < runs.length && ok(runs[j]!)) j++;
    out.push([i, j - i]);
    i = j;
  }
  return out;
}

/**
 * 按图猜：比外墙一样粗的实心隔墙是承重墙；墙上门宽的空白缺口是门（外墙上是入户门，只取一个），
 * 很宽的缺口是推拉门；外墙上细线段是窗。t 是典型墙厚。
 */
export function guessFromImage(g: Gray, walls: readonly BoxWall[], t: number): {wallMarks: WallMark[]; marks: Omit<Mark, 'id'>[]} {
  const profiles = walls.map((w) => ({w, ...wallProfile(g, w, t)}));
  const thick = (runs: number[]) => median(runs.filter((v) => v > 0));
  const extRuns = profiles.filter((p) => isExterior(p.w) && p.runs.length > t).map((p) => thick(p.runs));
  const ref = Math.max(median(extRuns.filter((v) => v > 0)), t * 0.5) || t;

  const wallMarks: WallMark[] = [];
  const marks: Omit<Mark, 'id'>[] = [];
  const entries: {at: P; score: number}[] = [];
  const point = (w: BoxWall, s: number): P => (w.axis === 'h' ? [s, w.a[1]] : [w.a[0], s]);

  for (const {w, start, runs} of profiles) {
    if (runs.length < 2) continue;
    const ext = isExterior(w);
    const solid = runs.filter((v) => v > 0);
    if (!ext && solid.length > runs.length * 0.4 && thick(runs) >= ref * 0.75 && solid.filter((v) => v >= ref * 0.6).length >= solid.length * 0.6) {
      wallMarks.push({at: point(w, start + runs.length / 2), kind: 'bearing', guessed: true});
    }
    // 大半段都空着、又比门宽得多：图上这两个房间之间没有墙（客餐厅这类），猜成敞开
    const empty = runs.filter((v) => v === 0).length;
    if (!ext && empty > runs.length * 0.6 && empty > 6 * ref) {
      wallMarks.push({at: point(w, start + runs.length / 2), kind: 'open', guessed: true});
      continue;
    }
    // 空白缺口
    for (const [i, n] of spans(runs, (v) => v === 0)) {
      const at = point(w, start + i + n / 2);
      if (n >= 2.2 * ref && n <= 6 * ref) {
        if (ext) entries.push({at, score: Math.abs(n - 4 * ref)});
        else marks.push({kind: 'door', at, guessed: true});
      } else if (n > 6 * ref && !ext) marks.push({kind: 'slidingDoor', at, guessed: true});
    }
    // 细线段：外墙上是窗（很长的是推拉门），实心隔墙上是推拉门。
    // 只看画成实心的墙：空心墙本来就是细线，门洞两边也是
    const thin = (v: number) => v > 0 && v < ref * 0.45;
    const solidRuns = runs.filter((v) => v > 0).sort((a, b) => a - b);
    if ((solidRuns[Math.floor(solidRuns.length * 0.75)] ?? 0) >= ref * 0.6) {
      for (const [i, n] of spans(runs, thin)) {
        const at = point(w, start + i + n / 2);
        if (ext && n >= 2 * ref) marks.push({kind: n > 9 * ref ? 'slidingDoor' : ('window' as MarkKind), at, guessed: true});
        else if (!ext && n >= 3 * ref) marks.push({kind: 'slidingDoor', at, guessed: true});
      }
    }
  }
  const entry = entries.sort((a, b) => a.score - b.score)[0];
  if (entry) marks.push({kind: 'entry', at: entry.at, guessed: true});
  return {wallMarks, marks};
}
