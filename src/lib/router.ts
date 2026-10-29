import {useSyncExternalStore} from 'react';
import {withViewTransition} from './viewTransition';

/** 三个页面用 hash 路由就够了，不引路由库 */
export type Route = 'trace' | 'design' | 'replay';
const ROUTES: Route[] = ['trace', 'design', 'replay'];

function read(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'design';
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
