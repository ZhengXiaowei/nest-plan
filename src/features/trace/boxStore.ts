import {create} from 'zustand';
import {uid} from '../../lib/id';
import {projectOnSegment} from '../../model/snap';
import {
  attachMarks,
  isExterior,
  markWidthMm,
  newBox,
  normBox,
  scaleFromArea,
  scaleFromWall,
  wallAt,
  wallTypes,
  wallsFromBoxes,
  type Box,
  type BoxState,
  type BoxWall,
  type Mark,
  type MarkKind,
  type WallMark,
} from './boxes';
import type {P} from './draft';

/** 框房间流程的状态：方框、门窗、墙类型，带撤销 */

export type BoxStep = 1 | 2 | 3;
export type Brush = MarkKind | 'bearing' | 'open';

interface BoxStore extends BoxState {
  /** 'boxes' 框房间（默认）；'trace' 精修（原来的描墙） */
  mode: 'boxes' | 'trace';
  step: BoxStep;
  selected: string | null;
  brush: Brush;
  /** 套内面积，输入框原样 */
  area: string;
  /** 量墙定比例：哪面墙、多长 */
  measure: {wallId: string; mm: string} | null;
  /** 图上读到的比例（AI 识别的尺寸标注） */
  hintScale: number | null;
  /** 上次按图猜时方框的样子，方框没变就不重猜 */
  guessedFor: string;
  past: BoxState[];
  future: BoxState[];

  reset: () => void;
  setMode: (mode: BoxStore['mode']) => void;
  setStep: (step: BoxStep) => void;
  select: (id: string | null) => void;
  setBrush: (b: Brush) => void;
  setArea: (v: string) => void;
  setMeasure: (m: BoxStore['measure']) => void;
  setHintScale: (s: number | null) => void;
  checkpoint: () => void;
  /** 改状态并记一步撤销 */
  commit: (fn: (s: BoxState) => Partial<BoxState>) => void;
  /** 改状态不记撤销（拖动中） */
  patch: (fn: (s: BoxState) => Partial<BoxState>) => void;
  undo: () => void;
  redo: () => void;
  addBox: (b: Omit<Box, 'id' | 'source'> & {source?: Box['source']}) => string;
  removeBox: (id: string) => void;
  renameBox: (id: string, name: string) => void;
  /** 按图猜的结果替换之前猜的，用户点过的保留 */
  applyGuess: (g: {wallMarks: WallMark[]; marks: Omit<Mark, 'id'>[]}, signature: string) => void;
  /** 用当前笔刷点墙：放门窗或标承重；点到已有的就去掉 */
  tapWall: (p: P, mmPerPixel: number) => void;
  /** 室内墙都按现在的样子确认 */
  verifyAll: (mmPerPixel: number) => void;
}

const HISTORY = 100;
const empty = (): BoxState => ({boxes: [], marks: [], wallMarks: []});
const pick = (s: BoxState): BoxState => ({boxes: s.boxes, marks: s.marks, wallMarks: s.wallMarks});

export const boxSignature = (boxes: readonly Box[]) => boxes.map((b) => `${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1)},${Math.round(b.y1)}`).sort().join(';');

/** 吸附门窗、墙类型用的容差（像素） */
const tolOf = (mmPerPixel: number) => Math.max(6, 300 / mmPerPixel);

