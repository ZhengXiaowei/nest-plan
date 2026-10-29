import {create} from 'zustand';
import type {OpeningKind, WallKind} from '../../model/types';
import type {LoadedImage} from './image';
import {draftFromRecognized, emptyDraft, removeWall, type Draft, type P} from './draft';
import type {RecognizedPlan} from '../ai/recognize';

export type TraceTool = 'select' | 'wall' | 'door' | 'window' | 'slidingDoor' | 'room' | 'calibrate';
export type TraceSelection = {kind: 'wall' | 'opening' | 'room'; id: string} | null;

export const OPENING_TOOLS: Record<'door' | 'window' | 'slidingDoor', {kind: OpeningKind; widthMm: number; label: string}> = {
  door: {kind: 'door', widthMm: 900, label: '门'},
  window: {kind: 'window', widthMm: 1500, label: '窗'},
  slidingDoor: {kind: 'slidingDoor', widthMm: 2400, label: '推拉门'},
};

const HISTORY_LIMIT = 100;

interface TraceState {
  image: LoadedImage | null;
  draft: Draft;
  past: Draft[];
  future: Draft[];
  tool: TraceTool;
  wallKind: WallKind;
  selection: TraceSelection;
  /** 手动标定：图上两点和实际长度 */
  calib: P[];
  calibMm: string;

  setImage: (image: LoadedImage) => void;
  setRecognized: (r: RecognizedPlan) => void;
  checkpoint: () => void;
  patch: (fn: (d: Draft) => Draft) => void;
  commit: (fn: (d: Draft) => Draft) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: TraceTool) => void;
  setWallKind: (k: WallKind) => void;
  select: (sel: TraceSelection) => void;
  removeSelected: () => void;
  confirm: (kind: 'wall' | 'opening' | 'room', id: string) => void;
  confirmAll: () => void;
  addCalibPoint: (p: P) => void;
  setCalibMm: (v: string) => void;
}

export const useTraceStore = create<TraceState>()((set, get) => ({
  image: null,
  draft: emptyDraft(),
  past: [],
  future: [],
  tool: 'select',
  wallKind: 'partition',
  selection: null,
  calib: [],
  calibMm: '',

  setImage: (image) => set({image, draft: emptyDraft(), past: [], future: [], selection: null, calib: [], calibMm: '', tool: 'select'}),
  setRecognized: (r) => {
    get().checkpoint();
    set({draft: draftFromRecognized(r), selection: null});
  },
  checkpoint: () => set((s) => ({past: [...s.past.slice(-HISTORY_LIMIT + 1), s.draft], future: []})),
  patch: (fn) => set((s) => ({draft: fn(s.draft)})),
  commit: (fn) => {
    get().checkpoint();
    get().patch(fn);
  },
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      return prev ? {draft: prev, past: s.past.slice(0, -1), future: [s.draft, ...s.future], selection: null} : s;
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      return next ? {draft: next, past: [...s.past, s.draft], future: s.future.slice(1), selection: null} : s;
    }),
  setTool: (tool) => set({tool, selection: tool === 'select' ? get().selection : null}),
  setWallKind: (wallKind) => {
    set({wallKind});
    const sel = get().selection;
    if (sel?.kind === 'wall') get().commit((d) => ({...d, walls: d.walls.map((w) => (w.id === sel.id ? {...w, kind: wallKind} : w))}));
  },
  select: (selection) => {
    set({selection});
    if (selection?.kind === 'wall') {
      const w = get().draft.walls.find((x) => x.id === selection.id);
      if (w) set({wallKind: w.kind});
    }
  },
  removeSelected: () => {
    const sel = get().selection;
    if (!sel) return;
    get().commit((d) =>
      sel.kind === 'wall'
        ? removeWall(d, sel.id)
        : sel.kind === 'opening'
          ? {...d, openings: d.openings.filter((o) => o.id !== sel.id)}
          : {...d, rooms: d.rooms.filter((r) => r.id !== sel.id)},
    );
    set({selection: null});
  },
  confirm: (kind, id) =>
    get().commit((d) => {
      const mark = <T extends {id: string; confirmed?: boolean}>(xs: T[]) => xs.map((x) => (x.id === id ? {...x, confirmed: true} : x));
      return kind === 'wall' ? {...d, walls: mark(d.walls)} : kind === 'opening' ? {...d, openings: mark(d.openings)} : {...d, rooms: mark(d.rooms)};
    }),
  confirmAll: () =>
    get().commit((d) => ({
      ...d,
      walls: d.walls.map((x) => ({...x, confirmed: true})),
      openings: d.openings.map((x) => ({...x, confirmed: true})),
      rooms: d.rooms.map((x) => ({...x, confirmed: true})),
    })),
  addCalibPoint: (p) => set((s) => ({calib: s.calib.length >= 2 ? [p] : [...s.calib, p]})),
  setCalibMm: (calibMm) => set({calibMm}),
}));
