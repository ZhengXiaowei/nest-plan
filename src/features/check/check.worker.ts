/// <reference lib="webworker" />
import {runCheckup} from '../../model/checkup';
import type {Plan} from '../../model/types';

export interface CheckJob {
  id: number;
  plan: Plan;
}

/** 体检要铺一张 5 cm 的网格找路，放到后台线程，拖家具时不卡 */
self.onmessage = (e: MessageEvent<CheckJob>) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({id: e.data.id, result: runCheckup(e.data.plan)});
};
