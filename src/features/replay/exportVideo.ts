import type {Caption} from './timeline';

/**
 * 回放导出视频：逐帧离线渲染，不受设备卡顿影响。
 * 优先用 WebCodecs（mediabunny 封装 MP4，H.264 → VP9 → AV1）；
 * 浏览器不支持时退回 MediaRecorder 实时录制 WebM，这时导出要花和视频一样长的时间。
 */

export interface EncodeJob {
  canvas: HTMLCanvasElement;
  fps: number;
  frames: number;
  /** 把第 i 帧画到 canvas 上（同步） */
  draw: (i: number) => void;
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

export interface EncodedVideo {
  blob: Blob;
  ext: 'mp4' | 'webm';
}

const abortError = () => new DOMException('已取消', 'AbortError');

export async function encodeVideo(job: EncodeJob): Promise<EncodedVideo> {
  const {canvas, fps, frames, draw, onProgress, signal} = job;
  if (typeof VideoEncoder === 'function') {
    const mb = await import('mediabunny');
    const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width: canvas.width, height: canvas.height});
    if (codec) {
      const output = new mb.Output({format: new mb.Mp4OutputFormat({fastStart: 'in-memory'}), target: new mb.BufferTarget()});
      const source = new mb.CanvasSource(canvas, {codec, bitrate: mb.QUALITY_HIGH, keyFrameInterval: 2});
      output.addVideoTrack(source, {frameRate: fps});
      await output.start();
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) {
          await output.cancel();
          throw abortError();
        }
        draw(i);
        await source.add(i / fps, 1 / fps);
        onProgress((i + 1) / frames);
      }
      await output.finalize();
      return {blob: new Blob([output.target.buffer!], {type: 'video/mp4'}), ext: 'mp4'};
    }
  }
  return recordRealtime(job);
}

/** 退路：画一帧等一帧，用 MediaRecorder 录下来 */
async function recordRealtime({canvas, fps, frames, draw, onProgress, signal}: EncodeJob): Promise<EncodedVideo> {
  if (typeof MediaRecorder !== 'function' || typeof canvas.captureStream !== 'function') throw new Error('这个浏览器不支持导出视频，换最新版 Chrome、Edge 或 Safari 试试');
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, {mimeType: mime || undefined, videoBitsPerSecond: 12_000_000});
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(1000);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (signal.aborted) {
      rec.stop();
      await stopped;
      throw abortError();
    }
    draw(i);
    track?.requestFrame();
    onProgress((i + 1) / frames);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await stopped;
  const type = rec.mimeType || 'video/webm';
  return {blob: new Blob(chunks, {type}), ext: type.includes('mp4') ? 'mp4' : 'webm'};
}

/** 字幕和水印烧进视频：左上章节标题，右下栖图标识 */
export function drawOverlay(ctx: CanvasRenderingContext2D, cap: Caption, w: number, h: number) {
  const s = h / 1080;
  const font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
  if (cap.alpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = cap.alpha;
    const x = 64 * s;
    const y = 64 * s;
    ctx.font = `600 ${50 * s}px ${font}`;
    const tw = ctx.measureText(cap.title).width;
    ctx.font = `400 ${26 * s}px ${font}`;
    const sw = cap.sub ? ctx.measureText(cap.sub).width : 0;
    const pw = Math.max(tw, sw, 120 * s) + 64 * s;
    const ph = (cap.sub ? 176 : 132) * s;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.roundRect(x - 32 * s, y - 28 * s, pw, ph, 16 * s);
    ctx.fill();
    ctx.fillStyle = '#2747D6';
    ctx.font = `600 ${20 * s}px ${font}`;
    ctx.textBaseline = 'top';
    ctx.fillText(`${String(cap.index + 1).padStart(2, '0')} / ${String(cap.total).padStart(2, '0')}`, x, y);
    ctx.fillStyle = '#111827';
    ctx.font = `600 ${50 * s}px ${font}`;
    ctx.fillText(cap.title, x, y + 34 * s);
    if (cap.sub) {
      ctx.fillStyle = '#576071';
      ctx.font = `400 ${26 * s}px ${font}`;
      ctx.fillText(cap.sub, x, y + 100 * s);
    }
    ctx.restore();
  }
  // 水印
  ctx.save();
  const bx = w - 168 * s;
  const by = h - 76 * s;
  ctx.fillStyle = '#2747D6';
  ctx.beginPath();
  ctx.roundRect(bx, by, 36 * s, 36 * s, 8 * s);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.6 * s;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bx + 8 * s, by + 28 * s);
  ctx.lineTo(bx + 8 * s, by + 14 * s);
  ctx.lineTo(bx + 18 * s, by + 7 * s);
  ctx.lineTo(bx + 28 * s, by + 14 * s);
  ctx.lineTo(bx + 28 * s, by + 28 * s);
  ctx.stroke();
  ctx.fillStyle = 'rgba(17,24,39,0.82)';
  ctx.font = `600 ${26 * s}px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('栖图', bx + 48 * s, by + 18 * s);
  ctx.restore();
}
