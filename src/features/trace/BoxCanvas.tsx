import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {projectOnSegment} from '../../model/snap';
import {
  attachMarks,
  clipAgainst,
  markWidthMm,
  MARK_LABEL,
  normBox,
  roomRect,
  snapToBoxes,
  suggestName,
  wallAt,
  wallTypes,
  wallsFromBoxes,
  type Box,
  type BoxWall,
} from './boxes';
import {boxScale, roughBoxScale, useBoxStore} from './boxStore';
import {MANUAL_THICKNESS, type P} from './draft';
import {grayOf} from './gray';
import {autoBox, snapEdge, type Gray} from './imageScan';
import type {LoadedImage} from './image';
import './trace.css';

type VB = {x: number; y: number; w: number; h: number};
type Side = 'x0' | 'x1' | 'y0' | 'y1';

interface Gesture {
  mode: 'pan' | 'draw' | 'move' | 'resize' | 'tap';
  startClient: P;
  start: P;
  vb: VB;
  moved: boolean;
  box?: Box;
  sides?: Side[];
}

const fmtM = (mm: number) => (mm / 1000).toFixed(mm < 10000 ? 2 : 1);

/**
 * 框房间的画布。第 1 步拖框、拖边、双击自动框；第 2 步用笔刷点墙；第 3 步点墙量长度。
 * 拖动画布：第 1 步按住空格或右键拖，其他步骤直接拖；滚轮缩放。
 */
