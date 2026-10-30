import {useMemo, useState} from 'react';
import {Stepper, Step} from '@astryxdesign/core/Stepper';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Heading} from '@astryxdesign/core/Heading';
import {IconButton} from '@astryxdesign/core/IconButton';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {IconRedo, IconUndo} from '../../lib/icons';
import {useAiSettings, isAiConfigured} from '../ai/settings';
import {recognizeFloorplan} from '../ai/recognize';
import {usePlanStore} from '../../store/planStore';
import {navigate} from '../../lib/router';
import {boxScale, boxSignature, roughBoxScale, useBoxStore, type BoxStep, type Brush} from './boxStore';
import {boxesFromRooms, boxesToDraft, isExterior, roomRect, ROOM_NAMES, wallTypes, wallsFromBoxes} from './boxes';
import {draftToPlan, scaleFromDimensions, emptyDraft} from './draft';
import {grayOf, grayReady} from './gray';
import {guessFromImage, snapEdge} from './imageScan';
import {useTraceStore} from './traceStore';
import type {LoadedImage} from './image';

const BRUSH_TIPS: Record<Brush, string> = {
  door: '点墙放一扇门，点已有的门去掉。',
  slidingDoor: '点墙放推拉门（阳台、厨房常见），再点一下去掉。',
  window: '点外墙放一扇窗，再点一下去掉。',
  entry: '点外墙放入户门，只有一个，点别处会挪过去。',
  bearing: '点一面室内墙标成承重墙，再点一下改回非承重。',
  open: '两个房间之间其实没有墙（比如客餐厅连在一起）就点一下，再点一下改回。',
};

