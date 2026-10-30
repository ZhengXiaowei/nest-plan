import {useEffect, useRef, useState, type DragEvent} from 'react';
import {Stepper, Step} from '@astryxdesign/core/Stepper';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Heading} from '@astryxdesign/core/Heading';
import {IconButton} from '@astryxdesign/core/IconButton';
import {IconRedo, IconUndo} from '../../lib/icons';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {loadImageFile} from './image';
import {useAiSettings, isAiConfigured} from '../ai/settings';
import {recognizeFloorplan} from '../ai/recognize';
import {usePlanStore} from '../../store/planStore';
import {createSamplePlan} from '../../model/samplePlan';
import {navigate} from '../../lib/router';
import {useTraceStore, type TraceTool} from './traceStore';
import {TraceCanvas} from './TraceCanvas';
import {BoxCanvas} from './BoxCanvas';
import {BoxPanel} from './BoxPanel';
import {useBoxStore} from './boxStore';
import {useScale} from './scale';
import {draftToPlan, needsReview} from './draft';
import type {WallKind} from '../../model/types';

const TOOL_TIPS: Record<TraceTool, string> = {
  select: '点墙、门窗或房间选中；拖白色圆点改墙角。拖空白处平移，滚轮缩放。',
  wall: '沿墙中线点击连续画墙，靠近端点、墙体、水平垂直会自动吸附。双击、右键或 Esc 结束，按住 Shift 不吸附。',
  door: '把鼠标移到墙上，点一下放门（默认 900mm 宽）。',
  window: '把鼠标移到墙上，点一下放窗（默认 1500mm 宽）。',
  slidingDoor: '把鼠标移到墙上，点一下放推拉门（默认 2400mm 宽）。',
  room: '沿房间内侧依次点角点，点回起点或按 Enter 完成。',
  calibrate: '点两下选一段知道长度的墙，再在右边填实际长度。',
};

const KIND_LABEL = {wall: '墙', opening: '门窗', room: '房间'} as const;
const OPENING_LABEL = {door: '门', window: '窗', slidingDoor: '推拉门'} as const;

/**
 * 户型还原：上传 → AI 识别（可选）→ 校对和描墙 → 标定尺寸 → 开始设计。
 * 没连 AI 也能用：直接在图上描墙、放门窗、圈房间。
 */