export function BoxCanvas({image}: {image: LoadedImage}) {
  const step = useBoxStore((s) => s.step);
  const boxes = useBoxStore((s) => s.boxes);
  const marks = useBoxStore((s) => s.marks);
  const wallMarks = useBoxStore((s) => s.wallMarks);
  const selected = useBoxStore((s) => s.selected);
  const brush = useBoxStore((s) => s.brush);
  const measure = useBoxStore((s) => s.measure);
  const area = useBoxStore((s) => s.area);
  const hintScale = useBoxStore((s) => s.hintScale);
  const cutting = useBoxStore((s) => s.cutting);

  const [scan, setScan] = useState<{gray: Gray; wall: number | null} | null>(null);
  useEffect(() => {
    let alive = true;
    void grayOf(image).then((r) => alive && setScan(r));
    return () => {
      alive = false;
    };
  }, [image]);

  const real = useMemo(() => boxScale({boxes, wallMarks, area, measure, hintScale}), [boxes, wallMarks, area, measure, hintScale]);
  const s = real?.mmPerPixel ?? roughBoxScale(scan?.wall ?? null, image.width);
  const t = scan?.wall ?? 240 / s;
  const walls = useMemo(() => wallsFromBoxes(boxes), [boxes]);
  const tol = Math.max(6, 300 / s);
  const types = useMemo(() => wallTypes(walls, wallMarks, tol), [walls, wallMarks, tol]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<VB>({x: 0, y: 0, w: image.width, h: image.height});
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const [k, setK] = useState(1);
  const [draftRect, setDraftRect] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const [hover, setHover] = useState<P | null>(null);
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

  const toImage = useCallback((cx: number, cy: number): P => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

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
        const sc = v.w / rect.width;
        setVb({...v, x: v.x + e.deltaX * sc, y: v.y + e.deltaY * sc});
      }
    };
    svg.addEventListener('wheel', onWheel, {passive: false});
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toImage, image.width]);

  // 键盘：空格平移、Delete 删方框、Esc 取消选择、⌘Z 撤销
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const store = useBoxStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
      } else if (e.key === 'Escape') {
        if (store.cutting) store.setCutting(false);
        else store.select(null);
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selected) store.removeBox(store.selected);
      else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      }
    };
    const onUp = (e: KeyboardEvent) => e.key === ' ' && setSpaceDown(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /** 方框边先吸图上墙线，再吸旁边方框的边 */
  const snapBox = (b: Box, sides: Side[], others: readonly Box[]): Box => {
    let out = normBox(b);
    if (scan) {
      const range = Math.max(1.5 * t, 10 * k);
      for (const side of sides) {
        const v = side === 'x0' || side === 'x1' ? snapEdge(scan.gray, 'v', out[side], out.y0, out.y1, range, t * 1.1) : snapEdge(scan.gray, 'h', out[side], out.x0, out.x1, range, t * 1.1);
        if (v !== null) out = {...out, [side]: v};
      }
    }
    return normBox(snapToBoxes(out, others, Math.max(12 * k, 0.8 * t), sides));
  };

  /** 整体平移后吸到旁边方框：竖边、横边各找最近的一处 */
  const snapMove = (b: Box, others: readonly Box[]): Box => {
    const lim = Math.max(12 * k, 0.8 * t);
    const best = (vals: number[], targets: number[]) => {
      let d: number | null = null;
      for (const v of vals) for (const x of targets) if (Math.abs(x - v) <= lim && (d === null || Math.abs(x - v) < Math.abs(d))) d = x - v;
      return d ?? 0;
    };
    const os = others.filter((o) => o.id !== b.id);
    const dx = best([b.x0, b.x1], os.flatMap((o) => [o.x0, o.x1]));
    const dy = best([b.y0, b.y1], os.flatMap((o) => [o.y0, o.y1]));
    return {...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy};
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = toImage(e.clientX, e.clientY);
    const base = {startClient: [e.clientX, e.clientY] as P, start, vb: vbRef.current, moved: false};
    const store = useBoxStore.getState();
    if (e.button === 1 || e.button === 2 || spaceDown) {
      gesture.current = {...base, mode: 'pan'};
      return;
    }
    if (step !== 1 || store.cutting) {
      gesture.current = {...base, mode: 'tap'};
      return;
    }
    const target = e.target as Element;
    const handle = target.getAttribute('data-handle');
    const hitBox = target.closest('[data-box]')?.getAttribute('data-box');
    if (handle) {
      const [id, sides] = handle.split(':') as [string, string];
      const box = store.boxes.find((b) => b.id === id);
      if (box) gesture.current = {...base, mode: 'resize', box, sides: sides.split(',') as Side[]};
    } else if (hitBox) {
      store.select(hitBox);
      const box = store.boxes.find((b) => b.id === hitBox);
      if (box) gesture.current = {...base, mode: 'move', box};
    } else {
      gesture.current = {...base, mode: 'draw'};
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toImage(e.clientX, e.clientY);
    const g = gesture.current;
    if (!g) {
      if (step === 2 || cutting) setHover(p);
      return;
    }
    const moved = Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) > 3;
    if (moved && !g.moved) {
      g.moved = true;
      if (g.mode === 'move' || g.mode === 'resize') useBoxStore.getState().checkpoint();
    }
    if (!g.moved) return;
    if (g.mode === 'pan' || g.mode === 'tap') {
      const rect = svgRef.current!.getBoundingClientRect();
      const sc = g.vb.w / rect.width;
      setVb({...g.vb, x: g.vb.x - (e.clientX - g.startClient[0]) * sc, y: g.vb.y - (e.clientY - g.startClient[1]) * sc});
      setHover(null);
    } else if (g.mode === 'draw') {
      setDraftRect({x0: g.start[0], y0: g.start[1], x1: p[0], y1: p[1]});
    } else if (g.box) {
      const [dx, dy] = [p[0] - g.start[0], p[1] - g.start[1]];
      const b = g.box;
      const next: Box =
        g.mode === 'move'
          ? {...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy}
          : {
              ...b,
              ...(g.sides!.includes('x0') ? {x0: b.x0 + dx} : {}),
              ...(g.sides!.includes('x1') ? {x1: b.x1 + dx} : {}),
              ...(g.sides!.includes('y0') ? {y0: b.y0 + dy} : {}),
              ...(g.sides!.includes('y1') ? {y1: b.y1 + dy} : {}),
            };
      useBoxStore.getState().patch((st) => ({boxes: st.boxes.map((x) => (x.id === b.id ? next : x))}));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const store = useBoxStore.getState();
    const p = toImage(e.clientX, e.clientY);
    if (g.mode === 'draw') {
      setDraftRect(null);
      const raw = normBox({x0: g.start[0], y0: g.start[1], x1: p[0], y1: p[1]});
      if (!g.moved || raw.x1 - raw.x0 < Math.max(2 * t, 16 * k) || raw.y1 - raw.y0 < Math.max(2 * t, 16 * k)) {
        store.select(null);
        return;
      }
      const b = snapBox({id: '_new', name: '', source: 'manual', ...raw}, ['x0', 'x1', 'y0', 'y1'], store.boxes);
      store.addBox({...b, name: suggestName(store.boxes)}, {cut: true});
    } else if (g.mode === 'move' && g.moved && g.box) {
      const cur = store.boxes.find((b) => b.id === g.box!.id);
      if (cur) store.patch((st) => ({boxes: st.boxes.map((x) => (x.id === cur.id ? snapMove(cur, st.boxes) : x))}));
    } else if (g.mode === 'resize' && g.moved && g.box) {
      const cur = store.boxes.find((b) => b.id === g.box!.id);
      if (cur) store.patch((st) => ({boxes: st.boxes.map((x) => (x.id === cur.id ? snapBox(cur, g.sides!, st.boxes.filter((o) => o.id !== cur.id)) : x))}));
    } else if (g.mode === 'tap' && !g.moved) {
      if (step === 1 && store.cutting) {
        const c = sel && cutLine(sel, p);
        if (c) store.splitBox(sel.id, c.axis, c.at);
        else store.setCutting(false);
      } else if (step === 2) store.tapWall(p, s);
      else if (step === 3) {
        const w = wallAt(walls, p, Math.max(tol, 10 * k));
        if (w) store.setMeasure({wallId: w.id, mm: store.measure?.wallId === w.id ? store.measure.mm : ''});
      }
    }
  };

  /** 切开选中方框的位置：垂直于长边，跟着鼠标，吸到图上的墙线；点在方框外返回 null */
  const cutLine = (box: Box, p: P): {axis: 'h' | 'v'; at: number} | null => {
    const b = normBox(box);
    if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) return null;
    const axis = b.x1 - b.x0 > b.y1 - b.y0 ? 'v' : 'h';
    const [lo, hi, pos] = axis === 'v' ? [b.x0, b.x1, p[0]] : [b.y0, b.y1, p[1]];
    const snapped = scan ? snapEdge(scan.gray, axis, pos, axis === 'v' ? b.y0 : b.x0, axis === 'v' ? b.y1 : b.x1, Math.max(1.5 * t, 10 * k), t * 1.1) : null;
    const min = Math.max(t, 8 * k);
    const at = Math.max(lo + min, Math.min(hi - min, snapped ?? pos));
    return {axis, at};
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (step !== 1 || !scan || cutting) return;
    if ((e.target as Element).closest('[data-box]')) return;
    const p = toImage(e.clientX, e.clientY);
    const store = useBoxStore.getState();
    const found = autoBox(scan.gray, p, t);
    const r = found && clipAgainst(found, store.boxes, p);
    if (!r) {
      store.select(null);
      window.dispatchEvent(new CustomEvent('np-box-miss'));
      return;
    }
    const b = normBox(snapToBoxes({id: '_new', name: '', source: 'manual', ...r}, store.boxes, Math.max(12 * k, 0.8 * t)));
    store.addBox({...b, name: suggestName(store.boxes)});
  };

  // 第 2 步：鼠标下的墙和要放的门窗预览
  const hoverWall = step === 2 && hover ? wallAt(walls, hover, Math.max(tol, 10 * k)) : null;
  const sel = boxes.find((b) => b.id === selected);
  const preview = hoverWall && hover && brush !== 'bearing' && brush !== 'open' && !types.get(hoverWall.id)?.open ? markPreview(hoverWall, projectOnSegment(hover, hoverWall.a, hoverWall.b).point, brush, s) : null;
  const attached = useMemo(() => attachMarks(walls.filter((w) => !types.get(w.id)?.open), marks, tol), [walls, types, marks, tol]);
  const cut = cutting && sel && hover ? cutLine(sel, hover) : null;
  const cursor = spaceDown ? 'grab' : cutting ? (cut ? (cut.axis === 'v' ? 'col-resize' : 'row-resize') : 'default') : step === 1 ? 'crosshair' : hoverWall || step === 3 ? 'pointer' : 'grab';

  return (
    <svg
      ref={svgRef}
      className="tr-canvas"
      style={{cursor}}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="框房间画布"
    >
      <image href={image.dataUrl} x={0} y={0} width={image.width} height={image.height} opacity={step === 1 ? 0.9 : 0.4} preserveAspectRatio="none" />

      {boxes.map((b) => {
        const r = roomRect(b, walls, types, s);
        const n = normBox(b);
        const label = step === 3 || real ? `${fmtM((r.x1 - r.x0) * s)} × ${fmtM((r.y1 - r.y0) * s)} m` : null;
        // 名字贴在方框左上角，免得盖住图上原来的房间名
        const fs = 13 * k;
        const pad = 5 * k;
        const tagW = Math.max(b.name.length, 2) * fs + pad * 2;
        return (
          <g key={b.id} data-box={step === 1 ? b.id : undefined} className={['bx-box', b.id === selected && 'is-selected', step !== 1 && 'is-quiet'].filter(Boolean).join(' ')}>
            <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={n.y1 - n.y0} />
            <g className="bx-tag" transform={`translate(${n.x0 + 4 * k} ${n.y0 + 4 * k})`}>
              <rect width={tagW} height={fs + pad * 1.6} rx={4 * k} />
              <text x={pad} y={(fs + pad * 1.6) / 2} fontSize={fs} className="bx-name">
                {b.name}
              </text>
              {label && (
                <text x={pad / 2} y={fs + pad * 1.6 + 10 * k} fontSize={12 * k} className={real ? 'bx-size' : 'bx-size is-rough'}>
                  {real ? label : `约 ${label}`}
                </text>
              )}
            </g>
          </g>
        );
      })}

      {step !== 1 && (
        <g>
          {walls.map((w) => {
            const ty = types.get(w.id)!;
            const isMeasure = measure?.wallId === w.id;
            if (ty.open)
              return (
                <line
                  key={w.id}
                  x1={w.a[0]}
                  y1={w.a[1]}
                  x2={w.b[0]}
                  y2={w.b[1]}
                  strokeWidth={2 * k}
                  strokeDasharray={`${4 * k} ${4 * k}`}
                  className={['bx-wall', 'bx-wall--open', w === hoverWall && 'is-hover'].filter(Boolean).join(' ')}
                />
              );
            return (
              <line
                key={w.id}
                x1={w.a[0]}
                y1={w.a[1]}
                x2={w.b[0]}
                y2={w.b[1]}
                strokeWidth={MANUAL_THICKNESS[ty.kind] / s}
                strokeDasharray={ty.guessed ? `${10 * k} ${6 * k}` : undefined}
                className={['bx-wall', `bx-wall--${ty.kind}`, ty.guessed && 'is-guessed', !ty.verified && 'is-unverified', (w === hoverWall || isMeasure) && 'is-hover'].filter(Boolean).join(' ')}
              />
            );
          })}
          {attached.map(({mark, wall}) => {
            const o = markPreview(wall, mark.at, mark.kind, s);
            return <MarkShape key={mark.id} a={o.a} b={o.b} kind={mark.kind} guessed={mark.guessed} width={MANUAL_THICKNESS[types.get(wall.id)!.kind] / s} k={k} />;
          })}
          {preview && hoverWall && <MarkShape a={preview.a} b={preview.b} kind={brush as Exclude<typeof brush, 'bearing' | 'open'>} preview width={MANUAL_THICKNESS[types.get(hoverWall.id)!.kind] / s} k={k} />}
          {step === 3 && measure && <MeasureLabel wall={walls.find((w) => w.id === measure.wallId)} mm={measure.mm} s={s} k={k} />}
        </g>
      )}

      {step === 1 && sel && !cutting && <Handles box={sel} k={k} />}
      {cut && sel && (
        <line
          x1={cut.axis === 'v' ? cut.at : Math.min(sel.x0, sel.x1)}
          x2={cut.axis === 'v' ? cut.at : Math.max(sel.x0, sel.x1)}
          y1={cut.axis === 'h' ? cut.at : Math.min(sel.y0, sel.y1)}
          y2={cut.axis === 'h' ? cut.at : Math.max(sel.y0, sel.y1)}
          strokeWidth={3 * k}
          strokeDasharray={`${8 * k} ${5 * k}`}
          className="bx-cut"
        />
      )}
      {draftRect && <rect {...rectAttrs(draftRect)} className="bx-draft" />}
    </svg>
  );
}

