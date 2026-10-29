import {memo, useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent} from 'react';
import type {Furniture, Opening, Room, Wall} from '../../model/types';
import {MATERIALS} from '../../model/materials';
import {planBounds, polygonCentroid, roomArea, segmentOutline, snap} from '../../model/geometry';
import {usePlanStore, type Selection} from '../../store/planStore';
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

const WallsLayer = memo(function WallsLayer({walls, openings}: {walls: Wall[]; openings: Opening[]}) {
  return (
    <g className="fp-walls">
      {walls.map((w) => (
        <polygon key={w.id} data-wall={w.id} points={pts(segmentOutline(w.a, w.b, w.thickness))} className={`fp-wall fp-wall--${w.kind}`} />
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
        </>
      )}
    </g>
  );
});

/* ---------- 画布 ---------- */

interface DragState {
  mode: 'pan' | 'move' | 'rotate';
  id?: string;
  startX: number;
  startY: number;
  origin: {x: number; y: number};
  vb?: ViewBox;
  /** 按下时命中的房间（指针捕获后 pointerup 的 target 会变成 svg 本身） */
  roomId?: string | null;
  moved: boolean;
}

export function PlanCanvas({onReady}: {onReady?: (api: {fit: () => void}) => void}) {
  const plan = usePlanStore((s) => s.plan);
  const selection = usePlanStore((s) => s.selection);
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
    const pad = 900;
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
    onReady?.({fit});
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
  }, [fit, applyViewBox, onReady]);

  const toPlan = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return {x: 0, y: 0};
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return {x: p.x, y: p.y};
  }, []);

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

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const store = usePlanStore.getState();
    const p = toPlan(e.clientX, e.clientY);
    const furnEl = target.closest('[data-furniture]');
    const isHandle = target.getAttribute('data-handle') === 'rotate';
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (e.button === 0 && furnEl && !e.altKey) {
      const id = furnEl.getAttribute('data-furniture')!;
      const f = store.plan.furniture.find((x) => x.id === id);
      if (!f) return;
      store.select({kind: 'furniture', id});
      dragRef.current = {
        mode: isHandle ? 'rotate' : 'move',
        id,
        startX: p.x,
        startY: p.y,
        origin: {x: f.cx, y: f.cy},
        moved: false,
      };
      return;
    }
    const roomId = target.closest('[data-room]')?.getAttribute('data-room') ?? null;
    dragRef.current = {mode: 'pan', startX: e.clientX, startY: e.clientY, origin: {x: 0, y: 0}, vb: {...vbRef.current}, roomId, moved: false};
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
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
      store.moveFurniture(d.id, snap(d.origin.x + p.x - d.startX, SNAP_MM), snap(d.origin.y + p.y - d.startY, SNAP_MM));
    } else if (d.mode === 'rotate' && d.id) {
      const f = store.plan.furniture.find((x) => x.id === d.id);
      if (!f) return;
      let a = (Math.atan2(p.y - f.cy, p.x - f.cx) * 180) / Math.PI + 90;
      if (!e.shiftKey) a = snap(a, ROTATE_SNAP);
      a = ((a % 360) + 360) % 360;
      store.patch((pl) => ({...pl, furniture: pl.furniture.map((x) => (x.id === f.id ? {...x, rot: a} : x))}));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    if (d.mode === 'pan') {
      // 单击空白或房间：选中房间 / 取消选择
      usePlanStore.getState().select(d.roomId ? {kind: 'room', id: d.roomId} : null);
    }
  };

  const selId = (kind: NonNullable<Selection>['kind']) => (selection?.kind === kind ? selection.id : null);

  return (
    <svg
      ref={svgRef}
      className="fp-canvas"
      role="img"
      aria-label={`${plan.name} 平面图`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (dragRef.current = null)}
    >
      <defs>
        <pattern id="fp-grid-minor" width={500} height={500} patternUnits="userSpaceOnUse">
          <path d="M 500 0 L 0 0 0 500" className="fp-grid-minor" />
        </pattern>
        <pattern id="fp-grid" width={2500} height={2500} patternUnits="userSpaceOnUse">
          <rect width={2500} height={2500} fill="url(#fp-grid-minor)" />
          <path d="M 2500 0 L 0 0 0 2500" className="fp-grid-major" />
        </pattern>
      </defs>
      <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#fp-grid)" />
      <RoomsLayer rooms={plan.rooms} selectedId={selId('room')} />
      <g className="fp-furniture">
        {plan.furniture.map((f) => (
          <FurnitureItem key={f.id} f={f} selected={f.id === selId('furniture')} />
        ))}
      </g>
      <WallsLayer walls={plan.walls} openings={plan.openings} />
      <RoomLabels rooms={plan.rooms} />
    </svg>
  );
}
