import type {LoadedImage} from './image';
import {toGray, wallThickness, type Gray} from './imageScan';

/** 户型图的灰度图和典型墙厚，按图片缓存一份（只在框房间时用到） */
let cache: {key: string; gray: Gray; wall: number | null} | null = null;

export async function grayOf(image: LoadedImage): Promise<{gray: Gray; wall: number | null}> {
  const key = image.dataUrl;
  if (cache?.key === key) return cache;
  const img = new Image();
  img.src = image.dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
  ctx.drawImage(img, 0, 0, image.width, image.height);
  const gray = toGray(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height);
  cache = {key, gray, wall: wallThickness(gray)};
  return cache;
}

/** 已经算好的（同步取，没有就 null） */
export const grayReady = (image: LoadedImage | null) => (image && cache?.key === image.dataUrl ? cache : null);
