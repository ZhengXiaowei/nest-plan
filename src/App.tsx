import {lazy, Suspense, useEffect, useState} from 'react';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {navigate, useRoute, type Route} from './lib/router';
import {BrandMark, IconRedo, IconSpark, IconUndo} from './lib/icons';
import {usePlanStore} from './store/planStore';
import {useAiSettings, isAiConfigured} from './features/ai/settings';
import {DesignPage} from './features/design/DesignPage';

// 还原页和回放页按需加载
const TracePage = lazy(() => import('./features/trace/TracePage'));
const ReplayPage = lazy(() => import('./features/replay/ReplayPage'));
const AiSettingsDialog = lazy(() => import('./features/ai/AiSettingsDialog'));

export function App() {
  const route = useRoute();
  useDesignShortcuts(route === 'design');

  return (
    <div className="np-app">
      <TopBar route={route} />
      <Suspense fallback={<div className="np-loading">加载中…</div>}>
        {route === 'trace' && <TracePage />}
        {route === 'design' && <DesignPage />}
        {route === 'replay' && <ReplayPage />}
      </Suspense>
      <AiDialogSlot />
    </div>
  );
}

/** 设置窗口第一次打开时才加载 */
function AiDialogSlot() {
  const open = useAiSettings((s) => s.dialogOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <AiSettingsDialog />
    </Suspense>
  );
}

function TopBar({route}: {route: Route}) {
  const planName = usePlanStore((s) => s.plan.name);
  const canUndo = usePlanStore((s) => s.past.length > 0);
  const canRedo = usePlanStore((s) => s.future.length > 0);
  const aiReady = useAiSettings((s) => isAiConfigured(s.settings));
  const openDialog = useAiSettings((s) => s.openDialog);

  return (
    <header className="np-topbar">
      <div className="np-brand">
        <BrandMark />
        栖图 <small>· {planName}</small>
      </div>
      <nav className="np-topbar-nav" aria-label="主导航">
        <SegmentedControl label="页面" value={route} onChange={(v) => navigate(v as Route)} size="sm">
          <SegmentedControlItem value="trace" label="户型还原" />
          <SegmentedControlItem value="design" label="设计" />
          <SegmentedControlItem value="replay" label="改造回放" />
        </SegmentedControl>
      </nav>
      <div className="np-topbar-actions">
        {route === 'design' && (
          <>
            <IconButton label="撤销" tooltip="撤销 ⌘Z" icon={<IconUndo />} variant="ghost" size="sm" isDisabled={!canUndo} onClick={() => usePlanStore.getState().undo()} />
            <IconButton label="重做" tooltip="重做 ⇧⌘Z" icon={<IconRedo />} variant="ghost" size="sm" isDisabled={!canRedo} onClick={() => usePlanStore.getState().redo()} />
          </>
        )}
        <Button label={aiReady ? 'AI 已连接' : '连接 AI'} icon={<IconSpark />} variant={aiReady ? 'secondary' : 'primary'} size="sm" onClick={() => openDialog(true)} />
      </div>
    </header>
  );
}

/** 设计页的快捷键；还原页有自己的一套 */
function useDesignShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const store = usePlanStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeSelected();
      } else if (e.key === 'r' && store.selection?.kind === 'furniture') {
        store.rotateFurniture(store.selection.id, e.shiftKey ? -90 : 90);
      } else if (e.key === 'Escape') {
        store.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
