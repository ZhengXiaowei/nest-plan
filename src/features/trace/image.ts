import {planRegion, toGray} from './imageScan';

export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_SIDE = 2048;

/** 分析截图时最多看这么大（长边），太大的图先缩一下再找户型那块 */
const SCAN_SIDE = 3200;

function canvasOf(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return canvas;
}

function toLoaded(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, name: string): LoadedImage {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const width = Math.round(sw * scale);
  const height = Math.round(sh * scale);
  return {dataUrl: canvasOf(src, sx, sy, sw, sh, width, height).toDataURL('image/png'), width, height, name};
}

/**
 * 读入用户上传的户型图，长边超过 2048px 时等比缩小。
 * 坐标、标定都基于缩小后的尺寸，送给模型的也是这张图。
 * 手机截图（App 里的户型页）会先自动裁出户型图那一块，original 是没裁的整张图，给用户反悔用。
 */
export async function loadImageFile(file: File): Promise<{image: LoadedImage; original: LoadedImage | null}> {
  const bitmap = await createImageBitmap(file);
  try {
    const full = () => toLoaded(bitmap, 0, 0, bitmap.width, bitmap.height, file.name);
    const k = Math.min(1, SCAN_SIDE / Math.max(bitmap.width, bitmap.height));
    const [sw, sh] = [Math.round(bitmap.width * k), Math.round(bitmap.height * k)];
    const data = canvasOf(bitmap, 0, 0, bitmap.width, bitmap.height, sw, sh).getContext('2d')!.getImageData(0, 0, sw, sh).data;
    const r = planRegion(toGray(data, sw, sh));
    if (!r) return {image: full(), original: null};
    const [x0, y0] = [r.x0 / k, r.y0 / k];
    return {image: toLoaded(bitmap, x0, y0, r.x1 / k - x0, r.y1 / k - y0, file.name), original: full()};
  } finally {
    bitmap.close();
  }
}
