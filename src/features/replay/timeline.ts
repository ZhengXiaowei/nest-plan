import * as THREE from 'three';
import type {Plan, Vec2} from '../../model/types';
import {planBounds, polygonArea, roomArea} from '../../model/geometry';
import {MATERIALS} from '../../model/materials';
import {renovationStats} from '../../model/walls';
import {EYE_HEIGHT, pointInPolygon} from '../view3d/walk';
import {pathLength, planRoute, pointAlong, tourRooms, type Route} from './route';

/**
 * 改造回放的时间线：同一份方案每次算出来都一样，播放和导出视频都按它逐帧取状态。
 * 章节：交房毛坯 → 拆墙 → 砌墙 → 铺地刷墙 → 家具进场 → 第一视角漫游 → 完成。
 * 时间单位秒，空间单位 m。
 */

export type ChapterId = 'raw' | 'demolish' | 'build' | 'paint' | 'furnish' | 'walk' | 'done';

export interface Chapter {
  id: ChapterId;
  /** 进度条上的短名 */
  label: string;
  title: string;
  sub: string;
  start: number;
  end: number;
}

/** 一个元素的动画区间，进度 = (t - start) / dur，夹在 0..1 */
export interface Track {
  start: number;
  dur: number;
}

export const progress = (tr: Track | undefined, t: number) => (tr ? Math.max(0, Math.min(1, (t - tr.start) / tr.dur)) : 1);

export interface CameraPose {
  pos: [number, number, number];
  quat: [number, number, number, number];
  /** 竖直视角（度）：鸟瞰 50，屋里用 68 的广角，小房间也看得全 */
  fov: number;
  /** 看向的点：飞行时在两端的看点之间插值，镜头一路都对着房子 */
  look: [number, number, number];
}

const FOV_EYE = 68;

type CamSeg =
  | {kind: 'orbit'; start: number; end: number; az0: number; az1: number; k0: number; k1: number}
  | {kind: 'fly'; start: number; end: number; from: CameraPose; to: CameraPose; down: boolean}
  | {kind: 'move'; start: number; end: number; path: Vec2[]; len: number}
  | {kind: 'dwell'; start: number; end: number; at: Vec2; yaw0: number; view: number; yaw1: number};

export interface Timeline {
  duration: number;
  chapters: Chapter[];
  /** 开场：交房时已有的墙从地面立起来 */
  rise: Map<string, Track>;
  demolish: Map<string, Track>;
  build: Map<string, Track>;
  /** 墙面从水泥灰刷成乳胶漆 */
  paint: Track;
  floors: Map<string, Track>;
  furniture: Map<string, Track>;
  route: Route;
  camera: CamSeg[];
  /** 鸟瞰时绕着转的中心和距离 */
  orbit: {cx: number; cz: number; rh: number; h: number};
  /** 拆墙、砌墙时镜头推近到施工的地方 */
  focus: Focus[];
  /** 施工从哪里开始（入户门，m）：立墙、刷墙、铺地都从这里一波波传开 */
  origin: Vec2;
  /** 离 origin 最远的墙有多远（m） */
  reach: number;
}

/** 一段时间里镜头推近：中心移到 c（m），距离乘 k，前后各 ramp 秒过渡 */
export interface Focus {
  start: number;
  end: number;
  c: Vec2;
  k: number;
}
const RAMP = 1.1;

