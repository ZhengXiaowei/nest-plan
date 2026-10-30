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
  /** 比这个暗的算墙线；不给就是 DARK。灰色墙的图（很多 App 的户型图）会调高 */
  ink?: number;
  /** 每个像素有多「彩」（RGB 最大减最小）。很多图窗户画成蓝色的一段墙 */
  tint?: Uint8Array;
  /** 去掉文字后的墙线（1 是墙线），第一次用到时算 */
  mask?: Uint8Array;
  /** 户型主体（最大一块连通的线）的范围，自动框推到这里就停 */
  bounds?: Rect;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Comp extends Rect {
  /** 像素数 */
  n: number;
}

/** 暗像素的连通块（8 邻接）：每块的范围和像素数，labels 里是块号 +1 */
function components(on: Uint8Array, w: number, h: number): {labels: Int32Array; comps: Comp[]} {
  const labels = new Int32Array(w * h);
  const comps: Comp[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c: Comp = {x0: w, y0: h, x1: -1, y1: -1, n: 0};
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const i = stack[--top]!;
      const x = i % w;
      const y = (i - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (on[j] && !labels[j]) {
            labels[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    comps.push(c);
  }
  return {labels, comps};
}

const union = (rs: readonly Rect[]): Rect => ({
  x0: Math.min(...rs.map((r) => r.x0)),
  y0: Math.min(...rs.map((r) => r.y0)),
  x1: Math.max(...rs.map((r) => r.x1)),
  y1: Math.max(...rs.map((r) => r.y1)),
});

const inkOf = (g: Gray) => {
  const lim = g.ink ?? DARK;
  const on = new Uint8Array(g.w * g.h);
  for (let i = 0; i < on.length; i++) on[i] = g.data[i]! < lim ? 1 : 0;
  return on;
};

/**
 * 算墙线图：去掉文字（不到两个墙厚长的小块；虚线的一节节也一起去掉，赠送面积那种虚线本来就不是墙），
 * 再找出户型主体的范围。
 * 文字会挡住自动框，房间小、字大的图（App 截图）尤其明显。
 */
export function prepare(g: Gray, t?: number): Gray {
  if (g.mask && g.bounds) return g;
  const t0 = t ?? wallThickness(g) ?? 8;
  const on = inkOf(g);
  const {labels, comps} = components(on, g.w, g.h);
  const text = comps.map((c) => Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1 <= t0 * 2);
  // 虚线（赠送面积、阳台边线）的一节节留着：细长、同一条线上至少连着三节。房间边界常画成虚线
  const dash = comps.map((c, i) => {
    const [bw, bh] = [c.x1 - c.x0 + 1, c.y1 - c.y0 + 1];
    return text[i]! && Math.max(bw, bh) >= Math.min(bw, bh) * 2.5 && Math.min(bw, bh) <= t0 * 0.5;
  });
  const idx = comps.map((_, i) => i).filter((i) => dash[i]);
  const buckets = new Map<string, number[]>();
  const keyOf = (c: Comp, d = 0) => {
    const hz = c.x1 - c.x0 >= c.y1 - c.y0;
    return `${hz ? 'h' : 'v'}${Math.round((hz ? c.y0 + c.y1 : c.x0 + c.x1) / 6) + d}`;
  };
  for (const i of idx) buckets.set(keyOf(comps[i]!), [...(buckets.get(keyOf(comps[i]!)) ?? []), i]);
  const nb = new Map<number, number[]>();
  for (const i of idx) {
    const c = comps[i]!;
    const hz = c.x1 - c.x0 >= c.y1 - c.y0;
    const len = hz ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1;
    const near: number[] = [];
    for (const d of [-1, 0, 1]) {
      for (const j of buckets.get(keyOf(c, d)) ?? []) {
        if (j === i) continue;
        const o = comps[j]!;
        const off = hz ? Math.abs(o.y0 + o.y1 - c.y0 - c.y1) / 2 : Math.abs(o.x0 + o.x1 - c.x0 - c.x1) / 2;
        const gap = hz ? Math.max(o.x0 - c.x1, c.x0 - o.x1) : Math.max(o.y0 - c.y1, c.y0 - o.y1);
        if (off <= 3 && gap > 0 && gap <= len * 2.5) near.push(j);
      }
    }
    nb.set(i, near);
  }
  for (const i of idx) {
    const near = nb.get(i)!;
    if (near.length >= 2 || near.some((j) => nb.get(j)!.length >= 2)) text[i] = false;
  }
  for (let i = 0; i < on.length; i++) if (on[i] && text[labels[i]! - 1]) on[i] = 0;
  // 主体：墙这种粗线连成的块（一圈外墙可能被虚线、门洞断成几块，都算上）；尺寸标注是细线，不算
  const thick = comps.filter((c, i) => {
    const hi = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
    return !text[i] && hi >= t0 * 6 && c.n / hi >= t0 * 0.4;
  });
  const area = (c: Rect) => (c.x1 - c.x0) * (c.y1 - c.y0);
  const main = thick.reduce<Comp | null>((a, c) => (!a || area(c) > area(a) ? c : a), null);
  // 图例里的色块这种离得远的不算
  const near = (c: Rect) => main && c.x1 >= main.x0 - t0 * 6 && c.x0 <= main.x1 + t0 * 6 && c.y1 >= main.y0 - t0 * 6 && c.y0 <= main.y1 + t0 * 6;
  const body = thick.filter(near);
  g.mask = on;
  g.bounds = body.length ? union(body) : {x0: 0, y0: 0, x1: g.w - 1, y1: g.h - 1};
  return g;
}

/**
 * 截图里户型图那一块：最大的一片线（不算大色块，比如按钮、标签栏），
 * 再带上旁边的尺寸标注。找不到、或者已经占了大半张图时返回 null。
 */
export function planRegion(g: Gray): Rect | null {
  const {comps} = components(inkOf(g), g.w, g.h);
  const area = (c: Rect) => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
  let main: Comp | null = null;
  for (const c of comps) if (c.n < area(c) * 0.35 && area(c) > g.w * g.h * 0.03 && (!main || area(c) > area(main))) main = c;
  if (!main) return null;
  // 带上主体旁边的东西：先是贴着的（另一半外墙、房间名），再是外面一圈细长的尺寸线
  const within = (c: Rect, r: Rect, k: number) => {
    const [ex, ey] = [(r.x1 - r.x0) * k, (r.y1 - r.y0) * k];
    return c.x0 >= r.x0 - ex && c.x1 <= r.x1 + ex && c.y0 >= r.y0 - ey && c.y1 <= r.y1 + ey;
  };
  const m: Comp = main;
  let r = union(comps.filter((c) => within(c, m, 0.2)));
  // 尺寸线：细（像素数 / 长度很小）、长
  const lineLike = (c: Comp) => {
    const hi = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
    return hi >= Math.max(m.x1 - m.x0, m.y1 - m.y0) * 0.3 && c.n / hi <= 8;
  };
  const r1 = r;
  r = union([r1, ...comps.filter((c) => lineLike(c) && within(c, r1, 0.2))]);
  const pad = Math.round(Math.max(r.x1 - r.x0, r.y1 - r.y0) * 0.03);
  const out = {x0: Math.max(0, r.x0 - pad), y0: Math.max(0, r.y0 - pad), x1: Math.min(g.w, r.x1 + pad + 1), y1: Math.min(g.h, r.y1 + pad + 1)};
  return area(out) < g.w * g.h * 0.75 ? out : null;
}

/** 黑线户型图里，比这个暗的算墙线 */
export const DARK = 110;

/**
 * 按图定墙线阈值。很多户型图墙画成灰色（亮度 150 上下），房间铺浅色底（190 以上）。
 * 看亮度直方图：120~190 之间有一个明显的峰（灰墙），右边又有一个谷，阈值放在谷底；
 * 没有这样的峰（黑线图）就用 DARK。
 */
export function inkLevel(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i += 3) hist[data[i]!]!++;
  const sm = (i: number) => {
    let v = 0;
    for (let d = -4; d <= 4; d++) v += hist[Math.min(255, Math.max(0, i + d))]!;
    return v / 9;
  };
  const s = Array.from({length: 256}, (_, i) => sm(i));
  let peak = -1;
  for (let i = 125; i <= 185; i++) if (s[i]! >= s[i - 1]! && s[i]! >= s[i + 1]! && (peak < 0 || s[i]! > s[peak]!)) peak = i;
  if (peak < 0) return DARK;
  // 峰右边 45 以内找谷
  let valley = peak;
  for (let i = peak; i <= Math.min(205, peak + 45); i++) if (s[i]! < s[valley]!) valley = i;
  // 峰要明显：比谷高一倍以上，还要比更暗处（黑线、文字的抗锯齿）平均高
  const below = s.slice(60, 120).reduce((a, b) => a + b, 0) / 60;
  if (valley === peak || s[peak]! < s[valley]! * 2 || s[peak]! < below * 2) return DARK;
  return valley;
}

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    // 透明当白
    const a = rgba[j + 3]! / 255;
    const [r, gg, b] = [rgba[j]!, rgba[j + 1]!, rgba[j + 2]!];
    const l = 0.299 * r + 0.587 * gg + 0.114 * b;
    data[i] = Math.round(l * a + 255 * (1 - a));
    tint[i] = Math.round((Math.max(r, gg, b) - Math.min(r, gg, b)) * a);
  }
  return {w, h, data, tint, ink: inkLevel(data)};
}

