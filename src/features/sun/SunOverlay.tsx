import {useMemo} from 'react';
import type {Plan} from '../../model/types';
import type {SunResult} from '../../model/sunlight';
import {northOnPlan, siteOf, solarPosition, sunDirOnPlan, doyOf} from '../../model/sun';
import {planBounds, polygonCentroid} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
import {useDesignUi} from '../design/designUi';
import {useSunResult} from './useSun';

/**
 * 平面图上的日照层：此刻照进屋里的光斑（随时间平滑过渡），或全天日照时长的热力图；
 * 外加指北针和太阳方向。按需加载，只在「日照」页签打开时出现。
 */

/** 把格子画到一张小图上，交给浏览器放大（双线性插值，边缘自然柔和） */
function paint(r: SunResult, value: (i: number) => number, rgb: [number, number, number], maxAlpha: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = r.cols;
  canvas.height = r.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(r.cols, r.rows);
  for (let i = 0; i < r.cols * r.rows; i++) {
    if (r.room[i]! < 0) continue;
    const v = value(i);
    if (v <= 0) continue;
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = Math.round(Math.min(1, v) * maxAlpha * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** 日照时长的色带：浅黄 → 橙 */
function paintHours(r: SunResult): string {
  const canvas = document.createElement('canvas');
  canvas.width = r.cols;
  canvas.height = r.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(r.cols, r.rows);
  for (let i = 0; i < r.cols * r.rows; i++) {
    if (r.room[i]! < 0) continue;
    const h = r.hours[i]!;
    // 没晒到的地方淡淡的灰蓝，和晒到的对比
    const t = Math.min(1, h / 5);
    const [cr, cg, cb, a] = h <= 0 ? [120, 134, 160, 0.16] : [255 - t * 20, 214 - t * 90, 120 - t * 90, 0.28 + t * 0.5];
    img.data[i * 4] = cr;
    img.data[i * 4 + 1] = cg;
    img.data[i * 4 + 2] = cb;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export default function SunOverlay({plan}: {plan: Plan}) {
  const {result} = useSunResult();
  const hour = useDesignUi((s) => s.scene.hour);
  const view = useDesignUi((s) => s.sunView);
  const day = useDesignUi((s) => s.sunDay);
  const site = usePlanStore((s) => siteOf(s.plan));
  const b = useMemo(() => planBounds(plan), [plan]);

  // 此刻：在相邻两个 10 分钟时刻之间插值，播放时光斑是滑过去的
  const frame = useMemo(() => {
    if (!result || !result.times.length) return null;
    const cells = result.cols * result.rows;
    if (view === 'day') return paintHours(result);
    const t = result.times;
    if (hour < t[0]! || hour > t.at(-1)!) return null;
    let s0 = 0;
    while (s0 < t.length - 1 && t[s0 + 1]! <= hour) s0++;
    const s1 = Math.min(t.length - 1, s0 + 1);
    const f = s1 === s0 ? 0 : (hour - t[s0]!) / (t[s1]! - t[s0]!);
    return paint(result, (i) => result.lit[s0 * cells + i]! * (1 - f) + result.lit[s1 * cells + i]! * f, [255, 196, 64], 0.62);
  }, [result, view, hour]);

  const sun = solarPosition(site, doyOf(day), hour);
  const sunUp = sun.el > 0;
  const [sx, sy] = sunDirOnPlan(sun.az, site.north);
  const [nx, ny] = northOnPlan(site.north);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 900;
  const compass = {x: b.maxX + 1100, y: b.minY - 1100};

  if (!result) return null;
  return (
    <g className="sun-overlay" aria-hidden>
      <defs>
        <clipPath id="sun-clip">
          {plan.rooms.map((r) => (
            <polygon key={r.id} points={r.poly.map((p) => p.join(',')).join(' ')} />
          ))}
        </clipPath>
      </defs>
      {frame && (
        <image
          href={frame}
          x={result.x0}
          y={result.y0}
          width={result.cols * result.cell}
          height={result.rows * result.cell}
          preserveAspectRatio="none"
          clipPath="url(#sun-clip)"
          className="sun-image"
        />
      )}

      {/* 太阳方向：图外一颗太阳，虚线指向屋子 */}
      {view === 'now' && sunUp && (
        <g className="sun-dir">
          <line x1={cx + sx * radius} y1={cy + sy * radius} x2={cx + sx * (radius - 1400)} y2={cy + sy * (radius - 1400)} />
          <circle cx={cx + sx * radius} cy={cy + sy * radius} r={260} />
        </g>
      )}

      {/* 每个房间全天最长日照 */}
      {view === 'day' &&
        result.rooms.map((r) => {
          const room = plan.rooms.find((x) => x.id === r.id);
          if (!room || room.counted === false) return null;
          const [lx, ly] = room.labelAt ?? polygonCentroid(room.poly);
          return (
            <text key={r.id} x={lx} y={ly + 520} className={`sun-room-hours${r.max >= 3 ? ' is-good' : r.max >= 1 ? '' : ' is-low'}`}>
              {r.max > 0 ? `最长 ${r.max.toFixed(1)} 小时` : '晒不到'}
            </text>
          );
        })}

      {/* 指北针 */}
      <g className="sun-compass" transform={`translate(${compass.x} ${compass.y})`}>
        <circle r={520} />
        <path d={`M ${nx * 420} ${ny * 420} L ${-ny * 150} ${nx * 150} L ${ny * 150} ${-nx * 150} Z`} className="sun-compass-n" />
        <path d={`M ${-nx * 420} ${-ny * 420} L ${-ny * 150} ${nx * 150} L ${ny * 150} ${-nx * 150} Z`} className="sun-compass-s" />
        <text x={nx * 760} y={ny * 760 + 110}>北</text>
      </g>
    </g>
  );
}
