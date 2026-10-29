/// <reference lib="webworker" />
import {computeSunlight} from '../../model/sunlight';
import type {Plan, Site} from '../../model/types';

export interface SunJob {
  id: number;
  plan: Plan;
  site: Site;
  doy: number;
  cell: number;
}

/** 日照要打几十万条光线，放到后台线程算，不卡界面 */
self.onmessage = (e: MessageEvent<SunJob>) => {
  const {id, plan, site, doy, cell} = e.data;
  const r = computeSunlight(plan, site, doy, {cell});
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({id, result: r}, [r.lit.buffer, r.hours.buffer, r.room.buffer]);
};
