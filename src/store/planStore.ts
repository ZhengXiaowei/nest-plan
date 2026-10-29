import {create} from 'zustand';
import type {Furniture, MaterialId, Measure, Plan, Site, Wall} from '../model/types';
import {createSamplePlan} from '../model/samplePlan';
import {normAngle} from '../model/geometry';
import {canDemolish, pushOut, wallRects} from '../model/walls';
import {idbGet, idbSet} from '../lib/idb';
import {uid} from '../lib/id';

export type Selection = {kind: 'furniture' | 'room' | 'wall' | 'opening' | 'measure'; id: string} | null;

/** 拆墙的结果，界面据此提示 */
export type DemolishResult = 'demolished' | 'restored' | 'removed' | 'bearing' | 'exterior';

/** 旧版本存档补齐新字段 */
export function normalizePlan(p: Plan): Plan {
  return {...p, demolished: p.demolished ?? [], measures: p.measures ?? []};
}

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
  /** 复制选中的家具，错开一点放 */
  duplicateSelected: () => void;
  /** 方向键微调选中的家具 */
  nudgeSelected: (dx: number, dy: number) => void;
  /** 置于顶层 / 底层（决定平面图上的遮挡顺序） */
  reorderFurniture: (id: string, to: 'top' | 'bottom') => void;
  clearFurniture: () => void;
  setRoomMaterial: (roomId: string, material: MaterialId) => void;
  renameRoom: (roomId: string, name: string) => void;
  setPrice: (material: MaterialId, price: number | null) => void;
  /** 改位置和朝向；拖指南针时 live=true 不记历史（按下时自己 checkpoint） */
  setSite: (site: Site, live?: boolean) => void;
  /** 整个换掉方案（导入、重置），可撤销 */
  replacePlan: (plan: Plan) => void;

  /** 拆除 / 恢复非承重墙；新砌的墙直接删掉 */
  toggleDemolish: (wallId: string) => DemolishResult;
  addWalls: (walls: Wall[]) => void;
  addMeasure: (m: Measure) => void;
  clearMeasures: () => void;
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
  loadPlan: (plan) => set({plan: normalizePlan(plan), selection: null, past: [], future: []}),
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
    const [cx, cy] = pushOut(wallRects(get().plan), f);
    const placed = {...f, cx, cy};
    // 地毯放在最底层，不挡住上面的家具
    get().commit((p) => ({...p, furniture: f.type === 'rug' ? [placed, ...p.furniture] : [...p.furniture, placed]}));
    set({selection: {kind: 'furniture', id: f.id}});
  },
  removeSelected: () => {
    const sel = get().selection;
    if (!sel) return;
    if (sel.kind === 'furniture') {
      get().commit((p) => ({...p, furniture: p.furniture.filter((f) => f.id !== sel.id)}));
    } else if (sel.kind === 'measure') {
      get().commit((p) => ({...p, measures: p.measures.filter((m) => m.id !== sel.id)}));
    } else if (sel.kind === 'wall') {
      const w = get().plan.walls.find((x) => x.id === sel.id);
      if (!w || !canDemolish(w) || get().plan.demolished.includes(w.id)) return;
      get().toggleDemolish(w.id);
    } else return;
    set({selection: null});
  },
  duplicateSelected: () => {
    const sel = get().selection;
    const f = sel?.kind === 'furniture' && get().plan.furniture.find((x) => x.id === sel.id);
    if (!f) return;
    const copy = {...f, id: uid('f'), cx: f.cx + 300, cy: f.cy + 300};
    get().commit((p) => ({...p, furniture: [...p.furniture, copy]}));
    set({selection: {kind: 'furniture', id: copy.id}});
  },
  nudgeSelected: (dx, dy) => {
    const sel = get().selection;
    if (sel?.kind !== 'furniture') return;
    get().commit((p) => mapFurniture(p, sel.id, (f) => ({...f, cx: f.cx + dx, cy: f.cy + dy})));
  },
  reorderFurniture: (id, to) =>
    get().commit((p) => {
      const f = p.furniture.find((x) => x.id === id);
      if (!f) return p;
      const rest = p.furniture.filter((x) => x.id !== id);
      return {...p, furniture: to === 'top' ? [...rest, f] : [f, ...rest]};
    }),
  clearFurniture: () => {
    if (!get().plan.furniture.length) return;
    get().commit((p) => ({...p, furniture: []}));
    set({selection: null});
  },
  renameRoom: (roomId, name) =>
    get().commit((p) => ({...p, rooms: p.rooms.map((r) => (r.id === roomId ? {...r, name} : r))})),
  setPrice: (material, price) =>
    get().commit((p) => {
      const prices = {...p.prices};
      if (price === null) delete prices[material];
      else prices[material] = price;
      return {...p, prices};
    }),
  setSite: (site, live) => (live ? get().patch((p) => ({...p, site})) : get().commit((p) => ({...p, site}))),
  replacePlan: (plan) => {
    get().commit(() => normalizePlan(plan));
    set({selection: null});
  },
  setRoomMaterial: (roomId, material) =>
    get().commit((p) => ({...p, rooms: p.rooms.map((r) => (r.id === roomId ? {...r, material} : r))})),

  toggleDemolish: (wallId) => {
    const {plan} = get();
    const w = plan.walls.find((x) => x.id === wallId);
    if (!w) return 'restored';
    if (w.added) {
      get().commit((p) => ({...p, walls: p.walls.filter((x) => x.id !== wallId)}));
      if (get().selection?.id === wallId) set({selection: null});
      return 'removed';
    }
    if (w.kind === 'bearing') return 'bearing';
    if (w.kind === 'exterior') return 'exterior';
    const on = plan.demolished.includes(wallId);
    get().commit((p) => ({...p, demolished: on ? p.demolished.filter((x) => x !== wallId) : [...p.demolished, wallId]}));
    return on ? 'restored' : 'demolished';
  },
  addWalls: (walls) => get().commit((p) => ({...p, walls: [...p.walls, ...walls]})),
  addMeasure: (m) => get().commit((p) => ({...p, measures: [...p.measures, m]})),
  clearMeasures: () => get().commit((p) => ({...p, measures: []})),
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
