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
}

const FOV = 50;
const PITCH = -0.06;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);

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

  // 1 毛坯
  const rooms = plan.rooms.filter((r) => r.counted !== false);
  const area = rooms.reduce((s, r) => s + roomArea(r), 0);
  chapter('raw', '毛坯', '交房时的样子', rooms.length ? `${area.toFixed(1)} ㎡ · ${rooms.length} 个房间` : '毛坯', 3.2);

  // 2 拆墙：先闪一下红，再沉下去
  const wallIds = new Set(plan.walls.map((w) => w.id));
  const gone = plan.demolished.filter((id) => wallIds.has(id));
  let demolish = new Map<string, Track>();
  if (gone.length) {
    const s = stagger(gone, t + 0.5, 1.2, 0.45, 3);
    demolish = s.tracks;
    chapter('demolish', '拆墙', '拆除非承重墙', `共 ${stats.demolishedM.toFixed(1)} 米`, s.end - t + 0.5);
  }

  // 3 砌墙：从地面长起来
  const added = plan.walls.filter((w) => w.added && !plan.demolished.includes(w.id)).map((w) => w.id);
  let build = new Map<string, Track>();
  if (added.length) {
    const s = stagger(added, t + 0.5, 1.1, 0.45, 3);
    build = s.tracks;
    chapter('build', '砌墙', '新砌墙体', `共 ${stats.addedM.toFixed(1)} 米`, s.end - t + 0.5);
  }

  // 4 铺地刷墙
  const paint: Track = {start: t + 0.3, dur: 1.6};
  const floorIds = plan.rooms.map((r) => r.id);
  const fl = stagger(floorIds, t + 0.5, 0.9, 0.35, 3);
  const matNames = [...new Set(plan.rooms.map((r) => MATERIALS[r.material]?.name).filter(Boolean))];
  chapter('paint', '铺地', '铺地面、刷墙', matNames.slice(0, 3).join(' · ') || '刷墙', Math.max(paint.start + paint.dur, fl.end) - t + 0.5);

  // 5 家具：按房间依次落位，大件先进
  const roomIndex = (x: number, y: number) => {
    const i = plan.rooms.findIndex((r) => pointInPolygon([x, y], r.poly));
    return i < 0 ? plan.rooms.length : i;
  };
  const order = [...plan.furniture]
    .map((f) => ({f, room: roomIndex(f.cx, f.cy)}))
    .sort((a, b2) => a.room - b2.room || b2.f.w * b2.f.d - a.f.w * a.f.d)
    .map((x) => x.f.id);
  let furniture = new Map<string, Track>();
  if (order.length) {
    const s = stagger(order, t + 0.4, 0.75, 0.16, 5);
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
  const route = planRoute(plan);
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

  return {duration: t, chapters, demolish, build, paint, floors: fl.tracks, furniture, route, camera, orbit};
}


/** t 时刻的相机位置和朝向 */
export function cameraAt(tl: Timeline, time: number): CameraPose {
  const t = Math.max(0, Math.min(tl.duration, time));
  const seg = tl.camera.find((s) => t <= s.end) ?? tl.camera[tl.camera.length - 1]!;
  const u = seg.end > seg.start ? Math.max(0, Math.min(1, (t - seg.start) / (seg.end - seg.start))) : 1;
  switch (seg.kind) {
    case 'orbit': {
      const az = seg.az0 + (seg.az1 - seg.az0) * u;
      const k = seg.k0 + (seg.k1 - seg.k0) * smooth(u);
      const {cx, cz, rh, h} = tl.orbit;
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
