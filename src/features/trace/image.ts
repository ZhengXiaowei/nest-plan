export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_SIDE = 2048;

/**
 * 读入用户上传的户型图，长边超过 2048px 时等比缩小。
 * 坐标、标定都基于缩小后的尺寸，送给模型的也是这张图。
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return {dataUrl: canvas.toDataURL('image/png'), width, height, name: file.name};
}