/** 墙线像素（先 prepare） */
const dark = (g: Gray, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.mask![y * g.w + x] === 1;

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
  const ink = g.ink ?? DARK;
  scan(g.h, g.w, (y, x) => g.data[y * g.w + x]! < ink);
  scan(g.w, g.h, (x, y) => g.data[y * g.w + x]! < ink);
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
  prepare(g);
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

/**
 * 一行（axis 'h'，第 v 行的 [a, b]）或一列里暗像素的占比。
 * close > 0 时把墙上的门洞补上再算：顺着这条线的一段墙（长过 1.5 个墙厚、厚过 0.4 个墙厚）旁边、
 * 不到 5 个墙厚的空白算墙。横穿过去的墙只有一个墙厚长，过道两边的墙不会被连起来；
 * 家具、尺寸这种细线也不算。
 */
function lineDark(g: Gray, axis: 'h' | 'v', v: number, a: number, b: number, close = 0): number {
  if (!close) {
    let c = 0;
    for (let u = a; u <= b; u++) if (axis === 'h' ? dark(g, u, v) : dark(g, v, u)) c++;
    return c / Math.max(1, b - a + 1);
  }
  const runs: [number, number][] = [];
  let start = -1;
  for (let u = a; u <= b + 1; u++) {
    const on = u <= b && (axis === 'h' ? dark(g, u, v) : dark(g, v, u));
    if (on && start < 0) start = u;
    else if (!on && start >= 0) {
      runs.push([start, u - start]);
      start = -1;
    }
  }
  /** 这段沿线的墙够不够厚（在段中间量垂直方向的暗像素） */
  const solid = ([s0, n]: [number, number]) => {
    if (n < close * 1.5) return false;
    const u = s0 + Math.floor(n / 2);
    const at = (k: number) => (axis === 'h' ? dark(g, u, v + k) : dark(g, v + k, u));
    let k0 = 0;
    while (k0 > -close && at(k0 - 1)) k0--;
    let k1 = 0;
    while (k1 < close && at(k1 + 1)) k1++;
    return k1 - k0 + 1 >= close * 0.4;
  };
  let c = 0;
  runs.forEach((r, i) => {
    c += r[1];
    const next = runs[i + 1];
    if (!next) return;
    const gap = next[0] - (r[0] + r[1]);
    if (gap <= close * 5 && (solid(r) || solid(next))) c += gap;
  });
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
  prepare(g, t);
  const bd = g.bounds!;
  let px = Math.round(p[0]);
  let py = Math.round(p[1]);
  // 户型主体外面（尺寸标注、空白处）不框
  if (px <= bd.x0 || py <= bd.y0 || px >= bd.x1 || py >= bd.y1) return null;
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
  // 推到户型主体边上也停（外圈是虚线、颜色太浅时，别一路推到尺寸标注上去）
  const hit = (axis: 'h' | 'v', v: number, a: number, b: number) => {
    if (axis === 'v' ? v <= bd.x0 || v >= bd.x1 : v <= bd.y0 || v >= bd.y1) return true;
    const c = (a + b) / 2;
    const half = Math.max((b - a) / 2, t * 5);
    return lineDark(g, axis, v, Math.round(c - half), Math.round(c + half), t) >= WALL_HIT;
  };
  for (let round = 0; round < 4; round++) {
    // 撑开：四条边轮流往外推，碰到墙停
    for (let iter = 0; iter < g.w + g.h; iter++) {
      const before = [x0, x1, y0, y1].join();
      if (!hit('v', x0 - 1, y0, y1)) x0--;
      if (!hit('v', x1 + 1, y0, y1)) x1++;
      if (!hit('h', y0 - 1, x0, x1)) y0--;
      if (!hit('h', y1 + 1, x0, x1)) y1++;
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
  // 停在户型边上的（外圈是虚线、颜色浅）：在附近找线，找不到就停在原处
  const atBound = (axis: 'h' | 'v', v: number) => (axis === 'v' ? v <= bd.x0 + 1 || v >= bd.x1 - 1 : v <= bd.y0 + 1 || v >= bd.y1 - 1);
  const snap = (axis: 'h' | 'v', v: number, s0: number, s1: number, dir: 1 | -1) =>
    atBound(axis, v + dir)
      ? (snapEdge(g, axis, v, s0, s1, t * 1.5, t * 0.5) ?? v)
      : (snapEdge(g, axis, v + (dir * t) / 2, s0, s1, t * 0.75, t * 1.1) ?? v + (dir * t) / 2);
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
  prepare(g, t);
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

/**
 * 墙上涂了颜色的段（[相对 wallProfile 起点的下标, 长度]）：墙线像素里四成以上是彩色的位置，
 * 虚线式的断续（不到一个墙厚的空隙）连起来，至少两个墙厚长。
 */
function colorSpans(g: Gray, wall: BoxWall, t: number, ref: number): [number, number][] {
  const h = wall.axis === 'h';
  const line = Math.round(h ? wall.a[1] : wall.a[0]);
  const s0 = Math.round((h ? wall.a[0] : wall.a[1]) + t);
  const s1 = Math.round((h ? wall.b[0] : wall.b[1]) - t);
  const r = Math.max(1, Math.round(t / 2));
  const on: boolean[] = [];
  for (let s = s0; s <= s1; s++) {
    let ink = 0;
    let col = 0;
    for (let k = -r; k <= r; k++) {
      const [x, y] = h ? [s, line + k] : [line + k, s];
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const i = y * g.w + x;
      if (!g.mask![i]) continue;
      ink++;
      if (g.tint![i]! > 60) col++;
    }
    on.push(col >= 2 && col >= ink * 0.4);
  }
  // 补上虚线的空隙
  let last = -1;
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    if (last >= 0 && i - last > 1 && i - last <= ref) for (let j = last + 1; j < i; j++) on[j] = true;
    last = i;
  }
  return spans(on.map((v) => (v ? 1 : 0)), (v) => v === 1).filter(([, n]) => n >= ref * 2);
}

/** 墙中心线附近墙线像素的亮度中位数；墙线太少返回 null */
function wallTone(g: Gray, wall: BoxWall, t: number): number | null {
  const h = wall.axis === 'h';
  const line = Math.round(h ? wall.a[1] : wall.a[0]);
  const s0 = Math.round((h ? wall.a[0] : wall.a[1]) + t);
  const s1 = Math.round((h ? wall.b[0] : wall.b[1]) - t);
  const r = Math.max(1, Math.round(t / 4));
  const vals: number[] = [];
  for (let s = s0; s <= s1; s++) {
    for (let k = -r; k <= r; k++) {
      const [x, y] = h ? [s, line + k] : [line + k, s];
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (g.mask![y * g.w + x]) vals.push(g.data[y * g.w + x]!);
    }
  }
  if (vals.length < t * 2) return null;
  return median(vals);
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

/** 房间名里带这些字的，和旁边房间之间一定有墙（不会是敞开的） */
const CLOSED_ROOM = /卧|卫|厨|书房|儿童|衣帽|洗衣|浴|储/;

/**
 * 按图猜：承重墙（墙有黑灰两种颜色时按颜色，否则按粗细：比外墙一样粗的实心隔墙）；
 * 墙上门宽的空白缺口是门（外墙上是入户门，只取一个，优先朝着户型外面的），很宽的缺口是推拉门；
 * 外墙上细线段是窗；大半段空着的隔墙是敞开（卧室、卫生间、厨房这类除外）。t 是典型墙厚。
 * names：方框 id → 房间名。同一条直线上相连的几段墙连起来找门洞，门洞跨在两段墙交界处也认得出。
 */
export function guessFromImage(g: Gray, walls: readonly BoxWall[], t: number, names?: ReadonlyMap<string, string>): {wallMarks: WallMark[]; marks: Omit<Mark, 'id'>[]} {
  prepare(g, t);
  const profiles = walls.map((w) => ({w, ...wallProfile(g, w, t)}));
  const thick = (runs: number[]) => median(runs.filter((v) => v > 0));
  const extRuns = profiles.filter((p) => isExterior(p.w) && p.runs.length > t).map((p) => thick(p.runs));
  const ref = Math.max(median(extRuns.filter((v) => v > 0)), t * 0.5) || t;
  const nameOf = (id: string | null) => (id ? names?.get(id) ?? '' : '');
  const closed = (w: BoxWall) => CLOSED_ROOM.test(nameOf(w.sides[0])) || CLOSED_ROOM.test(nameOf(w.sides[1]));
  const balcony = (w: BoxWall) => /阳台/.test(nameOf(w.sides[0]) + nameOf(w.sides[1]));

  // 墙的颜色：很多图承重墙涂黑、其余墙灰色。墙有深浅两种时按颜色认承重墙，不看粗细
  const tones = profiles.map(({w}) => wallTone(g, w, t));
  const known = tones.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const lo = known[Math.floor(known.length * 0.1)] ?? 0;
  const hi = known[Math.floor(known.length * 0.9)] ?? 0;
  const twoTone = known.length >= 3 && hi - lo >= 60;
  const bd = g.bounds!;
  /** 从墙上这一点往没框的那一侧看出去，一直到户型边上都没有墙：真在户型外圈上（入户门多半在这里），不是还没框的房间 */
  const facesOutside = (w: BoxWall, at: P) => {
    const dir = w.sides[0] ? 1 : -1;
    const h = w.axis === 'h';
    const [x, y] = [Math.round(at[0]), Math.round(at[1])];
    const end = h ? (dir > 0 ? bd.y1 : bd.y0) : dir > 0 ? bd.x1 : bd.x0;
    for (let v = (h ? y : x) + dir * Math.round(t); dir > 0 ? v <= end : v >= end; v += dir) {
      for (let k = -1; k <= 1; k++) if (h ? dark(g, x + k, v) : dark(g, v, y + k)) return false;
    }
    return true;
  };

  const wallMarks: WallMark[] = [];
  const marks: Omit<Mark, 'id'>[] = [];
  const entries: {at: P; score: number}[] = [];
  const point = (w: BoxWall, s: number): P => (w.axis === 'h' ? [s, w.a[1]] : [w.a[0], s]);
  const noWall = new Set<string>();

  for (const [k, {w, start, runs}] of profiles.entries()) {
    if (w.sameRoom) {
      noWall.add(w.id);
      continue;
    }
    if (runs.length < 2) continue;
    const ext = isExterior(w);
    const solid = runs.filter((v) => v > 0);
    const tone = tones[k];
    const bearing = twoTone
      ? tone !== null && tone! < (lo + hi) / 2 && solid.length > runs.length * 0.4
      : solid.length > runs.length * 0.4 && thick(runs) >= ref * 0.75 && solid.filter((v) => v >= ref * 0.6).length >= solid.length * 0.6;
    if (!ext && bearing) {
      wallMarks.push({at: point(w, start + runs.length / 2), kind: 'bearing', guessed: true});
    }
    // 大半段都空着、又比门宽得多：图上这两个房间之间没有墙（客餐厅这类），猜成敞开
    const empty = runs.filter((v) => v === 0).length;
    if (!ext && !closed(w) && empty > runs.length * 0.6 && empty > 6 * ref) {
      wallMarks.push({at: point(w, start + runs.length / 2), kind: 'open', guessed: true});
      noWall.add(w.id);
      continue;
    }
    // 外墙上涂了颜色的一段（常见画法：窗画成蓝色）是窗
    const colored = ext && g.tint ? colorSpans(g, w, t, ref) : [];
    for (const [i, n] of colored) marks.push({kind: 'window', at: point(w, start + i + n / 2), guessed: true});
    // 外圈上大半段没有实墙（只有虚线、浅色线）：阳台、飘窗那种整面玻璃，猜成窗
    const mid = point(w, start + runs.length / 2);
    if (ext && !colored.length && runs.length >= 8 * ref && runs.filter((v) => v < ref * 0.45).length > runs.length * 0.6 && facesOutside(w, mid)) {
      marks.push({kind: 'window', at: mid, guessed: true});
    }
    // 细线段：外墙上是窗（很长的是推拉门），实心隔墙上是推拉门。
    // 只看画成实心的墙：空心墙本来就是细线，门洞两边也是
    const thin = (v: number) => v > 0 && v < ref * 0.45;
    const solidRuns = solid.sort((a, b) => a - b);
    if ((solidRuns[Math.floor(solidRuns.length * 0.75)] ?? 0) >= ref * 0.6) {
      for (const [i, n] of spans(runs, thin)) {
        const at = point(w, start + i + n / 2);
        if (ext && n >= 2 * ref) marks.push({kind: n > 9 * ref ? 'slidingDoor' : ('window' as MarkKind), at, guessed: true});
        else if (!ext && n >= 3 * ref) marks.push({kind: 'slidingDoor', at, guessed: true});
      }
    }
  }

  // 空白缺口：同一条线上相连的墙连成一条看
  const along = (w: BoxWall): [number, number, number] => (w.axis === 'h' ? [w.a[1], w.a[0], w.b[0]] : [w.a[0], w.a[1], w.b[1]]);
  const sorted = [...walls].sort((p, q) => (p.axis === q.axis ? Math.round(along(p)[0]) - Math.round(along(q)[0]) || along(p)[1] - along(q)[1] : p.axis < q.axis ? -1 : 1));
  const chains: BoxWall[][] = [];
  for (const w of sorted) {
    const last = chains.at(-1);
    const prev = last?.at(-1);
    if (prev && prev.axis === w.axis && Math.abs(along(prev)[0] - along(w)[0]) < 1 && Math.abs(along(prev)[2] - along(w)[1]) < 1) last!.push(w);
    else chains.push([w]);
  }
  for (const chain of chains) {
    const first = chain[0]!;
    const span: BoxWall = {...first, b: chain.at(-1)!.b};
    const {start, runs} = wallProfile(g, span, t);
    for (const [i, n] of spans(runs, (v) => v === 0)) {
      const s = start + i + n / 2;
      const w = chain.find((x) => along(x)[1] <= s && along(x)[2] >= s)!;
      if (!w || noWall.has(w.id)) continue;
      const at = point(w, s);
      const ext = isExterior(w);
      if (n >= 2.2 * ref && n <= 6 * ref) {
        if (ext) entries.push({at, score: Math.abs(n - 4 * ref) + (facesOutside(w, at) ? 0 : 1000)});
        else marks.push({kind: 'door', at, guessed: true});
      } else if (n > 6 * ref && !ext) marks.push({kind: closed(w) && !balcony(w) ? 'door' : 'slidingDoor', at, guessed: true});
    }
  }
  const entry = entries.sort((a, b) => a.score - b.score)[0];
  if (entry) marks.push({kind: 'entry', at: entry.at, guessed: true});
  return {wallMarks, marks};
}
