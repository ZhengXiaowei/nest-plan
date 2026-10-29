import {useEffect} from 'react';
import {create} from 'zustand';
import type {Checkup} from '../../model/checkup';
import type {Plan} from '../../model/types';
import {usePlanStore} from '../../store/planStore';
import type {CheckJob} from './check.worker';

/**
 * 体检结果：方案一变就交给后台线程重算（防抖），结果回来前沿用上一次的。
 */
interface CheckState {
  result: Checkup | null;
  key: string;
  busy: boolean;
  request: (plan: Plan) => void;
}

let worker: Worker | null = null;
let seq = 0;
let timer = 0;

export const useCheckStore = create<CheckState>()((set, get) => ({
  result: null,
  key: '',
  busy: false,
  request: (plan) => {
    const key = JSON.stringify([plan.walls, plan.openings, plan.rooms, plan.demolished, plan.furniture]);
    if (key === get().key) return;
    set({busy: true, key});
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      worker ??= new Worker(new URL('./check.worker.ts', import.meta.url), {type: 'module'});
      const id = ++seq;
      worker.onmessage = (e: MessageEvent<{id: number; result: Checkup}>) => {
        if (e.data.id === seq) set({result: e.data.result, busy: false});
      };
      const job: CheckJob = {id, plan};
      worker.postMessage(job);
    }, 150);
  },
}));

/** 拿当前方案的体检结果，方案变了自动重算 */
export function useCheckup() {
  const plan = usePlanStore((s) => s.plan);
  const result = useCheckStore((s) => s.result);
  const busy = useCheckStore((s) => s.busy);
  useEffect(() => {
    useCheckStore.getState().request(plan);
  }, [plan]);
  return {result, busy};
}
