import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {toast} from '../../lib/toast';
import type {Furniture, Measure, Opening, Room, Vec2, Wall} from '../../model/types';
import {MATERIALS} from '../../model/materials';
import {planBounds, polygonCentroid, roomArea, segmentOutline, snap} from '../../model/geometry';
import {activeWalls, withCorners, snapFurniture, snapMeasurePoint, wallLength, wallRects, type Rect} from '../../model/walls';
import {usePlanStore, type DemolishResult, type Selection} from '../../store/planStore';
import {planView, useDesignUi} from '../design/designUi';
import {dimensionChains, type DimChain} from '../../model/dims';
import {snapToWalls} from '../../model/snap';
import {uid} from '../../lib/id';
import {furnitureSymbol} from './furnitureSymbol';
import './plan2d.css';

type ViewBox = {x: number; y: number; w: number; h: number};

const SNAP_MM = 10;
const ROTATE_SNAP = 15;

const pts = (poly: readonly (readonly [number, number])[]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

/* ---------- 静态图层：只在户型结构变化时重绘 ---------- */

const RoomsLayer = memo(function RoomsLayer({rooms, selectedId}: {rooms: Room[]; selectedId: string | null}) {
  return (
    <g className="fp-rooms">
      {rooms.map((r) => (
        <polygon
          key={r.id}
          data-room={r.id}
          points={pts(r.poly)}
          fill={MATERIALS[r.material].swatch}
          className={r.id === selectedId ? 'fp-room is-selected' : 'fp-room'}
        />
      ))}
    </g>
  );
});

const RoomLabels = memo(function RoomLabels({rooms}: {rooms: Room[]}) {
  return (
    <g className="fp-room-labels" aria-hidden>
      {rooms.filter((r) => r.counted !== false).map((r) => {
        const [x, y] = r.labelAt ?? polygonCentroid(r.poly);
        return (
          <text key={r.id} x={x} y={y} textAnchor="middle">
            <tspan className="fp-room-name">{r.name}</tspan>
            <tspan className="fp-room-area" x={x} dy={230}>
              {roomArea(r).toFixed(1)} ㎡
            </tspan>
          </text>
        );
      })}
    </g>
  );
});

const WallsLayer = memo(function WallsLayer({
  walls,
  openings,
  demolished,
  selectedId,
}: {
  walls: Wall[];
  openings: Opening[];
  demolished: string[];
  selectedId: string | null;
}) {
  const gone = new Set(demolished);
  // 墙角按改造前的墙补齐，拆掉一段时旁边的墙不会跟着缩
  const drawn = withCorners(walls);
  return (
    <g className="fp-walls">
      {drawn.map((w) => (
        <polygon
          key={w.id}
          data-wall={w.id}
          points={pts(segmentOutline(w.a, w.b, w.thickness))}
          className={[
            'fp-wall',
            `fp-wall--${w.kind}`,
            gone.has(w.id) && 'is-demolished',
            w.added && 'is-added',
            w.id === selectedId && 'is-selected',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
      {openings.map((o) => (
        <OpeningSymbol key={o.id} o={o} />
      ))}
    </g>
  );
});

function OpeningSymbol({o}: {o: Opening}) {
  const outline = pts(segmentOutline(o.a, o.b, o.thickness));
  if (o.kind === 'window') {
    const inner = segmentOutline(o.a, o.b, o.thickness / 3);
    return (
      <g className="fp-window">
        <polygon points={outline} />
        <polygon points={pts(inner)} className="fp-window-glass" />
      </g>
    );
  }
  if (o.kind === 'slidingDoor') {
    return (
      <g className="fp-slide">
        <polygon points={outline} />
        <polyline points={pts(segmentOutline(o.a, o.b, o.thickness / 2).slice(0, 2))} className="fp-slide-leaf" />
        <polyline points={pts(segmentOutline(o.a, o.b, o.thickness / 2).slice(2, 4))} className="fp-slide-leaf" />
      </g>
    );
  }
  // 平开门：门洞 + 开启后门扇 + 开启弧线
  const s = o.swing;
  if (!s) return <polygon points={outline} className="fp-door-gap" />;
  const [hx, hy] = s.hinge;
  const closedEnd = [hx + s.closed[0] * s.leaf, hy + s.closed[1] * s.leaf] as const;
  const openEnd = [hx + s.open[0] * s.leaf, hy + s.open[1] * s.leaf] as const;
  // 叉积判断弧线方向
  const cross = s.closed[0] * s.open[1] - s.closed[1] * s.open[0];
  return (
    <g className={o.isEntry ? 'fp-door is-entry' : 'fp-door'}>
      <polygon points={outline} className="fp-door-gap" />
      <line x1={hx} y1={hy} x2={openEnd[0]} y2={openEnd[1]} className="fp-door-leaf" />
      <path d={`M ${closedEnd[0]} ${closedEnd[1]} A ${s.leaf} ${s.leaf} 0 0 ${cross > 0 ? 1 : 0} ${openEnd[0]} ${openEnd[1]}`} className="fp-door-arc" />
    </g>
  );
}

/* ---------- 测量线 ---------- */

const fmtMm = (v: number) => Math.round(v).toLocaleString('zh-CN');

function MeasureLine({a, b, selected, id}: {a: Vec2; b: Vec2; selected?: boolean; id?: string}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return null;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const tick = 110;
  let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return (
    <g className={selected ? 'fp-measure is-selected' : 'fp-measure'} data-measure={id}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="fp-measure-hit" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="fp-measure-line" />
      {[a, b].map((p, i) => (
        <line key={i} x1={p[0] - nx * tick} y1={p[1] - ny * tick} x2={p[0] + nx * tick} y2={p[1] + ny * tick} className="fp-measure-line" />
      ))}
      <text transform={`translate(${mx} ${my}) rotate(${deg})`} y={-60} textAnchor="middle" className="fp-measure-text">
        {fmtMm(len)}
      </text>
    </g>
  );
}

const MeasuresLayer = memo(function MeasuresLayer({measures, selectedId}: {measures: Measure[]; selectedId: string | null}) {
  return (
    <g className="fp-measures">
      {measures.map((m) => (
        <MeasureLine key={m.id} id={m.id} a={m.a} b={m.b} selected={m.id === selectedId} />
      ))}
    </g>
  );
});

/* ---------- 外圈尺寸标注 ---------- */

const SHORT_DIM = 400;

function DimLine({c}: {c: DimChain}) {
  const t = c.ticks;
  // 连着几段短的（墙厚这种）文字会挤在一起，隔一个放到线的另一侧
  const flips: boolean[] = [];
  for (let i = 1, run = 0; i < t.length; i++) {
    const short = t[i]! - t[i - 1]! < SHORT_DIM;
    run = short ? run + 1 : 0;
    flips.push(short && run % 2 === 0);
  }
  const xy = (u: number, off = 0): [number, number] => (c.horiz ? [u, c.at + off] : [c.at + off, u]);
  const [x0, y0] = xy(t[0]!);
  const [x1, y1] = xy(t.at(-1)!);
  return (
    <g>
      <line x1={x0} y1={y0} x2={x1} y2={y1} />
      {t.map((u) => {
        const [a, b] = xy(u, -170);
        const [e, f] = xy(u, 170);
        const [p, q] = xy(u);
        return (
          <g key={u}>
            <line x1={a} y1={b} x2={e} y2={f} />
            <line x1={p - 80} y1={q + 80} x2={p + 80} y2={q - 80} className="fp-dim-tick" />
          </g>
        );
      })}
      {t.slice(1).map((u, i) => {
        const len = u - t[i]!;
        const side = flips[i] ? -c.side : c.side;
        const [x, y] = xy((u + t[i]!) / 2, side * 70);
        return (
          <text key={u} x={x} y={y} fontSize={len < SHORT_DIM ? 130 : 180} textAnchor="middle" dominantBaseline={side < 0 ? 'auto' : 'hanging'} transform={c.horiz ? undefined : `rotate(-90 ${x} ${y})`}>
            {len}
          </text>
        );
      })}
    </g>
  );
}

const DimsLayer = memo(function DimsLayer({walls}: {walls: Wall[]}) {
  const chains = useMemo(() => dimensionChains(walls), [walls]);
  return (
    <g className="fp-dims" aria-hidden>
      {chains.map((c, i) => (
        <DimLine key={i} c={c} />
      ))}
    </g>
  );
});

/* ---------- 家具层 ---------- */

const FurnitureItem = memo(function FurnitureItem({f, selected}: {f: Furniture; selected: boolean}) {
  const fontSize = Math.max(90, Math.min(160, Math.min(f.w, f.d) / 4.5));
  const showLabel = f.type !== 'rug' && Math.min(f.w, f.d) >= 380;
  return (
    <g
      data-furniture={f.id}
      className={selected ? 'fp-furn is-selected' : 'fp-furn'}
      transform={`translate(${f.cx} ${f.cy}) rotate(${f.rot})`}
    >
      {furnitureSymbol(f.type, f.w, f.d, f.color)}
      {showLabel && (
        <text transform={`rotate(${-f.rot})`} fontSize={fontSize} textAnchor="middle" dominantBaseline="central" className="fp-furn-label">
          {f.name}
        </text>
      )}
      {selected && (
        <>
          <rect x={-f.w / 2 - 40} y={-f.d / 2 - 40} width={f.w + 80} height={f.d + 80} rx={30} className="fp-sel-box" />
          <line x1={0} y1={-f.d / 2 - 40} x2={0} y2={-f.d / 2 - 260} className="fp-sel-stem" />
          <circle data-handle="rotate" cx={0} cy={-f.d / 2 - 300} r={70} className="fp-sel-handle" />
          <rect data-handle="size" x={f.w / 2 + 40 - 55} y={f.d / 2 + 40 - 55} width={110} height={110} className="fp-sel-size" />
          <text transform={`rotate(${-f.rot})`} y={0} className="fp-sel-dim" textAnchor="middle" dominantBaseline="central">
            <tspan x={0} dy={Math.max(f.w, f.d) / 2 + 260}>
              {f.w} × {f.d}
            </tspan>
          </text>
        </>
      )}
    </g>
  );
});

/* ---------- 画布 ---------- */

interface DragState {
  mode: 'pan' | 'move' | 'rotate' | 'resize' | 'measure';
  id?: string;
  startX: number;
  startY: number;
  origin: {x: number; y: number};
  vb?: ViewBox;
  /** 按下时命中的房间 / 墙 / 测量线（指针捕获后 pointerup 的 target 会变成 svg 本身） */
  roomId?: string | null;
  wallId?: string | null;
  measureId?: string | null;
  /** 拖家具时用的墙面矩形，按下时算一次 */
  rects?: Rect[];
  /** 改尺寸时按下那一刻的家具 */
  orig?: Furniture;
  moved: boolean;
}

const DEMOLISH_TOAST: Record<DemolishResult, string> = {
  bearing: '承重墙不能拆',
  exterior: '外墙属于建筑外围护结构，不建议拆',
  demolished: '已标记拆除，可撤销',
  restored: '已恢复这段墙',
  removed: '已删掉这段新砌的墙',
};


export function PlanCanvas() {
  const plan = usePlanStore((s) => s.plan);
  const selection = usePlanStore((s) => s.selection);
  const tool = useDesignUi((s) => s.tool);
  const layers = useDesignUi((s) => s.layers);
  const [measureStart, setMeasureStart] = useState<Vec2 | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [chain, setChain] = useState<Vec2[]>([]);
  const buildWalls = useMemo(() => activeWalls(plan), [plan]);
  const svgRef = useRef<SVGSVGElement>(null);
  const vbRef = useRef<ViewBox>({x: 0, y: 0, w: 10000, h: 10000});
  const dragRef = useRef<DragState | null>(null);

  const applyViewBox = useCallback(() => {
    const {x, y, w, h} = vbRef.current;
    svgRef.current?.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const b = planBounds(usePlanStore.getState().plan);
    const pad = useDesignUi.getState().layers.dims ? 1700 : 900;
    const bw = b.maxX - b.minX + pad * 2;
    const bh = b.maxY - b.minY + pad * 2;
    const rect = svg.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    let w = bw;
    let h = bh;
    if (bw / bh > aspect) h = bw / aspect;
    else w = bh * aspect;
    vbRef.current = {x: b.minX - pad - (w - bw) / 2, y: b.minY - pad - (h - bh) / 2, w, h};
    applyViewBox();
  }, [applyViewBox]);

  useLayoutEffect(() => {
    fit();
    // 以画面中心缩放
    const zoomTo = (w: number) => {
      const vb = vbRef.current;
      const nw = Math.max(1500, Math.min(80000, w));
      const k = nw / vb.w;
      vbRef.current = {x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - vb.h * k) / 2, w: nw, h: vb.h * k};
      applyViewBox();
    };
    planView.fit = fit;
    planView.zoom = (k) => zoomTo(vbRef.current.w / k);
    // 1 CSS 像素约 0.2646 mm，按 1:N 显示时一个像素代表 0.2646 × N mm
    planView.scale = (ratio) => zoomTo((svgRef.current?.getBoundingClientRect().width ?? 1000) * (25.4 / 96) * ratio);
    planView.toPlan = (x, y) => {
      const svg = svgRef.current;
      const r = svg?.getBoundingClientRect();
      if (!svg || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(x, y).matrixTransform(m.inverse());
      return [p.x, p.y];
    };
    planView.svg = () => svgRef.current;
    const svg = svgRef.current;
    if (!svg) return;
    // 容器尺寸变化时保持比例，不重置缩放
    const ro = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      const vb = vbRef.current;
      const aspect = rect.width / Math.max(1, rect.height);
      const cy = vb.y + vb.h / 2;
      const h = vb.w / aspect;
      vbRef.current = {x: vb.x, y: cy - h / 2, w: vb.w, h};
      applyViewBox();
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit, applyViewBox]);

  const toPlan = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return {x: 0, y: 0};
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return {x: p.x, y: p.y};
  }, []);

  /** 1 个屏幕像素是多少 mm，吸附容差按屏幕像素算 */
  const mmPerPx = useCallback(() => vbRef.current.w / Math.max(1, svgRef.current?.getBoundingClientRect().width ?? 1), []);

  const measureSnap = (x: number, y: number, lock: boolean, from: Vec2 | null) =>
    snapMeasurePoint(wallRects(usePlanStore.getState().plan), [x, y], 10 * mmPerPx(), from, lock);

  const buildSnap = (x: number, y: number, free: boolean, from: Vec2 | null): Vec2 => {
    const r = snapToWalls(buildWalls, [x, y], {radius: 12 * mmPerPx(), from: from ? [from[0], from[1]] : null, free});
    // 吸到已有墙上的点保持原值，其余按 10mm 取整
    return r.kind === 'endpoint' || r.kind === 'wall' ? r.p : [snap(r.p[0], 10), snap(r.p[1], 10)];
  };

  const cancelTool = useCallback(() => {
    setMeasureStart(null);
    setChain([]);
    setCursor(null);
  }, []);

  // 换工具时丢掉画了一半的东西
  useEffect(() => cancelTool(), [tool, cancelTool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelTool();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelTool]);

  // 滚轮缩放（以光标为中心），触控板双指平移
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vb = vbRef.current;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 || e.deltaMode !== 0) {
        const k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
        const w = Math.max(1500, Math.min(80000, vb.w * k));
        const ratio = w / vb.w;
        const p = toPlan(e.clientX, e.clientY);
        vbRef.current = {x: p.x - (p.x - vb.x) * ratio, y: p.y - (p.y - vb.y) * ratio, w, h: vb.h * ratio};
      } else {
        const rect = svg.getBoundingClientRect();
        const s = vb.w / rect.width;
        vbRef.current = {...vb, x: vb.x + e.deltaX * s, y: vb.y + e.deltaY * s};
      }
      applyViewBox();
    };
    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toPlan, applyViewBox]);

  // 触屏双指：捏合缩放、拖动平移
  const touches = useRef(new Map<number, {x: number; y: number}>());
  const pinch = useRef<{vb: ViewBox; dist: number; mid: {x: number; y: number}} | null>(null);
  const startPinch = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return;
    // 第二根手指落下：放弃单指正在做的事（拖家具的话撤回到按下前）
    const d = dragRef.current;
    if (d?.moved && (d.mode === 'move' || d.mode === 'rotate' || d.mode === 'resize')) usePlanStore.getState().undo();
    dragRef.current = null;
    const midScreen = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    pinch.current = {vb: {...vbRef.current}, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: toPlan(midScreen.x, midScreen.y)};
  };
  const movePinch = () => {
    const pc = pinch.current;
    const [a, b] = [...touches.current.values()];
    const svg = svgRef.current;
    if (!pc || !a || !b || !svg) return;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(1500, Math.min(80000, (pc.vb.w * pc.dist) / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
    const h = (pc.vb.h * w) / pc.vb.w;
    const sx = ((a.x + b.x) / 2 - rect.left) / rect.width;
    const sy = ((a.y + b.y) / 2 - rect.top) / rect.height;
    vbRef.current = {x: pc.mid.x - sx * w, y: pc.mid.y - sy * h, w, h};
    applyViewBox();
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (touches.current.size === 2) {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        startPinch();
        return;
      }
      if (touches.current.size > 2) return;
    }
    const target = e.target as Element;
    const store = usePlanStore.getState();
    const p = toPlan(e.clientX, e.clientY);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const panState = (): DragState => ({
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origin: {x: 0, y: 0},
      vb: {...vbRef.current},
      roomId: target.closest('[data-room]')?.getAttribute('data-room') ?? null,
      wallId: target.closest('[data-wall]')?.getAttribute('data-wall') ?? null,
      measureId: target.closest('[data-measure]')?.getAttribute('data-measure') ?? null,
      moved: false,
    });

    if (e.button === 2) {
      cancelTool();
      return;
    }
    if (e.button === 1) {
      dragRef.current = panState();
      return;
    }

    if (tool === 'measure') {
      const q = measureSnap(p.x, p.y, e.shiftKey, measureStart);
      if (!measureStart) {
        setMeasureStart(q);
        setCursor(q);
        dragRef.current = {mode: 'measure', startX: e.clientX, startY: e.clientY, origin: {x: q[0], y: q[1]}, moved: false};
      } else {
        // 第二下点击：落下测量线
        if (Math.hypot(q[0] - measureStart[0], q[1] - measureStart[1]) > 20) store.addMeasure({id: uid('m'), a: measureStart, b: q});
        setMeasureStart(null);
        setCursor(null);
      }
      return;
    }

    const furnEl = tool === 'select' ? target.closest('[data-furniture]') : null;
    if (e.button === 0 && furnEl && !e.altKey) {
      const id = furnEl.getAttribute('data-furniture')!;
      const f = store.plan.furniture.find((x) => x.id === id);
      if (!f) return;
      store.select({kind: 'furniture', id});
      const handle = target.getAttribute('data-handle');
      dragRef.current = {
        mode: handle === 'rotate' ? 'rotate' : handle === 'size' ? 'resize' : 'move',
        orig: f,
        id,
        startX: p.x,
        startY: p.y,
        origin: {x: f.cx, y: f.cy},
        rects: wallRects(store.plan),
        moved: false,
      };
      return;
    }
    dragRef.current = panState();
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (pinch.current) {
        movePinch();
        return;
      }
    }
    const d = dragRef.current;
    if (!d || d.mode === 'measure') {
      // 没在拖：给测量和砌墙画预览
      if (tool === 'measure' && measureStart) {
        const p = toPlan(e.clientX, e.clientY);
        setCursor(measureSnap(p.x, p.y, e.shiftKey, measureStart));
        if (d && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true;
      } else if (tool === 'build' && !d) {
        const p = toPlan(e.clientX, e.clientY);
        setCursor(buildSnap(p.x, p.y, e.shiftKey, chain.at(-1) ?? null));
      }
      return;
    }
    const store = usePlanStore.getState();
    if (d.mode === 'pan' && d.vb) {
      const rect = svgRef.current!.getBoundingClientRect();
      const s = d.vb.w / rect.width;
      const dx = (e.clientX - d.startX) * s;
      const dy = (e.clientY - d.startY) * s;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
      vbRef.current = {...d.vb, x: d.vb.x - dx, y: d.vb.y - dy};
      applyViewBox();
      return;
    }
    const p = toPlan(e.clientX, e.clientY);
    if (!d.moved) {
      if (Math.hypot(p.x - d.startX, p.y - d.startY) < 20) return;
      d.moved = true;
      store.checkpoint();
    }
    if (d.mode === 'move' && d.id) {
      const x = d.origin.x + p.x - d.startX;
      const y = d.origin.y + p.y - d.startY;
      const f = store.plan.furniture.find((it) => it.id === d.id);
      if (!f) return;
      // 靠近墙面自动贴上，按住 Alt 只按网格走
      const free = e.altKey || !d.rects || !useDesignUi.getState().wallSnap;
      const [nx, ny] = free ? [snap(x, SNAP_MM), snap(y, SNAP_MM)] : snapFurniture(d.rects!, f, x, y, 10 * mmPerPx(), SNAP_MM);
      store.moveFurniture(d.id, nx, ny);
    } else if (d.mode === 'resize' && d.id && d.orig) {
      // 拖右下角：对角固定，宽深跟着变
      const o = d.orig;
      const r = (o.rot * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const dx = p.x - o.cx;
      const dy = p.y - o.cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const w = Math.max(100, snap(lx + o.w / 2 - 40, SNAP_MM));
      const dd = Math.max(100, snap(ly + o.d / 2 - 40, SNAP_MM));
      const cxl = (w - o.w) / 2;
      const cyl = (dd - o.d) / 2;
      store.patch((pl) => ({
        ...pl,
        furniture: pl.furniture.map((x) => (x.id === o.id ? {...x, w, d: dd, cx: o.cx + cxl * cos - cyl * sin, cy: o.cy + cxl * sin + cyl * cos} : x)),
      }));
    } else if (d.mode === 'rotate' && d.id) {
      const f = store.plan.furniture.find((x) => x.id === d.id);
      if (!f) return;
      let a = (Math.atan2(p.y - f.cy, p.x - f.cx) * 180) / Math.PI + 90;
      if (!e.shiftKey) a = snap(a, ROTATE_SNAP);
      a = ((a % 360) + 360) % 360;
      store.patch((pl) => ({...pl, furniture: pl.furniture.map((x) => (x.id === f.id ? {...x, rot: a} : x))}));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) pinch.current = null;
        dragRef.current = null;
        return;
      }
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const store = usePlanStore.getState();
    if (d.mode === 'measure') {
      // 按住拖出来的测量线，松手就落下；没拖动则等第二下点击
      if (d.moved && measureStart && cursor && Math.hypot(cursor[0] - measureStart[0], cursor[1] - measureStart[1]) > 20) {
        store.addMeasure({id: uid('m'), a: measureStart, b: cursor});
        setMeasureStart(null);
        setCursor(null);
      }
      return;
    }
    if (d.moved || d.mode !== 'pan') return;

    if (tool === 'demolish') {
      if (d.wallId) {
        const w = store.plan.walls.find((x) => x.id === d.wallId);
        const result = store.toggleDemolish(d.wallId);
        const body = result === 'demolished' && w ? `已标记拆除 ${fmtMm(wallLength(w))} mm 墙体，可撤销` : DEMOLISH_TOAST[result];
        toast(body, result === 'bearing' || result === 'exterior' ? 'error' : 'info');
      }
      return;
    }
    if (tool === 'build') {
      const p = toPlan(e.clientX, e.clientY);
      const last = chain.at(-1) ?? null;
      const q = buildSnap(p.x, p.y, e.shiftKey, last);
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) > 50) {
        store.addWalls([{id: uid('w'), a: last, b: q, thickness: 120, kind: 'partition', added: true}]);
      }
      // 回到起点就收尾
      if (chain.length > 1 && Math.hypot(q[0] - chain[0]![0], q[1] - chain[0]![1]) < 1) setChain([]);
      else if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 50) setChain((c) => [...c, q]);
      return;
    }
    // 选择：测量线 > 墙 > 房间 > 空白
    const sel: Selection = d.measureId
      ? {kind: 'measure', id: d.measureId}
      : d.wallId
        ? {kind: 'wall', id: d.wallId}
        : d.roomId
          ? {kind: 'room', id: d.roomId}
          : null;
    store.select(sel);
  };

  const selId = (kind: NonNullable<Selection>['kind']) => (selection?.kind === kind ? selection.id : null);

  return (
    <svg
      ref={svgRef}
      className={`fp-canvas tool-${tool}${layers.bearing ? ' show-bearing' : ''}`}
      role="img"
      aria-label={`${plan.name} 平面图`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        dragRef.current = null;
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinch.current = null;
      }}
      onDoubleClick={() => tool === 'build' && setChain([])}
      onContextMenu={(e) => {
        if (tool !== 'select') e.preventDefault();
      }}
    >
      <defs>
        <pattern id="fp-hatch-demolish" width={120} height={120} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={120} height={120} fill="#FFF7ED" />
          <line x1={0} y1={0} x2={0} y2={120} stroke="#FDBA74" strokeWidth={40} />
        </pattern>
        <pattern id="fp-grid-minor" width={500} height={500} patternUnits="userSpaceOnUse">
          <path d="M 500 0 L 0 0 0 500" className="fp-grid-minor" />
        </pattern>
        <pattern id="fp-grid" width={2500} height={2500} patternUnits="userSpaceOnUse">
          <rect width={2500} height={2500} fill="url(#fp-grid-minor)" />
          <path d="M 2500 0 L 0 0 0 2500" className="fp-grid-major" />
        </pattern>
      </defs>
      <rect x={-100000} y={-100000} width={200000} height={200000} fill={layers.grid ? 'url(#fp-grid)' : 'transparent'} />
      <RoomsLayer rooms={plan.rooms} selectedId={selId('room')} />
      {layers.furniture && (
        <g className="fp-furniture">
          {plan.furniture.map((f) => (
            <FurnitureItem key={f.id} f={f} selected={f.id === selId('furniture')} />
          ))}
        </g>
      )}
      <WallsLayer walls={plan.walls} openings={plan.openings} demolished={plan.demolished} selectedId={selId('wall')} />
      {layers.labels && <RoomLabels rooms={plan.rooms} />}
      {layers.dims && <DimsLayer walls={plan.walls} />}
      <MeasuresLayer measures={plan.measures} selectedId={selId('measure')} />

      {/* 进行中的测量 / 砌墙 */}
      {tool === 'measure' && measureStart && cursor && <MeasureLine a={measureStart} b={cursor} />}
      {tool === 'build' && chain.length > 1 && <polyline points={pts(chain)} className="fp-build-chain" />}
      {tool === 'build' && chain.length > 0 && cursor && (
        <>
          <polygon points={pts(segmentOutline(chain.at(-1)!, cursor, 120))} className="fp-build-rubber" />
          <MeasureLine a={chain.at(-1)!} b={cursor} />
        </>
      )}
      {(tool === 'build' || tool === 'measure') && cursor && <circle cx={cursor[0]} cy={cursor[1]} r={6 * mmPerPx()} className="fp-tool-cursor" />}
    </svg>
  );
}
