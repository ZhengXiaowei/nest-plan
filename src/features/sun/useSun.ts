import {useEffect} from 'react';
import {doyOf, siteOf} from '../../model/sun';
import {usePlanStore} from '../../store/planStore';
import {useDesignUi} from '../design/designUi';
import {useSunStore} from './sunStore';

/** 拿当前方案的日照结果；方案、位置或日期变了自动重算 */
export function useSunResult() {
  const plan = usePlanStore((s) => s.plan);
  const day = useDesignUi((s) => s.sunDay);
  const result = useSunStore((s) => s.result);
  const busy = useSunStore((s) => s.busy);
  useEffect(() => {
    useSunStore.getState().request(plan, siteOf(plan), doyOf(day));
  }, [plan, day]);
  return {result, busy};
}
