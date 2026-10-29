import {useMemo, useRef} from 'react';
import type {Plan, Vec2} from '../../model/types';
import {planBounds} from '../../model/geometry';
import {FurnitureItem, RoomLabels, RoomsLayer, WallsLayer} from '../plan2d/PlanCanvas';

export interface PreviewPin {
  id: string;
  at: Vec2;
  label: string;
  color: string;
  title: string;
}

/** 只读的平面图：给家人看方案、在图上点一下留言 */
export function PlanPreview({plan, pins = [], onPoint, label}: {plan: Plan; pins?: PreviewPin[]; onPoint?: (at: Vec2) => void; label: string}) {
  const ref = useRef<SVGSVGElement>(null);
  const vb = useMemo(() => {
    const b = planBounds(plan);
    const pad = 500;
    return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`;
  }, [plan]);
  return (
    <svg
      ref={ref}
      className={`fm-preview fp-canvas${onPoint ? ' is-pinning' : ''}`}
      viewBox={vb}
      role="img"
      aria-label={label}
      onClick={(e) => {
        if (!onPoint) return;
        const m = ref.current?.getScreenCTM();
        if (!m) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        onPoint([Math.round(p.x), Math.round(p.y)]);
      }}
    >
      <RoomsLayer rooms={plan.rooms} selectedId={null} />
      <g className="fp-furniture">
        {plan.furniture.map((f) => (
          <FurnitureItem key={f.id} f={f} selected={false} />
        ))}
      </g>
      <WallsLayer walls={plan.walls} openings={plan.openings} demolished={plan.demolished} selectedId={null} />
      <RoomLabels rooms={plan.rooms} />
      {pins.map((p) => (
        <g key={p.id} className="fm-pin" transform={`translate(${p.at[0]} ${p.at[1]})`}>
          <title>{p.title}</title>
          <path d="M0 0 C -170 -230 -380 -380 -380 -610 A 380 380 0 1 1 380 -610 C 380 -380 170 -230 0 0 Z" fill={p.color} />
          <text y={-600}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