const FOV = 50;
const PITCH = -0.06;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** 墙离 origin 的距离（m），取墙上最近的点 */
function wallDist(w: Plan['walls'][number], o: Vec2): number {
  const a: Vec2 = [w.a[0] / 1000, w.a[1] / 1000];
  const b: Vec2 = [w.b[0] / 1000, w.b[1] / 1000];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((o[0] - a[0]) * dx + (o[1] - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * k - o[0], a[1] + dz * k - o[1]);
}

/** 按离 origin 的远近排 */
const byDist = <T>(items: T[], dist: (x: T) => number) => [...items].sort((a, b) => dist(a) - dist(b));

/** 一组元素依次出场：间隔随数量收紧，整组总时长有上限 */
function stagger(ids: string[], at: number, each: number, maxGap: number, total: number): {tracks: Map<string, Track>; end: number} {
  const gap = ids.length > 1 ? Math.min(maxGap, total / (ids.length - 1)) : 0;
  const tracks = new Map<string, Track>();
  ids.forEach((id, i) => tracks.set(id, {start: at + i * gap, dur: each}));
  return {tracks, end: ids.length ? at + (ids.length - 1) * gap + each : at};
}

function lookQuat(pos: THREE.Vector3, target: THREE.Vector3): [number, number, number, number] {
  const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const quat = new THREE.Quaternion();
function eyePose(p: Vec2, yaw: number): CameraPose {
  euler.set(PITCH, yaw, 0);
  quat.setFromEuler(euler);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).multiplyScalar(3);
  return {pos: [p[0], EYE_HEIGHT, p[1]], quat: [quat.x, quat.y, quat.z, quat.w], fov: FOV_EYE, look: [p[0] + f.x, EYE_HEIGHT + f.y, p[1] + f.z]};
}

/** 从 a 看向 b 的 yaw（0 朝 -z） */
const yawTo = (a: Vec2, b: Vec2) => Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));

/** 走到 s 处时朝前看：取前方 0.9 m 的点 */
function yawAlong(path: readonly Vec2[], len: number, s: number): number {
  const a = pointAlong(path, Math.min(s, Math.max(0, len - 0.05)));
  const b = pointAlong(path, Math.min(len, s + 0.9));
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) {
    const n = path.length;
    return n >= 2 ? yawTo(path[n - 2]!, path[n - 1]!) : 0;
  }
  return yawTo(a, b);
}

