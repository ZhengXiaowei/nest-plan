import {lazy, Suspense, useState} from 'react';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {PlanCanvas} from '../plan2d/PlanCanvas';
import {IconCopy, IconCube, IconFit, IconLayers, IconMinus, IconPlus, IconRotate, IconTrash} from '../../lib/icons';
import {LazyMenu} from './LazyMenu';
import {usePlanStore} from '../../store/planStore';
import {LibraryPanel} from './LibraryPanel';
import {planView, TOOL_HINTS, useDesignUi, type DesignTool, type DesignView, type PanelTab} from './designUi';
import {PropertiesTab} from './PropertiesTab';
import {RoomsTab} from './RoomsTab';

// three.js 体积较大，单独拆包，首屏不加载
const Viewer3D = lazy(() => import('../view3d/Viewer3D'));
const AssistantTab = lazy(() => import('./AssistantTab'));
const SunPanel = lazy(() => import('../sun/SunPanel'));
const CheckPanel = lazy(() => import('../check/CheckPanel'));

export function DesignPage() {
  const view = useDesignUi((s) => s.view);
  const setView = useDesignUi((s) => s.setView);
  const tool = useDesignUi((s) => s.tool);
  const setTool = useDesignUi((s) => s.setTool);
  const [showPip, setShowPip] = useState(true);
  const tab = useDesignUi((s) => s.panel);
  const setTab = useDesignUi((s) => s.setPanel);

  return (
    <main className="np-design">
      <aside className="np-panel np-panel--left" aria-label="家具库">
        <LibraryPanel />
      </aside>

      <section className="np-stage" aria-label="画布">
        <div className="np-stage-toolbar">
          <SegmentedControl label="视图" value={view} onChange={(v) => setView(v as DesignView)} size="sm">
            <SegmentedControlItem value="2d" label="平面" />
            <SegmentedControlItem value="3d" label="3D" />
            <SegmentedControlItem value="walk" label="漫游" />
          </SegmentedControl>
          {view === '2d' && (
            <>
              <SegmentedControl label="工具" value={tool} onChange={(v) => setTool(v as DesignTool)} size="sm">
                <SegmentedControlItem value="select" label="选择" />
                <SegmentedControlItem value="measure" label="测量" />
                <SegmentedControlItem value="demolish" label="拆墙" />
                <SegmentedControlItem value="build" label="砌墙" />
              </SegmentedControl>
              <span className="np-toolbar-group">
                <IconButton label="缩小" tooltip="缩小" icon={<IconMinus />} variant="ghost" size="sm" onClick={() => planView.zoom(1 / 1.25)} />
                <IconButton label="放大" tooltip="放大" icon={<IconPlus />} variant="ghost" size="sm" onClick={() => planView.zoom(1.25)} />
                <Button label="1:60" variant="ghost" size="sm" tooltip="按 1:60 显示" onClick={() => planView.scale(60)} />
                <Button label="1:100" variant="ghost" size="sm" tooltip="按 1:100 显示" onClick={() => planView.scale(100)} />
                <IconButton label="适应窗口" tooltip="适应窗口（F）" icon={<IconFit />} variant="ghost" size="sm" onClick={() => planView.fit()} />
              </span>
              <LazyMenu kind="layers" label="图层" icon={<IconLayers />} />
              <IconButton
                label={showPip ? '隐藏 3D 小窗' : '显示 3D 小窗'}
                tooltip={showPip ? '隐藏 3D 小窗' : '显示 3D 小窗'}
                icon={<IconCube />}
                variant={showPip ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowPip((s) => !s)}
              />
            </>
          )}
          {view !== '2d' && <SceneTools view={view} />}
        </div>
        {view === '2d' && (
          <p className="np-stage-hint" aria-live="polite">
            {TOOL_HINTS[tool]}
          </p>
        )}

        {view === '2d' ? (
          <>
            <div className="np-stage-full">
              <PlanCanvas />
            </div>
            <SelectionBar />
            {showPip && (
              <div className="np-pip">
                <span className="np-pip-label">3D 预览 · 拖动旋转</span>
                <Suspense fallback={<div className="np-loading">正在加载 3D…</div>}>
                  <Viewer3D pip />
                </Suspense>
              </div>
            )}
          </>
        ) : (
          <div className="np-stage-full">
            <Suspense fallback={<div className="np-loading">正在加载 3D…</div>}>
              <Viewer3D mode={view === 'walk' ? 'walk' : 'orbit'} />
            </Suspense>
          </div>
        )}
      </section>

      <aside className="np-panel np-panel--right" aria-label="面板">
        <div className="np-panel-section" style={{paddingBottom: 0}}>
          <TabList value={tab} onChange={(v) => setTab(v as PanelTab)} layout="fill" hasDivider>
            <Tab value="props" label="属性" />
            <Tab value="rooms" label="房间" />
            <Tab value="sun" label="日照" />
            <Tab value="check" label="体检" />
            <Tab value="ai" label="AI" />
          </TabList>
        </div>
        <div className="np-tab-body">
          {tab === 'props' && <PropertiesTab />}
          {tab === 'rooms' && <RoomsTab />}
          {tab === 'sun' && (
            <Suspense fallback={<div className="np-loading">加载中…</div>}>
              <SunPanel />
            </Suspense>
          )}
          {tab === 'check' && (
            <Suspense fallback={<div className="np-loading">加载中…</div>}>
              <CheckPanel />
            </Suspense>
          )}
          {tab === 'ai' && (
            <Suspense fallback={<div className="np-loading">加载中…</div>}>
              <AssistantTab />
            </Suspense>
          )}
        </div>
      </aside>
    </main>
  );
}

/** 3D 视图的工具：预设视角、剖切墙、显示开关 */
function SceneTools({view}: {view: DesignView}) {
  const cut = useDesignUi((s) => s.scene.cut);
  const ui = useDesignUi.getState();
  return (
    <>
      {view === '3d' && (
        <span className="np-toolbar-group">
          <Button label="斜视" variant="ghost" size="sm" onClick={() => ui.aim('iso')} />
          <Button label="俯视" variant="ghost" size="sm" onClick={() => ui.aim('top')} />
          <Button
            label="剖切墙"
            tooltip="墙只显示到 1.2 米，看清屋里"
            variant={cut ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={cut}
            onClick={() => ui.setScene({cut: !cut})}
          />
        </span>
      )}
      <LazyMenu kind="scene" label="显示" icon={<IconLayers />} />
    </>
  );
}

/** 触屏上没有键盘：选中家具后在画布底部给旋转、复制、删除 */
function SelectionBar() {
  const sel = usePlanStore((s) => s.selection);
  const f = usePlanStore((s) => (sel?.kind === 'furniture' ? s.plan.furniture.find((x) => x.id === sel.id) : undefined));
  if (!f) return null;
  const store = usePlanStore.getState();
  return (
    <div className="np-selbar" role="toolbar" aria-label={`${f.name}操作`}>
      <span>{f.name}</span>
      <Button label="旋转" icon={<IconRotate />} variant="ghost" size="sm" onClick={() => store.rotateFurniture(f.id, 90)} />
      <IconButton label="复制" icon={<IconCopy />} variant="ghost" size="sm" onClick={() => store.duplicateSelected()} />
      <IconButton label="删除" icon={<IconTrash />} variant="ghost" size="sm" onClick={() => store.removeSelected()} />
      <Button label="完成" variant="secondary" size="sm" onClick={() => store.select(null)} />
    </div>
  );
}