const rectAttrs = (r: {x0: number; y0: number; x1: number; y1: number}) => ({
  x: Math.min(r.x0, r.x1),
  y: Math.min(r.y0, r.y1),
  width: Math.abs(r.x1 - r.x0),
  height: Math.abs(r.y1 - r.y0),
});

/** 门窗在墙上的起止点（像素） */
function markPreview(wall: BoxWall, at: P, kind: keyof typeof MARK_LABEL, s: number): {a: P; b: P} {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const half = Math.min(markWidthMm(kind, len * s) / s, len) / 2;
  const t = projectOnSegment(at, wall.a, wall.b).t * len;
  const c = Math.max(half, Math.min(len - half, t));
  const u: P = [(wall.b[0] - wall.a[0]) / (len || 1), (wall.b[1] - wall.a[1]) / (len || 1)];
  return {a: [wall.a[0] + u[0] * (c - half), wall.a[1] + u[1] * (c - half)], b: [wall.a[0] + u[0] * (c + half), wall.a[1] + u[1] * (c + half)]};
}

function MarkShape({a, b, kind, guessed, preview, width, k}: {a: P; b: P; kind: keyof typeof MARK_LABEL; guessed?: boolean; preview?: boolean; width: number; k: number}) {
  const cls = ['bx-mark', `bx-mark--${kind}`, guessed && 'is-guessed', preview && 'is-preview'].filter(Boolean).join(' ');
  return (
    <g className={cls}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={width + 3 * k} className="bx-mark-body" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={Math.max(2 * k, width / 3)} className="bx-mark-core" />
      {(kind === 'entry' || preview) && (
        <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - width / 2 - 6 * k} fontSize={12 * k} className="bx-mark-label">
          {MARK_LABEL[kind]}
        </text>
      )}
    </g>
  );
}

