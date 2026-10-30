import type {Plan} from '../../../model/types';
import type {Gray} from '../imageScan';

/**
 * 测试用：把户型画成一张「户型图」灰度图，画法和常见售楼户型图一样：
 * 承重墙、外墙实心黑；隔墙空心（两条细线）；门是墙上的缺口加一条门扇线；窗是三条细线；
 * 推拉门是缺口里两条错开的细线；房间里有几块文字一样的小黑块。
 * scale：每毫米多少像素；margin：留白像素。
 */
export function rasterPlan(plan: Plan, scale = 0.1, margin = 60): {g: Gray; toPx: (x: number, y: number) => [number, number]} {
  const xs = plan.walls.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = plan.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const [ox, oy] = [Math.min(...xs) - 300, Math.min(...ys) - 300];
  const w = Math.ceil((Math.max(...xs) - ox + 300) * scale) + margin * 2;
  const h = Math.ceil((Math.max(...ys) - oy + 300) * scale) + margin * 2;
  const g: Gray = {w, h, data: new Uint8Array(w * h).fill(255)};
  const toPx = (x: number, y: number): [number, number] => [(x - ox) * scale + margin, (y - oy) * scale + margin];

  const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    const [a, b] = [Math.round(Math.min(x0, x1)), Math.round(Math.max(x0, x1))];
    const [c, d] = [Math.round(Math.min(y0, y1)), Math.round(Math.max(y0, y1))];
    for (let y = Math.max(0, c); y < Math.min(h, d); y++) for (let x = Math.max(0, a); x < Math.min(w, b); x++) g.data[y * w + x] = v;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, v: number, width = 1.5) => {
    if (Math.abs(y1 - y0) < Math.abs(x1 - x0)) fill(x0, y0 - width / 2, x1, y0 + width / 2, v);
    else fill(x0 - width / 2, y0, x0 + width / 2, y1, v);
  };
  /** 墙或洞口的矩形（像素） */
  const rectOf = (a: readonly [number, number], b: readonly [number, number], t: number) => {
    const [p, q] = [toPx(a[0], a[1]), toPx(b[0], b[1])];
    const half = (t * scale) / 2;
    return Math.abs(q[1] - p[1]) < Math.abs(q[0] - p[0])
      ? {h: true, x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: p[1] - half, y1: p[1] + half, c: p[1]}
      : {h: false, x0: p[0] - half, x1: p[0] + half, y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]), c: p[0]};
  };

  for (const wall of plan.walls) {
    const r = rectOf(wall.a, wall.b, wall.thickness);
    if (wall.kind === 'bearing' || wall.kind === 'exterior') fill(r.x0, r.y0, r.x1, r.y1, wall.kind === 'bearing' ? 20 : 45);
    else if (r.h) {
      line(r.x0, r.y0, r.x1, r.y0, 40);
      line(r.x0, r.y1, r.x1, r.y1, 40);
    } else {
      line(r.x0, r.y0, r.x0, r.y1, 40);
      line(r.x1, r.y0, r.x1, r.y1, 40);
    }
  }
  for (const o of plan.openings) {
    const r = rectOf(o.a, o.b, o.thickness + 10);
    fill(r.x0, r.y0, r.x1, r.y1, 255);
    const along = (off: number, s0 = 0, s1 = 1) =>
      r.h
        ? line(r.x0 + (r.x1 - r.x0) * s0, r.c + off, r.x0 + (r.x1 - r.x0) * s1, r.c + off, 70, 1)
        : line(r.c + off, r.y0 + (r.y1 - r.y0) * s0, r.c + off, r.y0 + (r.y1 - r.y0) * s1, 70, 1);
    const t = (o.thickness * scale) / 2;
    if (o.kind === 'window') for (const off of [-t * 0.7, 0, t * 0.7]) along(off);
    else if (o.kind === 'slidingDoor') {
      along(-t * 0.3, 0, 0.55);
      along(t * 0.3, 0.45, 1);
    } else if (o.swing) {
      // 门扇：从铰链垂直伸进房间
      const [hx, hy] = toPx(o.swing.hinge[0], o.swing.hinge[1]);
      const len = o.swing.leaf * scale;
      line(hx, hy, hx + o.swing.open[0] * len, hy + o.swing.open[1] * len, 70, 1);
    }
  }
  // 房间名：几块小黑块
  for (const room of plan.rooms) {
    const cx = room.poly.reduce((s, p) => s + p[0], 0) / room.poly.length;
    const cy = room.poly.reduce((s, p) => s + p[1], 0) / room.poly.length;
    const [x, y] = toPx(cx, cy);
    for (let i = 0; i < 3; i++) fill(x - 18 + i * 13, y - 5, x - 9 + i * 13, y + 5, 30);
  }
  return {g, toPx};
}