/** 角度插值走短的那边 */
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function buildTimeline(plan: Plan): Timeline {
  const b = planBounds(plan);
  const cx = (b.minX + b.maxX) / 2000;
  const cz = (b.minY + b.maxY) / 2000;
  const radius = Math.hypot((b.maxX - b.minX) / 1000, (b.maxY - b.minY) / 1000, plan.wallHeight / 1000) / 2;
  const distance = (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.02;
  const dir = new THREE.Vector3(0.42, 1.25, 0.72).normalize();
  const orbit = {cx, cz, rh: Math.hypot(dir.x, dir.z) * distance, h: dir.y * distance};
  const az0 = Math.atan2(dir.x, dir.z);

  const stats = renovationStats(plan);
  const chapters: Chapter[] = [];
  let t = 0;
  const chapter = (id: ChapterId, label: string, title: string, sub: string, dur: number) => {
    chapters.push({id, label, title, sub, start: t, end: t + dur});
    t += dur;
  };

  // 漫游路线先算出来：入户门是施工的起点，家具按路线经过房间的顺序进场
  const route = planRoute(plan);
  const origin = route.start;
  const reach = Math.max(1, ...plan.walls.map((w) => Math.max(wallDist({...w, b: w.a}, origin), wallDist({...w, a: w.b}, origin))));

  // 1 毛坯：交房时的墙从入户门开始一波波立起来
  const rooms = plan.rooms.filter((r) => r.counted !== false);
  const area = rooms.reduce((s, r) => s + roomArea(r), 0);
  const rise = new Map<string, Track>();
  for (const w of plan.walls) if (!w.added) rise.set(w.id, {start: 0.15 + (wallDist(w, origin) / reach) * 0.9, dur: 0.7});
  chapter('raw', '毛坯', '交房时的样子', rooms.length ? `${area.toFixed(1)} ㎡ · ${rooms.length} 个房间` : '毛坯', 3.6);

  // 拆墙、砌墙时镜头推近到这几面墙：中心取墙的中点，距离按墙的范围定
  const focus: Focus[] = [];
  const focusOn = (ids: string[], from: number, to: number): Focus => {
    const ws = plan.walls.filter((w) => ids.includes(w.id));
    return focusPts(ws.flatMap((w) => [w.a, w.b]), from, to);
  };
  const focusPts = (pts: Vec2[], from: number, to: number): Focus => {
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const c: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2000, (Math.min(...zs) + Math.max(...zs)) / 2000];
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 1000;
    return {start: from + 0.2, end: to - 0.3, c, k: Math.min(0.9, Math.max(0.42, (span + 4) / (radius * 2)))};
  };

  // 2 拆墙
  const wallIds = new Set(plan.walls.map((w) => w.id));
  const gone = plan.demolished.filter((id) => wallIds.has(id));
  let demolish = new Map<string, Track>();
  if (gone.length) {
    // 标红、从上往下一块块砸落、清运，一面墙 2.2 秒
    const s = stagger(byDist(gone, (id) => wallDist(plan.walls.find((w) => w.id === id)!, origin)), t + 0.4, 2.2, 0.4, 2.5);
    demolish = s.tracks;
    focus.push(focusOn(gone, t, s.end));
    chapter('demolish', '拆墙', '拆除非承重墙', `共 ${stats.demolishedM.toFixed(1)} 米`, s.end - t + 0.5);
  }

  // 3 砌墙：从地面长起来
  const added = plan.walls.filter((w) => w.added && !plan.demolished.includes(w.id)).map((w) => w.id);
  let build = new Map<string, Track>();
  if (added.length) {
    // 一皮一皮往上砌，一面墙 2 秒
    const s = stagger(byDist(added, (id) => wallDist(plan.walls.find((w) => w.id === id)!, origin)), t + 0.4, 2, 0.45, 2.5);
    build = s.tracks;
    focus.push(focusOn(added, t, s.end));
    chapter('build', '砌墙', '新砌墙体', `共 ${stats.addedM.toFixed(1)} 米`, s.end - t + 0.5);
  }

  // 4 刷墙铺地：刷墙从入户门附近传开，地面从近到远一个房间一个房间铺
  const paint: Track = {start: t + 0.3, dur: 2.6};
  const roomDist = (r: Plan['rooms'][number]) => {
    const c = r.poly.reduce((a, p) => [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length], [0, 0]);
    return Math.hypot(c[0] / 1000 - origin[0], c[1] / 1000 - origin[1]);
  };
  const floorIds = byDist(plan.rooms, roomDist).map((r) => r.id);
  const fl = stagger(floorIds, t + 0.6, 1.7, 0.45, 3.6);
  // 铺最大的房间（一般是客厅）时推近，看得清一块块砖
  const big = [...plan.rooms].sort((a, b2) => roomArea(b2) - roomArea(a))[0];
  const bigTrack = big && fl.tracks.get(big.id);
  if (big && bigTrack) focus.push(focusPts(big.poly, bigTrack.start - 0.4, bigTrack.start + bigTrack.dur + 0.5));
  const matNames = [...new Set(plan.rooms.map((r) => MATERIALS[r.material]?.name).filter(Boolean))];
  chapter('paint', '铺地', '铺地面、刷墙', matNames.slice(0, 3).join(' · ') || '刷墙', Math.max(paint.start + paint.dur, fl.end) - t + 0.5);

  // 5 家具：按漫游路线经过房间的顺序落位，同一房间大件先进
  const visit = route.legs.map((l) => l.to.room.id);
  const roomIndex = (x: number, y: number) => {
    const r = plan.rooms.find((r2) => pointInPolygon([x, y], r2.poly));
    if (!r) return plan.rooms.length + visit.length;
    const i = visit.indexOf(r.id);
    return i < 0 ? visit.length + plan.rooms.indexOf(r) : i;
  };
  const order = [...plan.furniture]
    .map((f) => ({f, room: roomIndex(f.cx, f.cy)}))
    .sort((a, b2) => a.room - b2.room || b2.f.w * b2.f.d - a.f.w * a.f.d)
    .map((x) => x.f.id);
  let furniture = new Map<string, Track>();
  if (order.length) {
    const s = stagger(order, t + 0.4, 0.8, 0.16, 5);
    furniture = s.tracks;
    chapter('furnish', '家具', '家具进场', `${order.length} 件`, s.end - t + 0.7);
  }

  // 鸟瞰一路慢慢绕：从开头到起飞前一共转 0.9 弧度，并稍微推近
  const camera: CamSeg[] = [{kind: 'orbit', start: 0, end: t, az0: az0 - 0.45, az1: az0 + 0.45, k0: 1.06, k1: 0.94}];
  const orbitPose = (az: number, k: number): CameraPose => {
    const pos = new THREE.Vector3(cx + Math.sin(az) * orbit.rh * k, orbit.h * k, cz + Math.cos(az) * orbit.rh * k);
    return {pos: [pos.x, pos.y, pos.z], quat: lookQuat(pos, new THREE.Vector3(cx, 0, cz)), fov: FOV, look: [cx, 0, cz]};
  };

  // 6 漫游：飞进入户门，按路线逐个房间走，停下来左右看看
  const walkStart = t;
  const first = route.legs[0];
  const startYaw = first && first.path.length > 1 ? yawAlong(first.path, pathLength(first.path), 0) : route.startYaw;
  const enter = eyePose(route.start, startYaw);
  const flyIn = orbitPose(az0 + 0.45, 0.94);
  // 飞行时间随距离变长，镜头每帧最多挪 0.4 m 左右
  const flyDur = (a: CameraPose, b2: CameraPose) => Math.max(3, Math.hypot(a.pos[0] - b2.pos[0], a.pos[1] - b2.pos[1], a.pos[2] - b2.pos[2]) / 5);
  const inDur = flyDur(flyIn, enter);
  camera.push({kind: 'fly', start: t, end: t + inDur, from: flyIn, to: enter, down: true});
  t += inDur;
  const lens = route.legs.map((l) => pathLength(l.path));
  const walkLen = lens.reduce((s, l) => s + l, 0);
  // 总步行时间超过 30 秒就走快点
  const speed = Math.max(1.15, walkLen / 30);
  let yaw = startYaw;
  let here = route.start;
  route.legs.forEach((leg, i) => {
    const len = lens[i]!;
    if (len > 0.05) {
      const dur = len / speed + 0.8;
      camera.push({kind: 'move', start: t, end: t + dur, path: leg.path, len});
      t += dur;
      yaw = yawAlong(leg.path, len, len);
      here = leg.path[leg.path.length - 1]!;
    }
    const next = route.legs[i + 1];
    const nextYaw = next && next.path.length > 1 ? yawAlong(next.path, pathLength(next.path), 0) : yaw;
    // 小房间（卫生间、阳台）看一眼就走
    const dwell = polygonArea(leg.to.room.poly) < 6e6 ? 1.3 : 2.1;
    camera.push({kind: 'dwell', start: t, end: t + dwell, at: here, yaw0: yaw, view: leg.to.view, yaw1: nextYaw});
    t += dwell;
    yaw = nextYaw;
  });
  if (!route.legs.length) {
    camera.push({kind: 'dwell', start: t, end: t + 4, at: here, yaw0: yaw, view: yaw + Math.PI / 2, yaw1: yaw + Math.PI});
    t += 4;
    yaw += Math.PI;
  }
  chapters.push({id: 'walk', label: '漫游', title: '走进新家', sub: '', start: walkStart, end: t});

  // 7 完成：升回鸟瞰
  const done = t;
  const outAz = az0 + 0.45;
  const last = eyePose(here, yaw);
  const outPose = orbitPose(outAz, 1);
  const outDur = flyDur(last, outPose);
  camera.push({kind: 'fly', start: t, end: t + outDur, from: last, to: outPose, down: false});
  t += outDur;
  camera.push({kind: 'orbit', start: t, end: t + 3, az0: outAz, az1: outAz + 0.25, k0: 1, k1: 1});
  t += 3;
  chapters.push({id: 'done', label: '完成', title: plan.name, sub: '改造完成', start: done, end: t});

  return {duration: t, focus, chapters, rise, demolish, build, paint, floors: fl.tracks, furniture, route, camera, orbit, origin, reach};
}