export const useBoxStore = create<BoxStore>()((set, get) => ({
  ...empty(),
  mode: 'boxes',
  step: 1,
  selected: null,
  brush: 'door',
  area: '',
  measure: null,
  hintScale: null,
  guessedFor: '',
  past: [],
  future: [],

  reset: () => set({...empty(), step: 1, selected: null, brush: 'door', area: '', measure: null, hintScale: null, guessedFor: '', past: [], future: []}),
  setMode: (mode) => set({mode}),
  setStep: (step) => set({step, selected: null, measure: step === 3 ? get().measure : null}),
  select: (selected) => set({selected}),
  setBrush: (brush) => set({brush}),
  setArea: (area) => set({area}),
  setMeasure: (measure) => set({measure}),
  setHintScale: (hintScale) => set({hintScale}),
  checkpoint: () => set((s) => ({past: [...s.past.slice(-HISTORY + 1), pick(s)], future: []})),
  commit: (fn) => {
    get().checkpoint();
    set((s) => fn(s));
  },
  patch: (fn) => set((s) => fn(s)),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      return prev ? {...prev, past: s.past.slice(0, -1), future: [pick(s), ...s.future], selected: null} : s;
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      return next ? {...next, past: [...s.past, pick(s)], future: s.future.slice(1), selected: null} : s;
    }),
  addBox: (b) => {
    const box = newBox(b.x0, b.y0, b.x1, b.y1, b.name, b.source);
    get().commit((s) => ({boxes: [...s.boxes, box]}));
    set({selected: box.id});
    return box.id;
  },
  removeBox: (id) => {
    get().commit((s) => ({boxes: s.boxes.filter((b) => b.id !== id)}));
    if (get().selected === id) set({selected: null});
  },
  renameBox: (id, name) => get().commit((s) => ({boxes: s.boxes.map((b) => (b.id === id ? {...b, name} : b))})),
  applyGuess: (g, signature) =>
    set((s) => ({
      marks: [...s.marks.filter((m) => !m.guessed), ...g.marks.map((m) => ({...m, id: uid('m')}))],
      wallMarks: [...s.wallMarks.filter((m) => !m.guessed), ...g.wallMarks],
      guessedFor: signature,
    })),
  tapWall: (p, mmPerPixel) => {
    const s = get();
    const walls = wallsFromBoxes(s.boxes);
    const tol = tolOf(mmPerPixel);
    const wall = wallAt(walls, p, tol);
    if (!wall) return;
    const on = projectOnSegment(p, wall.a, wall.b).point;
    if (s.brush === 'bearing' || s.brush === 'open') {
      if (isExterior(wall)) return;
      const cur = wallTypes(walls, s.wallMarks, tol).get(wall.id)!;
      const now = cur.open ? 'open' : cur.kind === 'bearing' ? 'bearing' : 'partition';
      const kind: WallMark['kind'] = now === s.brush ? 'partition' : s.brush;
      get().commit((st) => ({
        wallMarks: [...st.wallMarks.filter((m) => wallAt(walls, m.at, tol)?.id !== wall.id), {at: on, kind}],
      }));
      return;
    }
    // 点到已有门窗：同类去掉，别的类换成当前笔刷；入户门只有一个
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const hit = attachMarks([wall], s.marks, tol).find(({mark}) => {
      const half = markWidthMm(mark.kind, len * mmPerPixel) / mmPerPixel / 2;
      return Math.hypot(mark.at[0] - on[0], mark.at[1] - on[1]) <= half;
    })?.mark;
    get().commit((st) => {
      let marks = st.marks;
      if (hit) {
        marks = marks.filter((m) => m.id !== hit.id);
        if (hit.kind === s.brush) return {marks};
      }
      if (s.brush === 'entry') marks = marks.filter((m) => m.kind !== 'entry');
      return {marks: [...marks, {id: uid('m'), kind: s.brush as MarkKind, at: hit ? hit.at : on}]};
    });
  },
  verifyAll: (mmPerPixel) => {
    const s = get();
    const walls = wallsFromBoxes(s.boxes);
    const types = wallTypes(walls, s.wallMarks, tolOf(mmPerPixel));
    const mid = (w: BoxWall): P => [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    get().commit(() => ({
      wallMarks: walls.filter((w) => !isExterior(w)).map((w) => {
        const ty = types.get(w.id)!;
        return {at: mid(w), kind: ty.open ? 'open' : ty.kind === 'bearing' ? 'bearing' : 'partition'};
      }),
      marks: s.marks.map((m) => ({...m, guessed: false})),
    }));
  },
}));

/** 比例（mm/像素）：量墙 > 套内面积 > 图上尺寸标注 */
export function boxScale(s: Pick<BoxStore, 'boxes' | 'wallMarks' | 'area' | 'measure' | 'hintScale'>): {mmPerPixel: number; source: 'measure' | 'area' | 'hint'} | null {
  const walls = wallsFromBoxes(s.boxes);
  if (s.measure) {
    const w = walls.find((x) => x.id === s.measure!.wallId);
    const v = w && scaleFromWall(w, Number(s.measure.mm));
    if (v) return {mmPerPixel: v, source: 'measure'};
  }
  const area = Number(s.area);
  if (area > 0) {
    // 内缩量按粗估比例先算墙类型，类型只影响内缩，误差很小
    const rough = s.hintScale ?? 10;
    const v = scaleFromArea(s.boxes, walls, wallTypes(walls, s.wallMarks, tolOf(rough)), area);
    if (v) return {mmPerPixel: v, source: 'area'};
  }
  return s.hintScale ? {mmPerPixel: s.hintScale, source: 'hint'} : null;
}

/** 还没定比例时的粗估：墙厚约 240 mm，再不行按图片宽约 12 米 */
export const roughBoxScale = (wallPx: number | null, imageWidth: number) => (wallPx ? 240 / wallPx : 12000 / imageWidth);

export {normBox};

// 开发时方便在控制台和脚本里看状态
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as {__npBoxes?: typeof useBoxStore}).__npBoxes = useBoxStore;
