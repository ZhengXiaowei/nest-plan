/**
 * 方案文件：导出平面图图片、导出 / 导入方案 JSON。只在菜单里用到，单独拆包。
 */
import type {Furniture, MaterialId, Measure, Plan} from '../../model/types';
import {MATERIAL_IDS} from '../../model/materials';
import {createSamplePlan} from '../../model/samplePlan';
import {normalizePlan, usePlanStore} from '../../store/planStore';
import {planBounds, roomArea} from '../../model/geometry';
import {uid} from '../../lib/id';
import {planView} from './designUi';

export {toggleFullscreen} from '../../lib/fullscreen';

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---------- 图片 ---------- */

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-variant-numeric', 'paint-order', 'vector-effect', 'text-anchor', 'dominant-baseline',
];

/** 把平面图画布连同 CSS 样式拷成一张独立的 SVG，再画到 canvas 上导出 PNG */
export async function exportPlanImage() {
  const svg = planView.svg();
  if (!svg) throw new Error('先切到平面图再导出图片');
  const plan = usePlanStore.getState().plan;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const out = dst[i] as SVGElement;
    out.removeAttribute('class');
    out.setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  // 去掉选中框、网格和正在画的辅助线
  clone.querySelectorAll('[data-handle], rect[fill^="url(#fp-grid"]').forEach((n) => n.remove());

  // 只框住户型和外圈尺寸
  const b = planBounds(plan);
  const pad = 1800;
  const vb = {x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2};
  const W = 2400;
  const H = Math.round((W * vb.h) / vb.w);
  // 线宽是按屏幕像素写的（non-scaling-stroke），按导出尺寸和屏幕尺寸的比例放大
  const k = W / Math.max(1, svg.getBoundingClientRect().width) / (vb.w / Math.max(1, svg.viewBox.baseVal.width));
  clone.querySelectorAll<SVGElement>('*').forEach((el) => {
    const sw = parseFloat(el.style.strokeWidth);
    if (el.style.getPropertyValue('vector-effect') === 'non-scaling-stroke' && sw) el.style.strokeWidth = `${Math.max(1, sw * k)}px`;
  });
  clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const FOOT = 120;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml'}));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H + FOOT;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, W, H);
    const area = plan.rooms.filter((r) => r.counted !== false).reduce((s, r) => s + roomArea(r), 0);
    ctx.fillStyle = '#111827';
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.fillText(plan.name, 64, H + 64);
    ctx.fillStyle = '#576071';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(`套内 ${area.toFixed(1)} ㎡ · ${plan.rooms.filter((r) => r.counted !== false).length} 个房间 · 尺寸单位 mm`, 64, H + 104);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#2747D6';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText('栖图', W - 64, H + 80);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('浏览器没能生成图片');
    download(`${plan.name}-平面图.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- 方案 JSON ---------- */

export async function exportPlanFile() {
  const plan = usePlanStore.getState().plan;
  const body = JSON.stringify({app: 'nestplan', version: 1, exportedAt: new Date().toISOString(), plan}, null, 2);
  download(`${plan.name}-栖图方案.json`, new Blob([body], {type: 'application/json'}));
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** 检查是不是一份能用的栖图方案 */
export function parsePlan(data: unknown): Plan {
  const d = data as {app?: string; plan?: unknown};
  const p = (d?.app === 'nestplan' ? d.plan : data) as Partial<Plan>;
  if (p && Array.isArray(p.walls) && Array.isArray(p.rooms) && Array.isArray(p.furniture)) {
    const ok =
      p.walls.every((w) => isVec(w.a) && isVec(w.b) && isNum(w.thickness)) &&
      p.rooms.every((r) => Array.isArray(r.poly) && r.poly.every(isVec) && MATERIAL_IDS.includes(r.material)) &&
      p.furniture.every((f) => isNum(f.cx) && isNum(f.cy) && isNum(f.w) && isNum(f.d));
    if (!ok) throw new Error('文件里的墙、房间或家具数据不完整');
    return normalizePlan({version: 1, id: p.id ?? uid('p'), name: p.name ?? '导入的方案', wallHeight: p.wallHeight ?? 2800, openings: p.openings ?? [], source: p.source ?? {kind: 'blank'}, ...p} as Plan);
  }
  return fromLegacy(data);
}

/** 原版 floorplan-3d 导出的布置：户型就是示例户型，带家具、房间名和材质、拆掉的墙、测量线 */
function fromLegacy(data: unknown): Plan {
  const s = data as {
    furniture?: unknown[];
    rooms?: Record<string, {name?: string; mat?: string}>;
    demolished?: unknown[];
    measures?: {a: {x: number; y: number}; b: {x: number; y: number}}[];
  };
  if (!s || !Array.isArray(s.furniture)) throw new Error('不是栖图或 floorplan-3d 的方案文件');
  const base = createSamplePlan();
  const furniture: Furniture[] = s.furniture.flatMap((x) => {
    const f = x as Partial<Furniture>;
    if (!isNum(f.cx) || !isNum(f.cy) || !isNum(f.w) || !isNum(f.d)) return [];
    return [{id: uid('f'), type: String(f.type ?? 'cabinet'), name: String(f.name ?? '家具'), cx: f.cx, cy: f.cy, w: f.w, d: f.d, rot: isNum(f.rot) ? f.rot : 0, color: typeof f.color === 'string' ? f.color : '#E8DCCB'}];
  });
  const rooms = base.rooms.map((r) => {
    const o = s.rooms?.[r.id];
    const mat = o?.mat as MaterialId | undefined;
    return {...r, name: o?.name || r.name, material: mat && MATERIAL_IDS.includes(mat) ? mat : r.material};
  });
  const measures: Measure[] = (s.measures ?? []).filter((m) => isNum(m?.a?.x) && isNum(m?.b?.x)).map((m) => ({id: uid('m'), a: [m.a.x, m.a.y], b: [m.b.x, m.b.y]}));
  // 原版的墙按数组下标编号（w0 起），示例户型的墙顺序一样，编号从 w1 起
  const wallIds = new Set(base.walls.map((w) => w.id));
  const demolished = (s.demolished ?? []).flatMap((id) => {
    const m = typeof id === 'string' ? /^w(\d+)$/.exec(id) : null;
    const ours = m ? `w${Number(m[1]) + 1}` : '';
    return wallIds.has(ours) && base.walls.find((w) => w.id === ours)?.kind === 'partition' ? [ours] : [];
  });
  return {...base, rooms, furniture, measures, demolished};
}

/** 让用户挑一个方案文件；取消返回 null */
export function pickPlanFile(): Promise<Plan | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(parsePlan(JSON.parse(await file.text())));
      } catch (e) {
        reject(e instanceof SyntaxError ? new Error('文件不是有效的 JSON') : e);
      }
    });
    input.click();
  });
}
