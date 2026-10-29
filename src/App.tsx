import {lazy, Suspense, useEffect, useState} from 'react';
import {planView, useDesignUi, type DesignTool} from './features/design/designUi';
import {Toaster} from './lib/toast';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {navigate, useRoute, type Route} from './lib/router';
import {BrandMark, IconFile, IconRedo, IconSpark, IconUndo} from './lib/icons';
import {LazyMenu} from './features/design/LazyMenu';
import {toggleFullscreen} from './lib/fullscreen';
import {usePlanStore} from './store/planStore';
import {useAiSettings, isAiConfigured} from './features/ai/settings';
import {DesignPage} from './features/design/DesignPage';

// 还原页和回放页按需加载
const TracePage = lazy(() => import('./features/trace/TracePage'));
const ReplayPage = lazy(() => import('./features/replay/ReplayPage'));
const VotePage = lazy(() => import('./features/family/VotePage'));
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
        {route === 'vote' && <VotePage />}
      </Suspense>
      <AiDialogSlot />
      <Toaster />
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
          <SegmentedControlItem value="vote" label="一起选" />
        </SegmentedControl>
      </nav>
      <div className="np-topbar-actions">
        {route === 'design' && (
          <>
            <IconButton label="撤销" tooltip="撤销 ⌘Z" icon={<IconUndo />} variant="ghost" size="sm" isDisabled={!canUndo} onClick={() => usePlanStore.getState().undo()} />
            <IconButton label="重做" tooltip="重做 ⇧⌘Z" icon={<IconRedo />} variant="ghost" size="sm" isDisabled={!canRedo} onClick={() => usePlanStore.getState().redo()} />
            <LazyMenu kind="plan" label="方案" icon={<IconFile />} />
          </>
        )}
        <span className="np-wide-only">
          <Button label={aiReady ? 'AI 已连接' : '连接 AI'} icon={<IconSpark />} variant={aiReady ? 'secondary' : 'primary'} size="sm" onClick={() => openDialog(true)} />
        </span>
        <span className="np-narrow-only">
          <IconButton label={aiReady ? 'AI 已连接' : '连接 AI'} icon={<IconSpark />} variant={aiReady ? 'secondary' : 'primary'} size="sm" onClick={() => openDialog(true)} />
        </span>
      </div>
    </header>
  );
}

/** 设计页的快捷键；还原页有自己的一套 */
const TOOL_KEYS: Record<string, DesignTool> = {v: 'select', m: 'measure', x: 'demolish', b: 'build'};
const ARROWS: Record<string, [number, number]> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

function useDesignShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const store = usePlanStore.getState();
      const ui = useDesignUi.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const furniture = store.selection?.kind === 'furniture' ? store.selection.id : null;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (furniture) store.duplicateSelected();
      } else if (mod || e.altKey) {
        return;
      } else if (ARROWS[e.key] && furniture && ui.view === '2d') {
        e.preventDefault();
        const [dx, dy] = ARROWS[e.key]!;
        const step = e.shiftKey ? 100 : 10;
        store.nudgeSelected(dx * step, dy * step);
      } else if (ui.view === '2d' && !e.shiftKey && TOOL_KEYS[key]) {
        ui.setTool(TOOL_KEYS[key]!);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeSelected();
      } else if (key === 'r' && furniture) {
        store.rotateFurniture(furniture, e.shiftKey ? -90 : 90);
      } else if (key === 't') {
        ui.setView(ui.view === '2d' ? '3d' : '2d');
      } else if (key === 'f') {
        if (e.shiftKey) void toggleFullscreen();
        else if (ui.view === '2d') planView.fit();
      } else if (e.key === 'Escape') {
        store.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