/** t 时刻的相机位置和朝向 */
export function cameraAt(tl: Timeline, time: number): CameraPose {
  const t = Math.max(0, Math.min(tl.duration, time));
  const seg = tl.camera.find((s) => t <= s.end) ?? tl.camera[tl.camera.length - 1]!;
  const u = seg.end > seg.start ? Math.max(0, Math.min(1, (t - seg.start) / (seg.end - seg.start))) : 1;
  switch (seg.kind) {
    case 'orbit': {
      const az = seg.az0 + (seg.az1 - seg.az0) * u;
      let k = seg.k0 + (seg.k1 - seg.k0) * smooth(u);
      let {cx, cz} = tl.orbit;
      const {rh, h} = tl.orbit;
      // 施工时推近：前后各 RAMP 秒平滑过渡
      // 两段推近挨得近时依次叠加，中心从上一处平移到下一处；距离不小于最近的那一段
      let kf = 1;
      for (const f of tl.focus) {
        const w = smooth(Math.max(0, Math.min(1, (t - f.start + RAMP) / RAMP, (f.end + RAMP - t) / RAMP)));
        if (w <= 0) continue;
        cx += (f.c[0] - cx) * w;
        cz += (f.c[1] - cz) * w;
        kf *= 1 + (f.k - 1) * w;
      }
      if (tl.focus.length) k *= Math.max(kf, Math.min(...tl.focus.map((f) => f.k)));
      const pos = new THREE.Vector3(cx + Math.sin(az) * rh * k, h * k, cz + Math.cos(az) * rh * k);
      return {pos: [pos.x, pos.y, pos.z], quat: lookQuat(pos, new THREE.Vector3(cx, 0, cz)), fov: FOV, look: [cx, 0, cz]};
    }
    case 'fly': {
      const k = easeInOut(u);
      // 下降时先水平飞到头顶再落下，上升时先升起再水平移开，免得穿墙
      const ky = seg.down ? k ** 3 : 1 - (1 - k) ** 3;
      const [a, b] = [seg.from.pos, seg.to.pos];
      const pos = new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * ky, a[2] + (b[2] - a[2]) * k);
      const [la, lb] = [seg.from.look, seg.to.look];
      const look = new THREE.Vector3(la[0] + (lb[0] - la[0]) * k, la[1] + (lb[1] - la[1]) * k, la[2] + (lb[2] - la[2]) * k);
      return {pos: [pos.x, pos.y, pos.z], quat: lookQuat(pos, look), fov: seg.from.fov + (seg.to.fov - seg.from.fov) * k, look: [look.x, look.y, look.z]};
    }
    case 'move': {
      // 两头各用 15% 的时间起步、停下，中间匀速
      const A = 0.15;
      const v = 1 / (1 - A);
      const f = u < A ? (v * u * u) / (2 * A) : u > 1 - A ? 1 - (v * (1 - u) ** 2) / (2 * A) : v * (u - A / 2);
      const ss = seg.len * f;
      const p = pointAlong(seg.path, ss);
      return eyePose(p, yawAlong(seg.path, seg.len, ss));
    }
    case 'dwell': {
      // 先转向最开阔的一边停一下，再转向下一段路
      const y = u < 0.5 ? lerpAngle(seg.yaw0, seg.view, smooth(Math.min(1, u / 0.4))) : lerpAngle(seg.view, seg.yaw1, smooth(Math.max(0, (u - 0.6) / 0.4)));
      return eyePose(seg.at, y);
    }
  }
}

export interface Caption {
  index: number;
  total: number;
  title: string;
  sub: string;
  /** 0..1，章节开头结尾淡入淡出 */
  alpha: number;
}

/** t 时刻的字幕；漫游时显示所在房间 */
export function captionAt(tl: Timeline, plan: Plan, t: number, cam?: Vec2): Caption {
  const i = Math.max(0, tl.chapters.findIndex((c) => t < c.end));
  const idx = t >= tl.duration ? tl.chapters.length - 1 : i;
  const c = tl.chapters[idx]!;
  const alpha = Math.max(0, Math.min(1, (t - c.start) / 0.5, (c.end - t) / 0.5 + (idx === tl.chapters.length - 1 ? 1 : 0)));
  let {title, sub} = c;
  if (c.id === 'walk' && cam) {
    const room = plan.rooms.find((r) => pointInPolygon([cam[0] * 1000, cam[1] * 1000], r.poly));
    if (room && t - c.start > 2.4) {
      title = room.name;
      sub = `${(polygonArea(room.poly) / 1e6).toFixed(1)} ㎡ · ${MATERIALS[room.material]?.name ?? ''}`;
    }
  }
  return {index: idx, total: tl.chapters.length, title, sub, alpha};
}

export {tourRooms};
