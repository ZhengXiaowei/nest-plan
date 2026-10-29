import {useTraceStore} from './traceStore';
import {dist, medianWallThickness, scaleFromDimensions, type Draft, type P} from './draft';

export type ScaleSource = 'manual' | 'dimensions';

export function manualScale(calib: P[], calibMm: string): number | null {
  const mm = Number(calibMm);
  if (calib.length !== 2 || !(mm > 0)) return null;
  const px = dist(calib[0]!, calib[1]!);
  return px > 0 ? mm / px : null;
}

/** 生成户型用的比例：手动标定优先，其次是 AI 读到的尺寸标注 */
export function useScale(): {mmPerPixel: number | null; source: ScaleSource | null} {
  const calib = useTraceStore((s) => s.calib);
  const calibMm = useTraceStore((s) => s.calibMm);
  const draft = useTraceStore((s) => s.draft);
  const manual = manualScale(calib, calibMm);
  if (manual) return {mmPerPixel: manual, source: 'manual'};
  const auto = scaleFromDimensions(draft);
  if (auto) return {mmPerPixel: auto, source: 'dimensions'};
  return {mmPerPixel: null, source: null};
}

/**
 * 放门窗时的默认宽度要用到比例；还没标定时按「墙厚约 240mm」粗估，
 * 再不行就按图片宽度约等于 12 米估。只影响默认宽度，不进最终户型。
 */
export function roughScale(draft: Draft, calib: P[], calibMm: string, imageWidth: number): number {
  return manualScale(calib, calibMm) ?? scaleFromDimensions(draft) ?? (medianWallThickness(draft) ? 240 / medianWallThickness(draft)! : 12000 / imageWidth);
}
