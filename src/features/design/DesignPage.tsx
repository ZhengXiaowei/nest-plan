import {lazy, Suspense, useCallback, useRef, useState} from 'react';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {IconButton} from '@astryxdesign/core/IconButton';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {PlanCanvas} from '../plan2d/PlanCanvas';
import {IconCube, IconFit} from '../../lib/icons';
import {LibraryPanel} from './LibraryPanel';
import {TOOL_HINTS, useDesignUi, type DesignTool, type DesignView} from './designUi';
import {PropertiesTab} from './PropertiesTab';
import {RoomsTab} from './RoomsTab';

// three.js 体积较大，单独拆包，首屏不加载
const Viewer3D = lazy(() => import('../view3d/Viewer3D'));
const AssistantTab = lazy(() => import('./AssistantTab'));

type PanelTab = 'props' | 'rooms' | 'ai';

export function DesignPage() {
  const view = useDesignUi((s) => s.view);
  const setView = useDesignUi((s) => s.setView);
  const tool = useDesignUi((s) => s.tool);
  const setTool = useDesignUi((s) => s.setTool);
  const [showPip, setShowPip] = useState(true);
  const [tab, setTab] = useState<PanelTab>('props');
  const fitRef = useRef<() => void>(() => {});
  const onReady = useCallback((api: {fit: () => void}) => (fitRef.current = api.fit), []);

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
              <IconButton label="适应窗口" tooltip="适应窗口" icon={<IconFit />} variant="ghost" size="sm" onClick={() => fitRef.current()} />
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
        </div>
        {view === '2d' && (
          <p className="np-stage-hint" aria-live="polite">
            {TOOL_HINTS[tool]}
          </p>
        )}

        {view === '2d' ? (
          <>
            <div className="np-stage-full">
              <PlanCanvas onReady={onReady} />
            </div>
            {showPip && (
              <div className="np-pip">
                <span className="np-pip-label">3D 预览 · 拖动旋转</span>
                <Suspense fallback={<div className="np-loading">正在加载 3D…</div>}>
                  <Viewer3D />
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
            <Tab value="ai" label="AI 助手" />
          </TabList>
        </div>
        <div className="np-tab-body">
          {tab === 'props' && <PropertiesTab />}
          {tab === 'rooms' && <RoomsTab />}
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