export default function TracePage() {
  const image = useTraceStore((s) => s.image);
  const draft = useTraceStore((s) => s.draft);
  const tool = useTraceStore((s) => s.tool);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const aiSettings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);
  const {mmPerPixel} = useScale();
  const mode = useBoxStore((s) => s.mode);
  const uncropped = useBoxStore((s) => s.uncropped);
  const noBoxes = useBoxStore((s) => s.boxes.length === 0);
  const [miss, setMiss] = useState(false);
  useEffect(() => {
    let timer = 0;
    const on = () => {
      setMiss(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMiss(false), 2200);
    };
    window.addEventListener('np-box-miss', on);
    return () => {
      window.removeEventListener('np-box-miss', on);
      window.clearTimeout(timer);
    };
  }, []);

  const hasDraft = draft.walls.length > 0;
  const reviewCount = [...draft.walls, ...draft.openings, ...draft.rooms].filter(needsReview).length;
  const activeStep = !image ? 0 : !hasDraft ? 1 : reviewCount > 0 ? 2 : !mmPerPixel ? 3 : 4;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('这一版先支持图片（PNG / JPG / WebP）。CAD（DXF）和 PDF 会在后面的版本加上。');
      return;
    }
    try {
      const {image: img, original} = await loadImageFile(file);
      useTraceStore.getState().setImage(img);
      useBoxStore.getState().reset();
      useBoxStore.getState().setUncropped(original);
      useBoxStore.getState().setMode('boxes');
    } catch {
      setError('这张图片读不出来，换一张试试。');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void onFile(e.dataTransfer.files[0]);
  };

  const runRecognize = async () => {
    if (!image) return;
    if (!isAiConfigured(aiSettings)) {
      openDialog(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      useTraceStore.getState().setRecognized(await recognizeFloorplan(aiSettings, image));
    } catch (e) {
      setError(`识别失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (!hasDraft || !mmPerPixel) return;
    usePlanStore.getState().loadPlan(draftToPlan(draft, mmPerPixel, image?.name.replace(/\.\w+$/, '') || '我的户型'));
    navigate('design');
  };

  const useSample = () => {
    usePlanStore.getState().loadPlan(createSamplePlan());
    navigate('design');
  };

  return (
    <main className="np-trace">
      <section
        className="np-trace-stage"
        style={image ? {padding: 0, display: 'block'} : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        {!image ? (
          <button type="button" className={over ? 'np-drop is-over' : 'np-drop'} onClick={() => inputRef.current?.click()}>
            <div>
              <strong>把户型图拖到这里，或点击上传</strong>
              支持截图和照片（PNG / JPG / WebP）。CAD 文件稍后支持。
            </div>
          </button>
        ) : mode === 'boxes' ? (
          <>
            <BoxCanvas key={image.dataUrl.length + image.name} image={image} />
            {miss && <div className="bx-toast">这里框不出房间，试试拖一个方框</div>}
            {uncropped && noBoxes && (
              <div className="bx-notice">
                已帮你裁出截图里的户型图
                <button
                  type="button"
                  className="bx-link"
                  onClick={() => {
                    useTraceStore.getState().setImage(uncropped);
                    useBoxStore.getState().setUncropped(null);
                  }}
                >
                  用整张图
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="tr-toolbar">
              <div className="tr-toolbox">
                <SegmentedControl label="工具" value={tool} onChange={(v) => useTraceStore.getState().setTool(v as TraceTool)} size="sm">
                  <SegmentedControlItem value="select" label="选择" />
                  <SegmentedControlItem value="wall" label="画墙" />
                  <SegmentedControlItem value="door" label="门" />
                  <SegmentedControlItem value="window" label="窗" />
                  <SegmentedControlItem value="slidingDoor" label="推拉门" />
                  <SegmentedControlItem value="room" label="房间" />
                  <SegmentedControlItem value="calibrate" label="标定" />
                </SegmentedControl>
              </div>
              <UndoRedo />
              <div className="tr-tip">{TOOL_TIPS[tool]}</div>
            </div>
            <TraceCanvas key={image.dataUrl.length + image.name} image={image} />
          </>
        )}
      </section>

      <aside className="np-trace-side">
        {mode === 'boxes' ? (
          <BoxPanel image={image} onPickFile={() => inputRef.current?.click()} onUseSample={useSample} />
        ) : (
        <>
        <HStack justify="between" align="center">
          <Heading level={2}>户型还原 · 精修</Heading>
          <Button label="回到框房间" variant="ghost" size="sm" onClick={() => useBoxStore.getState().setMode('boxes')} />
        </HStack>
        <Stepper activeStep={activeStep} orientation="vertical" density="compact" label="还原步骤">
          <Step step={0} label="上传户型图" description="截图、照片都可以" />
          <Step step={1} label="识别或描墙" description="用你连接的模型识别，或者直接在图上描" />
          <Step step={2} label="校对" description={reviewCount ? `还有 ${reviewCount} 项需要确认` : '低把握的识别结果会标成橙色'} />
          <Step step={3} label="标定尺寸" description="点两下选一段已知长度" />
          <Step step={4} label="开始设计" />
        </Stepper>

        {error && <Banner status="error" title={error} isDismissable onDismiss={() => setError(null)} />}

        {image && (
          <HStack gap={2}>
            <Button label={hasDraft ? '重新识别' : 'AI 识别'} variant={hasDraft ? 'secondary' : 'primary'} isLoading={busy} onClick={runRecognize} />
            <Button label="换一张图" variant="ghost" onClick={() => inputRef.current?.click()} />
          </HStack>
        )}

        {image && <Counts />}
        {image && <SelectionPanel />}
        {image && reviewCount > 0 && <ReviewList />}
        {image && <Calibration />}

        {image && (
          <VStack gap={2}>
            <Button label="开始设计" variant="primary" isDisabled={!hasDraft || !mmPerPixel} onClick={start} />
            {!mmPerPixel && hasDraft && <p className="np-hint">先标定尺寸，才能换算成真实的毫米。</p>}
          </VStack>
        )}

        <div style={{marginTop: 'auto'}}>
          <p className="np-hint">手上还没有户型图？先用示例户型（三室两厅）体验一下。</p>
          <Button label="用示例户型" variant="secondary" onClick={useSample} />
        </div>
        </>
        )}
      </aside>
    </main>
  );
}

function UndoRedo() {
  const canUndo = useTraceStore((s) => s.past.length > 0);
  const canRedo = useTraceStore((s) => s.future.length > 0);
  return (
    <div className="tr-toolbox">
      <IconButton label="撤销" tooltip="撤销 ⌘Z" icon={<IconUndo />} variant="ghost" size="sm" isDisabled={!canUndo} onClick={() => useTraceStore.getState().undo()} />
      <IconButton label="重做" tooltip="重做 ⇧⌘Z" icon={<IconRedo />} variant="ghost" size="sm" isDisabled={!canRedo} onClick={() => useTraceStore.getState().redo()} />
    </div>
  );
}

function Counts() {
  const draft = useTraceStore((s) => s.draft);
  return (
    <div className="tr-counts">
      <div className="tr-count">
        <b>{draft.walls.length}</b>
        <span>段墙</span>
      </div>
      <div className="tr-count">
        <b>{draft.openings.length}</b>
        <span>个门窗</span>
      </div>
      <div className="tr-count">
        <b>{draft.rooms.length}</b>
        <span>个房间</span>
      </div>
    </div>
  );
}

function SelectionPanel() {
  const selection = useTraceStore((s) => s.selection);
  const draft = useTraceStore((s) => s.draft);
  const wallKind = useTraceStore((s) => s.wallKind);
  const tool = useTraceStore((s) => s.tool);
  const store = useTraceStore.getState();

  if (tool === 'wall' || selection?.kind === 'wall') {
    return (
      <VStack gap={2}>
        <h3 className="np-panel-title">{selection?.kind === 'wall' ? '选中的墙' : '新画的墙'}</h3>
        <SegmentedControl label="墙体类型" value={wallKind} onChange={(v) => store.setWallKind(v as WallKind)} size="sm" layout="fill">
          <SegmentedControlItem value="bearing" label="承重" />
          <SegmentedControlItem value="exterior" label="外墙" />
          <SegmentedControlItem value="partition" label="非承重" />
          <SegmentedControlItem value="low" label="矮墙" />
        </SegmentedControl>
        {selection?.kind === 'wall' && <Button label="删除这段墙" variant="ghost" size="sm" onClick={() => store.removeSelected()} />}
      </VStack>
    );
  }
  if (selection?.kind === 'room') {
    const room = draft.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    return (
      <VStack gap={2}>
        <h3 className="np-panel-title">选中的房间</h3>
        <TextInput
          label="房间名"
          value={room.name}
          onChange={(v) => store.patch((d) => ({...d, rooms: d.rooms.map((r) => (r.id === room.id ? {...r, name: v} : r))}))}
        />
        <Button label="删除这个房间" variant="ghost" size="sm" onClick={() => store.removeSelected()} />
      </VStack>
    );
  }
  if (selection?.kind === 'opening') {
    const o = draft.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    return (
      <VStack gap={2}>
        <h3 className="np-panel-title">选中的{OPENING_LABEL[o.kind]}</h3>
        {!o.wallId && <p className="np-hint">这个门窗没贴到墙上，生成户型时会单独保留。</p>}
        <Button label="删除" variant="ghost" size="sm" onClick={() => store.removeSelected()} />
      </VStack>
    );
  }
  return null;
}

function ReviewList() {
  const draft = useTraceStore((s) => s.draft);
  const store = useTraceStore.getState();
  const items = [
    ...draft.walls.filter(needsReview).map((x) => ({kind: 'wall' as const, id: x.id, name: '墙', c: x.confidence})),
    ...draft.openings.filter(needsReview).map((x) => ({kind: 'opening' as const, id: x.id, name: OPENING_LABEL[x.kind], c: x.confidence})),
    ...draft.rooms.filter(needsReview).map((x) => ({kind: 'room' as const, id: x.id, name: x.name, c: x.confidence})),
  ];
  return (
    <VStack gap={1}>
      <HStack justify="between" align="center">
        <h3 className="np-panel-title" style={{margin: 0}}>需要确认（{items.length}）</h3>
        <Button label="全部保留" variant="ghost" size="sm" onClick={() => store.confirmAll()} />
      </HStack>
      <div>
        {items.slice(0, 12).map((it) => (
          <div key={it.id} className="tr-review-row">
            <button type="button" className="tr-review-name" onClick={() => {
              store.setTool('select');
              store.select({kind: it.kind, id: it.id});
            }}>
              {KIND_LABEL[it.kind]} · {it.name}
            </button>
            <span className="tr-review-conf">{Math.round((it.c ?? 0) * 100)}%</span>
            <Button label="保留" variant="secondary" size="sm" onClick={() => store.confirm(it.kind, it.id)} />
            <Button label="删除" variant="ghost" size="sm" onClick={() => {
              store.select({kind: it.kind, id: it.id});
              store.removeSelected();
            }} />
          </div>
        ))}
      </div>
      {items.length > 12 && <p className="np-hint">还有 {items.length - 12} 项，可以在图上点选。</p>}
    </VStack>
  );
}

function Calibration() {
  const calib = useTraceStore((s) => s.calib);
  const calibMm = useTraceStore((s) => s.calibMm);
  const {mmPerPixel, source} = useScale();
  const store = useTraceStore.getState();
  return (
    <VStack gap={2}>
      <h3 className="np-panel-title">标定尺寸</h3>
      <TextInput
        label="这段的实际长度（mm）"
        description={calib.length === 2 ? '已在图上选好两点' : '用「标定」工具在图上点两下'}
        value={calibMm}
        onChange={(v) => store.setCalibMm(v.replace(/[^\d.]/g, ''))}
        placeholder="例如 3600"
      />
      {calib.length < 2 && (
        <Button label="去图上选两点" variant="secondary" size="sm" onClick={() => store.setTool('calibrate')} />
      )}
      {mmPerPixel && (
        <p className="np-hint">
          {source === 'manual' ? '按你标定的长度' : '按 AI 读到的尺寸标注'}：1 像素 ≈ {mmPerPixel.toFixed(1)} mm
        </p>
      )}
    </VStack>
  );
}
