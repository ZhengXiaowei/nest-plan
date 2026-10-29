import {useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {Stepper, Step} from '@astryxdesign/core/Stepper';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Heading} from '@astryxdesign/core/Heading';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {loadImageFile, type LoadedImage} from './image';
import {useAiSettings, isAiConfigured} from '../ai/settings';
import {estimateMmPerPixel, recognizeFloorplan, recognizedToPlan, type RecognizedPlan} from '../ai/recognize';
import {usePlanStore} from '../../store/planStore';
import {createSamplePlan} from '../../model/samplePlan';
import {navigate} from '../../lib/router';

type Pt = [number, number];

/**
 * 户型还原：上传 → AI 识别 → 校对 → 标定尺寸 → 开始设计。
 * 这一版先把上传、识别、标定串起来；逐项校对和手动描墙在下一步补上。
 */
export default function TracePage() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<RecognizedPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [calib, setCalib] = useState<Pt[]>([]);
  const [calibMm, setCalibMm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const aiSettings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);

  const manualRatio = (() => {
    const mm = Number(calibMm);
    if (calib.length !== 2 || !(mm > 0)) return null;
    const px = Math.hypot(calib[1]![0] - calib[0]![0], calib[1]![1] - calib[0]![1]);
    return px > 0 ? mm / px : null;
  })();
  const autoRatio = recognized ? estimateMmPerPixel(recognized) : null;
  const mmPerPixel = manualRatio ?? autoRatio;

  const activeStep = !image ? 0 : !recognized ? 1 : !mmPerPixel ? 3 : 4;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('这一版先支持图片（PNG / JPG / WebP）。CAD（DXF）和 PDF 会在后面的版本加上。');
      return;
    }
    try {
      setImage(await loadImageFile(file));
      setRecognized(null);
      setCalib([]);
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
      setRecognized(await recognizeFloorplan(aiSettings, {dataUrl: image.dataUrl}));
    } catch (e) {
      setError(`识别失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onImageClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    setCalib((c) => (c.length >= 2 ? [[p.x, p.y]] : [...c, [p.x, p.y]]));
  };

  const start = () => {
    if (!recognized || !mmPerPixel) return;
    usePlanStore.getState().loadPlan(recognizedToPlan(recognized, mmPerPixel, image?.name.replace(/\.\w+$/, '') || '我的户型'));
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
        ) : (
          <div style={{position: 'relative', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${image.width} / ${image.height}`}}>
            <img src={image.dataUrl} alt="上传的户型图" className="np-trace-image" style={{width: '100%', height: '100%'}} />
            <svg
              viewBox={`0 0 ${image.width} ${image.height}`}
              style={{position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair'}}
              onPointerDown={onImageClick}
              aria-label="点两下标定一段已知长度"
            >
              {recognized?.walls.map((w, i) => (
                <line key={i} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="#2747D6" strokeOpacity={0.7} strokeWidth={Math.max(2, w.thickness)} strokeLinecap="square" />
              ))}
              {recognized?.openings.map((o, i) => (
                <line key={`o${i}`} x1={o.a[0]} y1={o.a[1]} x2={o.b[0]} y2={o.b[1]} stroke="#C2410C" strokeWidth={4} />
              ))}
              {calib.length > 0 && (
                <g stroke="#C2410C" fill="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke">
                  {calib.length === 2 && <line x1={calib[0]![0]} y1={calib[0]![1]} x2={calib[1]![0]} y2={calib[1]![1]} strokeDasharray="8 6" />}
                  {calib.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={Math.max(6, image.width / 200)} />
                  ))}
                </g>
              )}
            </svg>
          </div>
        )}
      </section>

      <aside className="np-trace-side">
        <Heading level={2}>户型还原</Heading>
        <Stepper activeStep={activeStep} orientation="vertical" density="compact" label="还原步骤">
          <Step step={0} label="上传户型图" description="截图、照片都可以" />
          <Step step={1} label="AI 识别" description="用你自己连接的模型识别墙体、门窗、房间" />
          <Step step={2} label="校对墙体与门窗" description="下一版支持逐项确认和手动描墙" />
          <Step step={3} label="标定尺寸" description="在图上点两下，输入这段的实际长度" />
          <Step step={4} label="开始设计" />
        </Stepper>

        {error && <Banner status="error" title={error} isDismissable onDismiss={() => setError(null)} />}

        <VStack gap={3}>
          {image && (
            <HStack gap={2}>
              <Button label={recognized ? '重新识别' : 'AI 识别'} variant="primary" isLoading={busy} onClick={runRecognize} />
              <Button label="换一张" variant="ghost" onClick={() => inputRef.current?.click()} />
            </HStack>
          )}
          {recognized && (
            <p className="np-hint">
              识别到 {recognized.walls.length} 段墙、{recognized.openings.length} 个门窗、{recognized.rooms.length} 个房间
              {autoRatio ? `，并从图上的尺寸标注自动算出比例（1 像素 ≈ ${autoRatio.toFixed(1)} mm）` : '，没读到尺寸标注，请手动标定'}。
            </p>
          )}
          {image && (
            <TextInput
              label="标定长度（mm）"
              description={calib.length === 2 ? '已选两点，输入这段的实际长度' : '在图上点两下，选一段知道长度的墙'}
              value={calibMm}
              onChange={(v) => setCalibMm(v.replace(/[^\d.]/g, ''))}
              placeholder="例如 3600"
            />
          )}
          {image && <Button label="开始设计" variant="primary" isDisabled={!recognized || !mmPerPixel} onClick={start} />}
        </VStack>

        <div style={{marginTop: 'auto'}}>
          <p className="np-hint">手上还没有户型图？先用示例户型（三室两厅）体验一下。</p>
          <Button label="用示例户型" variant="secondary" onClick={useSample} />
        </div>
      </aside>
    </main>
  );
}