function MeasureLabel({wall, mm, s, k}: {wall?: BoxWall; mm: string; s: number; k: number}) {
  if (!wall) return null;
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const text = Number(mm) > 0 ? `${mm} mm` : `约 ${Math.round((len * s) / 10) * 10} mm，填实际长度`;
  const [x, y] = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
  return (
    <text x={x} y={y - 14 * k} fontSize={13 * k} className="bx-measure" textAnchor="middle">
      {text}
    </text>
  );
}

/** 选中方框的四条边、四个角，拖动调整 */
function Handles({box: raw, k}: {box: Box; k: number}) {
  const b = normBox(raw);
  const hit = 10 * k;
  const edges: [Side[], number, number, number, number][] = [
    [['y0'], b.x0, b.y0, b.x1, b.y0],
    [['y1'], b.x0, b.y1, b.x1, b.y1],
    [['x0'], b.x0, b.y0, b.x0, b.y1],
    [['x1'], b.x1, b.y0, b.x1, b.y1],
  ];
  const corners: [Side[], number, number][] = [
    [['x0', 'y0'], b.x0, b.y0],
    [['x1', 'y0'], b.x1, b.y0],
    [['x0', 'y1'], b.x0, b.y1],
    [['x1', 'y1'], b.x1, b.y1],
  ];
  return (
    <g>
      {edges.map(([sides, x1, y1, x2, y2]) => (
        <line key={sides.join()} data-handle={`${raw.id}:${sides.join(',')}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={hit} className={`bx-edge ${sides[0]!.startsWith('x') ? 'is-v' : 'is-h'}`} />
      ))}
      {corners.map(([sides, x, y]) => (
        <rect key={sides.join()} data-handle={`${raw.id}:${sides.join(',')}`} x={x - 5 * k} y={y - 5 * k} width={10 * k} height={10 * k} className="bx-corner" />
      ))}
    </g>
  );
}