/** 框房间流程的侧栏：四步，每步只做一件事 */
export function BoxPanel({image, onPickFile, onUseSample}: {image: LoadedImage | null; onPickFile: () => void; onUseSample: () => void}) {
  const step = useBoxStore((s) => s.step);
  const boxes = useBoxStore((s) => s.boxes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ai' | 'guess' | null>(null);
  const aiSettings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);
  const active = !image ? 0 : step;

  /** 进第 2 步时按图猜一次（方框没变就不重猜） */
  const goStep = async (next: BoxStep) => {
    const store = useBoxStore.getState();
    if (next > 1 && !store.boxes.length) return;
    if (next >= 2 && image && store.guessedFor !== boxSignature(store.boxes)) {
      setBusy('guess');
      try {
        const {gray, wall} = await grayOf(image);
        const st = useBoxStore.getState();
        const g = guessFromImage(gray, wallsFromBoxes(st.boxes), wall ?? 240 / roughBoxScale(null, image.width));
        st.applyGuess(g, boxSignature(st.boxes));
      } finally {
        setBusy(null);
      }
    }
    useBoxStore.getState().setStep(next);
  };

  const runAi = async () => {
    if (!image) return;
    if (!isAiConfigured(aiSettings)) {
      openDialog(true);
      return;
    }
    setBusy('ai');
    setError(null);
    try {
      const r = await recognizeFloorplan(aiSettings, image);
      const {gray, wall} = await grayOf(image);
      const t = wall ?? image.width / 50;
      const found = boxesFromRooms(r.rooms, t * 0.8, (axis, at, s0, s1) => snapEdge(gray, axis, at, s0, s1, t * 1.5));
      if (!found.length) {
        setError('AI 没找到房间，换个模型试试，或者自己拖框。');
        return;
      }
      const store = useBoxStore.getState();
      // 已经框过的房间不动，AI 只补没框的
      const inside = (x: number, y: number) => store.boxes.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);
      const add = found.filter((b) => !inside((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2));
      store.commit((st) => ({boxes: [...st.boxes, ...add]}));
      const hint = scaleFromDimensions({...emptyDraft(), dimensions: r.dimensions});
      if (hint) store.setHintScale(hint);
    } catch (e) {
      setError(`AI 框房间失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <HStack justify="between" align="center">
        <Heading level={2}>户型还原</Heading>
        {image && <UndoRedo />}
      </HStack>
      <Stepper activeStep={active} orientation="vertical" density="compact" label="还原步骤" onStepClick={(i) => image && i >= 1 && i <= 3 && void goStep(i as BoxStep)}>
        <Step step={0} label="上传户型图" description="截图、照片都可以" />
        <Step step={1} label="框房间" description={boxes.length ? `已框 ${boxes.length} 个房间` : '每个房间拖一个方框'} />
        <Step step={2} label="门窗和承重墙" description="猜好了，点墙改" />
        <Step step={3} label="定尺寸" description="填套内面积" />
      </Stepper>

      {error && <Banner status="error" title={error} isDismissable onDismiss={() => setError(null)} />}

      {!image && (
        <VStack gap={2}>
          <p className="bx-tip">上传户型图后，给每个房间拖一个方框，墙、门窗会自动生成，几分钟就能开始设计。</p>
          <Button label="上传户型图" variant="primary" onClick={onPickFile} />
        </VStack>
      )}
      {image && step === 1 && <StepRooms busy={busy} onAi={runAi} aiReady={isAiConfigured(aiSettings)} onNext={() => void goStep(2)} />}
      {image && step === 2 && <StepWalls image={image} onBack={() => void goStep(1)} onNext={() => void goStep(3)} />}
      {image && step === 3 && <StepSize image={image} onBack={() => void goStep(2)} />}

      <div style={{marginTop: 'auto'}}>
        <VStack gap={2}>
          {image && (
            <p className="np-hint">
              有斜墙、异形房间？
              <button type="button" className="bx-link" onClick={() => toTrace(image)}>
                转到精修
              </button>
              一笔笔描墙。
            </p>
          )}
          <p className="np-hint">手上还没有户型图？先用示例户型（三室两厅）体验一下。</p>
          <HStack gap={2}>
            <Button label="用示例户型" variant="secondary" onClick={onUseSample} />
            {image && <Button label="换一张图" variant="ghost" onClick={onPickFile} />}
          </HStack>
        </VStack>
      </div>
    </>
  );
}

function StepRooms({busy, onAi, aiReady, onNext}: {busy: 'ai' | 'guess' | null; onAi: () => void; aiReady: boolean; onNext: () => void}) {
  const boxes = useBoxStore((s) => s.boxes);
  const selected = useBoxStore((s) => s.selected);
  const sel = boxes.find((b) => b.id === selected);
  const store = useBoxStore.getState();
  const [custom, setCustom] = useState('');
  return (
    <VStack gap={3}>
      <p className="bx-tip">
        沿着图上的墙，<b>按住拖出</b>每个房间的方框，或者在房间里<b>双击</b>自动框。过道、阳台也框上，相邻的方框会自动贴在一起。
      </p>
      <Button label={aiReady ? 'AI 帮我框' : 'AI 帮我框（先连模型）'} variant={boxes.length ? 'secondary' : 'primary'} isLoading={busy === 'ai'} onClick={onAi} />
      {sel && (
        <VStack gap={2}>
          <h3 className="np-panel-title">这是哪个房间？</h3>
          <div className="bx-chips">
            {ROOM_NAMES.map((n) => (
              <button key={n} type="button" className="bx-chip" aria-pressed={sel.name === n} onClick={() => store.renameBox(sel.id, n)}>
                {n}
              </button>
            ))}
          </div>
          <HStack gap={2} align="end">
            <TextInput label="其他名字" value={custom} placeholder="比如 茶室" onChange={setCustom} size="sm" />
            <Button
              label="用这个"
              variant="secondary"
              size="sm"
              isDisabled={!custom.trim()}
              onClick={() => {
                store.renameBox(sel.id, custom.trim());
                setCustom('');
              }}
            />
          </HStack>
          <Button label="删掉这个方框" variant="ghost" size="sm" onClick={() => store.removeBox(sel.id)} />
        </VStack>
      )}
      <Button label={busy === 'guess' ? '正在看图…' : '下一步：门窗和承重墙'} variant="primary" isDisabled={!boxes.length} isLoading={busy === 'guess'} onClick={onNext} />
    </VStack>
  );
}

function StepWalls({image, onBack, onNext}: {image: LoadedImage; onBack: () => void; onNext: () => void}) {
  const brush = useBoxStore((s) => s.brush);
  const boxes = useBoxStore((s) => s.boxes);
  const marks = useBoxStore((s) => s.marks);
  const wallMarks = useBoxStore((s) => s.wallMarks);
  const store = useBoxStore.getState();
  const s = boxScale(useBoxStore.getState())?.mmPerPixel ?? roughBoxScale(grayReady(image)?.wall ?? null, image.width);
  const stats = useMemo(() => {
    const walls = wallsFromBoxes(boxes);
    const types = wallTypes(walls, wallMarks, Math.max(6, 300 / s));
    const inner = walls.filter((w) => !isExterior(w));
    return {
      bearing: inner.filter((w) => types.get(w.id)!.kind === 'bearing').length,
      unverified: inner.filter((w) => !types.get(w.id)!.verified).length,
      doors: marks.filter((m) => m.kind === 'door' || m.kind === 'slidingDoor').length,
      windows: marks.filter((m) => m.kind === 'window').length,
      entry: marks.some((m) => m.kind === 'entry'),
      guessed: marks.some((m) => m.guessed) || wallMarks.some((m) => m.guessed),
    };
  }, [boxes, marks, wallMarks, s]);
  return (
    <VStack gap={3}>
      <p className="bx-tip">
        墙已经按方框生成好了。{stats.guessed ? '按图猜了一遍，虚线和浅色的是猜的，' : ''}不对的地方选一种，<b>点墙</b>改。
      </p>
      <SegmentedControl label="点墙放什么" value={brush} onChange={(v) => store.setBrush(v as Brush)} size="sm" layout="fill">
        <SegmentedControlItem value="door" label="门" />
        <SegmentedControlItem value="slidingDoor" label="推拉门" />
        <SegmentedControlItem value="window" label="窗" />
        <SegmentedControlItem value="entry" label="入户门" />
        <SegmentedControlItem value="bearing" label="承重墙" />
        <SegmentedControlItem value="open" label="敞开" />
      </SegmentedControl>
      <p className="bx-tip">{BRUSH_TIPS[brush]}</p>
      <div className="bx-legend">
        <span><i style={{background: '#111827'}} />承重墙 {stats.bearing}</span>
        <span><i style={{background: '#374151'}} />外墙</span>
        <span><i style={{background: 'var(--np-accent)'}} />非承重</span>
        <span>门 {stats.doors} · 窗 {stats.windows}{stats.entry ? ' · 有入户门' : ' · 还没有入户门'}</span>
      </div>
      {stats.unverified > 0 && (
        <VStack gap={1}>
          <p className="bx-tip">
            承重墙是按图上的粗细猜的，以物业或开发商的结构图为准。拿不准的先不管，设计时拆这些墙会提醒你核实。
          </p>
          <Button label="室内墙我都核对过了" variant="ghost" size="sm" onClick={() => store.verifyAll(s)} />
        </VStack>
      )}
      <div className="bx-nav">
        <Button label="上一步" variant="secondary" onClick={onBack} />
        <Button label="下一步：定尺寸" variant="primary" onClick={onNext} />
      </div>
    </VStack>
  );
}

function StepSize({image, onBack}: {image: LoadedImage; onBack: () => void}) {
  const area = useBoxStore((s) => s.area);
  const measure = useBoxStore((s) => s.measure);
  const boxes = useBoxStore((s) => s.boxes);
  const wallMarks = useBoxStore((s) => s.wallMarks);
  const hintScale = useBoxStore((s) => s.hintScale);
  const store = useBoxStore.getState();
  const real = boxScale({boxes, wallMarks, area, measure, hintScale});
  const total = useMemo(() => {
    if (!real) return null;
    const walls = wallsFromBoxes(boxes);
    const types = wallTypes(walls, wallMarks, Math.max(6, 300 / real.mmPerPixel));
    return boxes.reduce((sum, b) => {
      const r = roomRect(b, walls, types, real.mmPerPixel);
      return sum + ((r.x1 - r.x0) * (r.y1 - r.y0) * real.mmPerPixel ** 2) / 1e6;
    }, 0);
  }, [boxes, wallMarks, real]);

  const start = () => {
    if (!real) return;
    const st = useBoxStore.getState();
    const draft = boxesToDraft(st, real.mmPerPixel);
    usePlanStore.getState().loadPlan(draftToPlan(draft, real.mmPerPixel, image.name.replace(/\.\w+$/, '') || '我的户型'));
    navigate('design');
  };

  return (
    <VStack gap={3}>
      <TextInput
        label="套内面积（㎡）"
        description="购房合同上的「套内建筑面积」，不是含公摊的建筑面积"
        value={area}
        onChange={(v) => store.setArea(v.replace(/[^\d.]/g, ''))}
        placeholder="例如 89.5"
      />
      <p className="bx-tip">
        也可以<b>点图上一面墙</b>，填它的实际长度。
      </p>
      {measure && (
        <HStack gap={2} align="end">
          <TextInput label="这面墙长（mm）" value={measure.mm} onChange={(v) => store.setMeasure({...measure, mm: v.replace(/[^\d]/g, '')})} placeholder="例如 3600" size="sm" />
          <Button label="不量了" variant="ghost" size="sm" onClick={() => store.setMeasure(null)} />
        </HStack>
      )}
      {real ? (
        <p className="bx-tip">
          {real.source === 'measure' ? '按你量的墙' : real.source === 'area' ? '按套内面积' : '按图上读到的尺寸标注'}定好了比例，
          房间加起来 <b>{total?.toFixed(1)} ㎡</b>。看看图上每个房间的长宽对不对。
        </p>
      ) : (
        <p className="bx-tip">填好后，图上每个房间会显示长宽，一眼能看出对不对。</p>
      )}
      <div className="bx-nav">
        <Button label="上一步" variant="secondary" onClick={onBack} />
        <Button label="开始设计" variant="primary" isDisabled={!real} onClick={start} />
      </div>
    </VStack>
  );
}

function UndoRedo() {
  const canUndo = useBoxStore((s) => s.past.length > 0);
  const canRedo = useBoxStore((s) => s.future.length > 0);
  return (
    <HStack gap={1}>
      <IconButton label="撤销" tooltip="撤销 ⌘Z" icon={<IconUndo />} variant="ghost" size="sm" isDisabled={!canUndo} onClick={() => useBoxStore.getState().undo()} />
      <IconButton label="重做" tooltip="重做 ⇧⌘Z" icon={<IconRedo />} variant="ghost" size="sm" isDisabled={!canRedo} onClick={() => useBoxStore.getState().redo()} />
    </HStack>
  );
}

/** 框房间的结果转成描墙草稿，切到精修 */
function toTrace(image: LoadedImage) {
  const st = useBoxStore.getState();
  const real = boxScale(st);
  const s = real?.mmPerPixel ?? roughBoxScale(grayReady(image)?.wall ?? null, image.width);
  const draft = st.boxes.length ? boxesToDraft(st, s) : emptyDraft();
  // 定好的比例以「尺寸标注」的形式带过去，精修里不用再标定
  if (real) draft.dimensions = [{a: [0, 0], b: [1000, 0], mm: 1000 * real.mmPerPixel}];
  useTraceStore.setState({draft, past: [], future: [], selection: null, tool: 'select'});
  st.setMode('trace');
}
