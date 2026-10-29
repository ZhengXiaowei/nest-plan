import {useSyncExternalStore} from 'react';
import {withViewTransition} from './viewTransition';

/** 几个页面用 hash 路由就够了，不引路由库；? 后面是页面参数（一起选的分享内容放在这里，不会发给服务器） */
export type Route = 'trace' | 'design' | 'replay' | 'vote';
const ROUTES: Route[] = ['trace', 'design', 'replay', 'vote'];

function read(): Route {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(r) ? r : 'design';
}

/** 当前 hash 里 ? 后面的参数 */
export function hashParams(): URLSearchParams {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1));
}

/** 换掉 hash 但不留历史、不触发页面切换（读完链接参数后清掉） */
export function replaceHash(route: Route) {
  history.replaceState(null, '', `${location.pathname}${location.search}#/${route}`);
}

let current = read();
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  const next = read();
  if (next === current) return;
  withViewTransition(() => {
    current = next;
    listeners.forEach((l) => l());
  });
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(route: Route) {
  location.hash = `/${route}`;
}
