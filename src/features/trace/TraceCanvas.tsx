import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {useTraceStore, OPENING_TOOLS} from './traceStore';
import {dist, moveVertex, nearestWall, needsReview, openingOnWall, snapPoint, type Draft, type DraftOpening, type DraftWall, type P, type SnapResult} from './draft';
import {roughScale} from './scale';
import {uid} from '../../lib/id';
import type {LoadedImage} from './image';
import './trace.css';

type VB = {x: number; y: number; w: number; h: number};
const SNAP_PX = 10;

const pts = (poly: readonly P[]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

/* ---------- 静态图层：草稿不变时不重绘 ---------- */

const RoomsLayer = memo(function RoomsLayer({draft, selectedId, k}: {draft: Draft; selectedId: string | null; k: number}) {
  return (
    <g>
      {draft.rooms.map((r) => {
        const cx = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
        const cy = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
        const cls = ['tr-room', needsReview(r) && 'is-review', r.id === selectedId && 'is-selected'].filter(Boolean).join(' ');
        return (
          <g key={r.id}>
            <polygon data-room={r.id} points={pts(r.poly)} className={cls} />
            <text x={cx} y={cy} className="tr-room-label" fontSize={13 * k} textAnchor="middle" dominantBaseline="central">
              {r.name}
            </text>
          </g>
        );
      })}
    </g>
  );
});

const WallsLayer = memo(function WallsLayer({draft, selectedId}: {draft: Draft; selectedId: string | null}) {
  return (
    <g>
      {draft.walls.map((w) => (
        <line
          key={w.id}
          data-wall={w.id}
          x1={w.a[0]}
          y1={w.a[1]}
          x2={w.b[0]}
          y2={w.b[1]}
          strokeWidth={w.thickness}
          className={['tr-wall', `tr-wall--${w.kind}`, needsReview(w) && 'is-review', w.id === selectedId && 'is-selected'].filter(Boolean).join(' ')}
        />
      ))}
    </g>
  );
});

function OpeningShape({o: raw, wall, selected, preview, scale}: {o: DraftOpening; wall?: DraftWall; selected?: boolean; preview?: boolean; scale?: number}) {
  // 手放的门窗按当前比例显示真实宽度，标定后会跟着变
  const o =
    raw.widthMm && wall && scale
      ? openingOnWall(wall, [(raw.a[0] + raw.b[0]) / 2, (raw.a[1] + raw.b[1]) / 2], raw.widthMm / scale, raw.kind)
      : raw;
  const t = Math.max(4, (wall?.thickness ?? 6) + 2);
  const cls = ['tr-opening', `tr-opening--${o.kind}`, needsReview(o) && 'is-review', selected && 'is-selected', preview && 'is-preview'].filter(Boolean).join(' ');
  return (
    <g data-opening={preview ? undefined : o.id} className={cls}>
      <line x1={o.a[0]} y1={o.a[1]} x2={o.b[0]} y2={o.b[1]} strokeWidth={t} className="tr-opening-body" />
      <line x1={o.a[0]} y1={o.a[1]} x2={o.b[0]} y2={o.b[1]} strokeWidth={Math.max(1.5, t / 4)} className="tr-opening-core" />
    </g>
  );
}

const OpeningsLayer = memo(function OpeningsLayer({draft, selectedId, scale}: {draft: Draft; selectedId: string | null; scale: number}) {
  const byId = new Map(draft.walls.map((w) => [w.id, w]));
  return (
    <g>
      {draft.openings.map((o) => (
        <OpeningShape key={o.id} o={o} wall={o.wallId ? byId.get(o.wallId) : undefined} selected={o.id === selectedId} scale={scale} />
      ))}
    </g>
  );
});

/* ---------- 画布 ---------- */

interface Gesture {
  mode: 'pan' | 'vertex' | 'click';
  startClient: P;
  vb: VB;
  from?: P;
  moved: boolean;
  hit?: {kind: 'wall' | 'opening' | 'room'; id: string} | null;
}

export function TraceCanvas({image}: {image: LoadedImage}) {
  const draft = useTraceStore((s) => s.draft);
  const tool = useTraceStore((s) => s.tool);
  const selection = useTraceStore((s) => s.selection);
  const wallKind = useTraceStore((s) => s.wallKind);
  const calib = useTraceStore((s) => s.calib);
  const calibMm = useTraceStore((s) => s.calibMm);
  const scale = useMemo(() => roughScale(draft, calib, calibMm, image.width), [draft, calib, calibMm, image.width]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<VB>({x: 0, y: 0, w: image.width, h: image.height});
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const [k, setK] = useState(1); // 1 个屏幕像素 = k 个图片像素
  const [chain, setChain] = useState<P[]>([]); // 画墙 / 画房间中的点
  const [hover, setHover] = useState<SnapResult | null>(null);
  const [openingPreview, setOpeningPreview] = useState<DraftOpening | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pad = 0.04;
    const aspect = rect.width / Math.max(1, rect.height);
    let w = image.width * (1 + pad * 2);
    let h = image.height * (1 + pad * 2);
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    setVb({x: (image.width - w) / 2, y: (image.height - h) / 2, w, h});
    setK(w / rect.width);
  }, [image.width, image.height]);

  useLayoutEffect(() => {
    fit();
    const svg = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      setVb((v) => ({...v, h: v.w * (rect.height / Math.max(1, rect.width))}));
      setK(vbRef.current.w / rect.width);
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);

  // 切换工具时清掉进行中的线
  useEffect(() => {
    setChain([]);
    setHover(null);
    setOpeningPreview(null);
  }, [tool]);

  const toImage = useCallback((cx: number, cy: number): P => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  // 滚轮缩放
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = vbRef.current;
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 || e.deltaMode !== 0) {
        const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
        const w = Math.max(image.width / 40, Math.min(image.width * 6, v.w * f));
        const r = w / v.w;
        const p = toImage(e.clientX, e.clientY);
        setVb({x: p[0] - (p[0] - v.x) * r, y: p[1] - (p[1] - v.y) * r, w, h: v.h * r});
        setK(w / rect.width);
      } else {
        const s = v.w / rect.width;
        setVb({...v, x: v.x + e.deltaX * s, y: v.y + e.deltaY * s});
      }
    };
    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toImage, image.width]);

  const finishChain = useCallback(() => {
    const store = useTraceStore.getState();
    if (store.tool === 'room' && chain.length >= 3) {
      const id = uid('r');
      store.commit((d) => ({...d, rooms: [...d.rooms, {id, name: `房间 ${d.rooms.length + 1}`, poly: chain, source: 'manual', confirmed: true}]}));
      store.select({kind: 'room', id});
    }
    setChain([]);
  }, [chain]);

  // 键盘：Esc 结束 / 取消，Enter 完成房间，空格按住平移，Delete 删除，⌘Z 撤销
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const store = useTraceStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
      } else if (e.key === 'Escape') {
        if (chain.length) finishChain();
        else store.select(null);
      } else if (e.key === 'Enter') {
        finishChain();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeSelected();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (!mod && /^[vwdgsrc]$/i.test(e.key)) {
        const map = {v: 'select', w: 'wall', d: 'door', g: 'window', s: 'slidingDoor', r: 'room', c: 'calibrate'} as const;
        store.setTool(map[e.key.toLowerCase() as keyof typeof map]);
      }
    };
    const onUp = (e: KeyboardEvent) => e.key === ' ' && setSpaceDown(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [chain, finishChain]);

  const radius = SNAP_PX * k;

  const hitTest = (el: Element): Gesture['hit'] => {
    const o = el.closest('[data-opening]');
    if (o) return {kind: 'opening', id: o.getAttribute('data-opening')!};
    const w = el.closest('[data-wall]');
    if (w) return {kind: 'wall', id: w.getAttribute('data-wall')!};
    const r = el.closest('[data-room]');
    if (r) return {kind: 'room', id: r.getAttribute('data-room')!};
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = {startClient: [e.clientX, e.clientY] as P, vb: vbRef.current, moved: false};
    const handle = (e.target as Element).getAttribute('data-vertex');
    if (e.button === 1 || spaceDown) {
      gesture.current = {...base, mode: 'pan'};
    } else if (tool === 'select' && handle) {
      const [x, y] = handle.split(',').map(Number) as [number, number];
      gesture.current = {...base, mode: 'vertex', from: [x, y]};
    } else if (tool === 'select') {
      gesture.current = {...base, mode: 'pan', hit: hitTest(e.target as Element)};
    } else {
      gesture.current = {...base, mode: 'click'};
    }
  };

  /** 鼠标位置附近能放下的门窗；预览和点击共用，点击时重新算，避免拿到上一帧的旧预览 */
  const openingAt = (p: P): DraftOpening | null => {
    if (tool !== 'door' && tool !== 'window' && tool !== 'slidingDoor') return null;
    const store = useTraceStore.getState();
    const hit = nearestWall(store.draft, p, radius * 1.5);
    if (!hit) return null;
    const cfg = OPENING_TOOLS[tool];
    const scale = roughScale(store.draft, store.calib, store.calibMm, image.width);
    return openingOnWall(hit.wall, hit.point, cfg.widthMm / scale, cfg.kind, cfg.widthMm);
  };

  const updateHover = (p: P, free: boolean) => {
    const store = useTraceStore.getState();
    if (tool === 'wall' || tool === 'room') {
      setHover(snapPoint(store.draft, p, {radius, from: chain.at(-1) ?? null, free}));
    } else if (tool === 'door' || tool === 'window' || tool === 'slidingDoor') {
      setOpeningPreview(openingAt(p));
    } else if (tool === 'calibrate') {
      setHover({p, kind: null, guides: {}});
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toImage(e.clientX, e.clientY);
    const g = gesture.current;
    if (g) {
      const moved = Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) > 3;
      if (moved && !g.moved) {
        g.moved = true;
        if (g.mode === 'vertex') useTraceStore.getState().checkpoint();
      }
      if (g.mode === 'pan' && g.moved) {
        const rect = svgRef.current!.getBoundingClientRect();
        const s = g.vb.w / rect.width;
        setVb({...g.vb, x: g.vb.x - (e.clientX - g.startClient[0]) * s, y: g.vb.y - (e.clientY - g.startClient[1]) * s});
        return;
      }
      if (g.mode === 'vertex' && g.moved && g.from) {
        const store = useTraceStore.getState();
        const attached = store.draft.walls.filter((w) => dist(w.a, g.from!) < 0.5 || dist(w.b, g.from!) < 0.5);
        const other = attached.length === 1 ? (dist(attached[0]!.a, g.from) < 0.5 ? attached[0]!.b : attached[0]!.a) : null;
        const snapped = snapPoint(store.draft, p, {radius, from: other, free: e.shiftKey, excludeWallIds: attached.map((w) => w.id)});
        const from = g.from;
        store.patch((d) => moveVertex(d, from, snapped.p));
        g.from = snapped.p;
        setHover(snapped);
        return;
      }
    }
    updateHover(p, e.shiftKey);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const store = useTraceStore.getState();
    if (g.mode === 'vertex') {
      setHover(null);
      return;
    }
    if (g.moved) return;
    if (g.mode === 'pan') {
      if (tool === 'select') store.select(g.hit ?? null);
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (tool === 'wall') {
      const s = snapPoint(store.draft, p, {radius, from: chain.at(-1) ?? null, free: e.shiftKey});
      const last = chain.at(-1);
      if (last && dist(last, s.p) > 1) {
        store.commit((d) => ({
          ...d,
          walls: [
            ...d.walls,
            {id: uid('w'), a: last, b: s.p, thickness: guessThickness(d, k), kind: store.wallKind, source: 'manual', confirmed: true},
          ],
        }));
      }
      // 回到起点就收尾
      if (chain.length > 1 && dist(chain[0]!, s.p) < 0.5) setChain([]);
      else setChain((c) => [...c, s.p]);
    } else if (tool === 'room') {
      const s = snapPoint(store.draft, p, {radius, from: chain.at(-1) ?? null, free: e.shiftKey});
      if (chain.length >= 3 && dist(chain[0]!, s.p) <= radius) finishChain();
      else setChain((c) => [...c, s.p]);
    } else if (tool === 'door' || tool === 'window' || tool === 'slidingDoor') {
      const placed = openingAt(p);
      if (placed) {
        const o = {...placed, id: uid('o')};
        store.commit((d) => ({...d, openings: [...d.openings, o]}));
      }
    } else if (tool === 'calibrate') {
      store.addCalibPoint(p);
    }
  };

  const selId = (kind: 'wall' | 'opening' | 'room') => (selection?.kind === kind ? selection.id : null);
  const selectedWall = selection?.kind === 'wall' ? draft.walls.find((w) => w.id === selection.id) : undefined;
  const last = chain.at(-1);
  const cursor = spaceDown ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const hasDraft = draft.walls.length + draft.rooms.length > 0;

  return (
    <svg
      ref={svgRef}
      className="tr-canvas"
      style={{cursor}}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        setOpeningPreview(null);
      }}
      onDoubleClick={finishChain}
      onContextMenu={(e) => {
        e.preventDefault();
        finishChain();
      }}
      aria-label="户型图校对画布"
    >
      <image href={image.dataUrl} x={0} y={0} width={image.width} height={image.height} opacity={hasDraft ? 0.5 : 1} preserveAspectRatio="none" />
      <RoomsLayer draft={draft} selectedId={selId('room')} k={k} />
      <WallsLayer draft={draft} selectedId={selId('wall')} />
      <OpeningsLayer draft={draft} selectedId={selId('opening')} scale={scale} />

      {selectedWall && tool === 'select' &&
        [selectedWall.a, selectedWall.b].map((p, i) => (
          <circle key={i} data-vertex={`${p[0]},${p[1]}`} cx={p[0]} cy={p[1]} r={6 * k} className="tr-vertex" />
        ))}

      {/* 进行中的墙 / 房间 */}
      {chain.length > 0 && tool === 'room' && <polygon points={pts(hover ? [...chain, hover.p] : chain)} className="tr-room-draft" />}
      {chain.length > 0 && tool === 'wall' && <polyline points={pts(chain)} className="tr-chain" strokeWidth={guessThickness(draft, k)} />}
      {last && hover && (tool === 'wall' || tool === 'room') && (
        <line x1={last[0]} y1={last[1]} x2={hover.p[0]} y2={hover.p[1]} className={`tr-rubber tr-rubber--${wallKind}`} strokeWidth={tool === 'wall' ? guessThickness(draft, k) : 2 * k} />
      )}
      {last && hover && tool === 'wall' && <LengthLabel a={last} b={hover.p} k={k} />}
      {hover?.guides.x !== undefined && <line x1={hover.guides.x} y1={vb.y} x2={hover.guides.x} y2={vb.y + vb.h} className="tr-guide" />}
      {hover?.guides.y !== undefined && <line x1={vb.x} y1={hover.guides.y} x2={vb.x + vb.w} y2={hover.guides.y} className="tr-guide" />}
      {hover && (tool === 'wall' || tool === 'room' || tool === 'calibrate' || gesture.current?.mode === 'vertex') && (
        <circle cx={hover.p[0]} cy={hover.p[1]} r={(hover.kind === 'endpoint' || hover.kind === 'wall' ? 6 : 4) * k} className={`tr-cursor ${hover.kind ? `is-${hover.kind}` : ''}`} />
      )}
      {openingPreview && <OpeningShape o={openingPreview} wall={draft.walls.find((w) => w.id === openingPreview.wallId)} preview />}

      {/* 标定线 */}
      {calib.length > 0 && (
        <g className="tr-calib">
          {calib.length === 2 && <line x1={calib[0]![0]} y1={calib[0]![1]} x2={calib[1]![0]} y2={calib[1]![1]} strokeWidth={2 * k} />}
          {calib.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={5 * k} strokeWidth={2 * k} />
          ))}
          {calib.length === 2 && calibMm && (
            <text x={(calib[0]![0] + calib[1]![0]) / 2} y={(calib[0]![1] + calib[1]![1]) / 2 - 10 * k} fontSize={13 * k} textAnchor="middle">
              {calibMm} mm
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

function LengthLabel({a, b, k}: {a: P; b: P; k: number}) {
  const scale = useTraceStore((s) => {
    const img = s.image;
    return img ? roughScale(s.draft, s.calib, s.calibMm, img.width) : null;
  });
  const calibrated = useTraceStore((s) => (s.calib.length === 2 && Number(s.calibMm) > 0) || s.draft.dimensions.length > 0);
  if (!scale) return null;
  const mm = Math.round((dist(a, b) * scale) / 10) * 10;
  return (
    <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 12 * k} fontSize={12 * k} textAnchor="middle" className="tr-length">
      {calibrated ? '' : '约 '}
      {mm} mm
    </text>
  );
}

/** 新墙的像素厚度：跟随已有墙的中位数，没有就按 6 个屏幕像素 */
function guessThickness(d: Draft, k: number): number {
  const t = d.walls.map((w) => w.thickness).sort((x, y) => x - y);
  return t.length ? t[Math.floor(t.length / 2)]! : 6 * k;
}
