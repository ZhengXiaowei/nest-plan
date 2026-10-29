import {flushSync} from 'react-dom';

/** 用 View Transitions API 包住一次状态切换；浏览器不支持或用户偏好减少动效时直接切换。 */
export function withViewTransition(update: () => void) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !document.startViewTransition) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
