import {create} from 'zustand';
import type {Plan, Site} from '../../model/types';
import type {SunResult} from '../../model/sunlight';
import type {SunJob} from './sun.worker';

/**
 * 日照结果：方案、位置或日期变了就交给后台线程重算（防抖），
 * 结果回来前沿用上一次的，界面不闪。
 */
interface SunState {
  result: SunResult | null;
  /** 结果对应的输入，用来判断是否过期 */
  key: string;
  busy: boolean;
  request: (plan: Plan, site: Site, doy: number) => void;
}

let worker: Worker | null = null;
let seq = 0;
let timer = 0;

const CELL = 150;

export const useSunStore = create<SunState>()((set, get) => ({
  result: null,
  key: '',
  busy: false,
  request: (plan, site, doy) => {
    // 只有墙、门窗、房间和位置影响日照，家具挪动不重算
    const key = JSON.stringify([plan.walls, plan.openings, plan.rooms, plan.demolished, plan.wallHeight, site, doy]);
    if (key === get().key) return;
    set({busy: true, key});
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      worker ??= new Worker(new URL('./sun.worker.ts', import.meta.url), {type: 'module'});
      const id = ++seq;
      worker.onmessage = (e: MessageEvent<{id: number; result: SunResult}>) => {
        if (e.data.id === seq) set({result: e.data.result, busy: false});
      };
      const job: SunJob = {id, plan, site, doy, cell: CELL};
      worker.postMessage(job);
    }, 120);
  },
}));
