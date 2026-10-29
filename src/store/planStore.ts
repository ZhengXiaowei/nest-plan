import {create} from 'zustand';
import type {Furniture, MaterialId, Plan} from '../model/types';
import {createSamplePlan} from '../model/samplePlan';
import {normAngle} from '../model/geometry';
import {idbGet, idbSet} from '../lib/idb';

export type Selection = {kind: 'furniture' | 'room' | 'wall' | 'opening'; id: string} | null;

const HISTORY_LIMIT = 100;
const SAVE_KEY = 'plan:current';

interface PlanState {
  plan: Plan;
  selection: Selection;
  past: Plan[];
  future: Plan[];

  /** 改动前调用一次，把当前状态压入撤销栈（拖拽时只在按下时调用） */
  checkpoint: () => void;
  /** 不记历史的更新，拖拽过程中用 */
  patch: (fn: (plan: Plan) => Plan) => void;
  /** 记历史的更新 */
  commit: (fn: (plan: Plan) => Plan) => void;

  select: (sel: Selection) => void;
  loadPlan: (plan: Plan) => void;
  undo: () => void;
  redo: () => void;

  moveFurniture: (id: string, cx: number, cy: number) => void;
  rotateFurniture: (id: string, delta: number) => void;
  updateFurniture: (id: string, change: Partial<Furniture>) => void;
  addFurniture: (f: Furniture) => void;
  removeSelected: () => void;
  setRoomMaterial: (roomId: string, material: MaterialId) => void;
}

const mapFurniture = (plan: Plan, id: string, fn: (f: Furniture) => Furniture): Plan => ({
  ...plan,
  furniture: plan.furniture.map((f) => (f.id === id ? fn(f) : f)),
});

export const usePlanStore = create<PlanState>()((set, get) => ({
  plan: createSamplePlan(),
  selection: null,
  past: [],
  future: [],

  checkpoint: () =>
    set((s) => ({past: [...s.past.slice(-HISTORY_LIMIT + 1), s.plan], future: []})),
  patch: (fn) => set((s) => ({plan: fn(s.plan)})),
  commit: (fn) => {
    get().checkpoint();
    get().patch(fn);
  },

  select: (selection) => set({selection}),
  loadPlan: (plan) => set({plan, selection: null, past: [], future: []}),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {plan: prev, past: s.past.slice(0, -1), future: [s.plan, ...s.future], selection: null};
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {plan: next, past: [...s.past, s.plan], future: s.future.slice(1), selection: null};
    }),

  moveFurniture: (id, cx, cy) => get().patch((p) => mapFurniture(p, id, (f) => ({...f, cx, cy}))),
  rotateFurniture: (id, delta) =>
    get().commit((p) => mapFurniture(p, id, (f) => ({...f, rot: normAngle(f.rot + delta)}))),
  updateFurniture: (id, change) => get().commit((p) => mapFurniture(p, id, (f) => ({...f, ...change}))),
  addFurniture: (f) => {
    get().commit((p) => ({...p, furniture: [...p.furniture, f]}));
    set({selection: {kind: 'furniture', id: f.id}});
  },
  removeSelected: () => {
    const sel = get().selection;
    if (sel?.kind !== 'furniture') return;
    get().commit((p) => ({...p, furniture: p.furniture.filter((f) => f.id !== sel.id)}));
    set({selection: null});
  },
  setRoomMaterial: (roomId, material) =>
    get().commit((p) => ({...p, rooms: p.rooms.map((r) => (r.id === roomId ? {...r, material} : r))})),
}));

/** 启动时从 IndexedDB 恢复方案，之后防抖自动保存 */
export async function initPersistence() {
  try {
    const saved = await idbGet<Plan>(SAVE_KEY);
    if (saved?.version === 1) usePlanStore.getState().loadPlan(saved);
  } catch {
    // 隐私模式等情况下 IndexedDB 可能不可用，忽略即可
  }
  let timer = 0;
  usePlanStore.subscribe((s, prev) => {
    if (s.plan === prev.plan) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void idbSet(SAVE_KEY, s.plan).catch(() => {}), 400);
  });
}
