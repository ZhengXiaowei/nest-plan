import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject} from 'react';
import {Canvas, useFrame, useThree, type ThreeEvent} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Furniture, Opening, Plan, Room} from '../../model/types';
import {floorMaterial, furnitureObject} from './models';
import {EnvironmentMap, FINE_POINTER, FOV, framing, Ground, Lights, M, mat, roomShape, SegmentBox, unitBox, WALL_COLOR} from './scene';
import {useDesignUi, type CameraPreset, type SceneOptions} from '../design/designUi';

type CameraTarget = CameraPreset | {room: string};
import {polygonCentroid, roomArea} from '../../model/geometry';
import {SceneOverlay} from './SceneOverlay';
import {doyOf, siteOf, sunDir3D} from '../../model/sun';
import {usePlanStore} from '../../store/planStore';
import {activeWalls, wallPieces, withCorners} from '../../model/walls';
import {buildColliders, doorCollider, doorsOf, EYE_HEIGHT, openingsOnActiveWalls, startPose, tryMove, type DoorInfo} from './walk';
import './view3d.css';

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ADDED_WALL_COLOR = '#DCE3FB';
/** 剖切墙时墙只画到这个高度（mm） */
export const CUT_HEIGHT = 1200;
const NIGHT_BG = '#1C2130';
const DAY_BG = '#F3F5F8';

/**
 * 3D 视图：按需渲染（frameloop="demand"），只有相机或数据变化时才出帧。
 * 平面 (x, y) mm → 场景 (x, z) m，y 轴朝上。
 */

const Walls = memo(function Walls({plan, cap}: {plan: Plan; cap: number}) {
  // 墙在门窗处断开，拆掉的墙不画
  const pieces = useMemo(() => {
    const openings = openingsOnActiveWalls(plan);
    return withCorners(activeWalls(plan)).flatMap((w) =>
      wallPieces(w, openings).map(([a, b], i) => ({key: `${w.id}:${i}`, a, b, w})),
    );
  }, [plan]);
  return (
    <group>
      {pieces.map(({key, a, b, w}) => {
        const top = Math.min(cap, w.height ?? (w.kind === 'low' ? 1000 : plan.wallHeight));
        return (
        <group key={key}>
          <SegmentBox a={a} b={b} t={w.thickness} y0={0} y1={top} material={mat(w.added ? ADDED_WALL_COLOR : WALL_COLOR[w.kind])} />
          {/* 墙顶深色压顶，俯视时像剖面图一样清楚 */}
          <SegmentBox a={a} b={b} t={w.thickness + 2} y0={top} y1={top + 12} material={mat(w.added ? '#2747D6' : '#34312D', {roughness: 0.9})} />
          {/* 踢脚线：两侧各凸出 8mm，高 80mm */}
          <SegmentBox a={a} b={b} t={w.thickness + 16} y0={0} y1={80} material={mat('#CFC6B8', {roughness: 0.6})} />
        </group>
        );
      })}
    </group>
  );
});

const Openings = memo(function Openings({openings, height, cap}: {openings: Opening[]; height: number; cap: number}) {
  const wall = mat('#F3F4F6');
  const glass = mat('#BFD3F2', {roughness: 0.1, transparent: true, opacity: 0.35});
  const frame = mat('#2747D6', {roughness: 0.6});
  return (
    <group>
      {openings.map((o) => {
        const head = Math.min(cap, o.head ?? 2100);
        const sill = Math.min(cap, o.kind === 'window' ? (o.sill ?? 900) : 0);
        const top = Math.min(cap, height);
        return (
          <group key={o.id}>
            {sill > 0 && <SegmentBox a={o.a} b={o.b} t={o.thickness} y0={0} y1={sill} material={wall} />}
            <SegmentBox a={o.a} b={o.b} t={o.thickness} y0={head} y1={top} material={wall} />
            {o.kind === 'window' && <SegmentBox a={o.a} b={o.b} t={20} y0={sill} y1={head} material={glass} />}
            {o.kind === 'slidingDoor' && <SegmentBox a={o.a} b={o.b} t={30} y0={0} y1={head} material={glass} />}
            {o.isEntry && head < cap && <SegmentBox a={o.a} b={o.b} t={o.thickness + 20} y0={head} y1={head + 40} material={frame} />}
          </group>
        );
      })}
    </group>
  );
});

/** 平开门扇：绕铰链转，点一下开关，带缓动 */
function DoorLeaf({d, open, onToggle, cap}: {d: DoorInfo; open: boolean; onToggle: () => void; cap: number}) {
  const pivot = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    if (pivot.current) pivot.current.rotation.y = open ? d.open : d.closed;
    // 只在挂载时摆一次初始角度，之后由动画驱动
  }, []);
  useEffect(() => invalidate(), [open, invalidate]);
  useFrame((_, dt) => {
    const g = pivot.current;
    if (!g) return;
    const target = open ? d.open : d.closed;
    const diff = target - g.rotation.y;
    if (Math.abs(diff) < 0.0005) return;
    g.rotation.y = REDUCED_MOTION ? target : g.rotation.y + diff * Math.min(1, dt * 7);
    invalidate();
  });
  return (
    <group ref={pivot} position={[d.hinge[0], 0, d.hinge[1]]}>
      <mesh
        geometry={unitBox}
        material={mat('#D9CBB4', {roughness: 0.6})}
        position={[d.leaf / 2, Math.min(d.head, cap * M) / 2, 0]}
        scale={[d.leaf - 0.01, Math.min(d.head, cap * M) - 0.01, 0.04]}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
    </group>
  );
}

const Floors = memo(function Floors({rooms}: {rooms: Room[]}) {
  const geos = useMemo(() => rooms.map((r) => ({r, geo: roomShape(r)})), [rooms]);
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {geos.map(({r, geo}) => (
        <mesh key={r.id} geometry={geo} material={floorMaterial(r.material)} receiveShadow />
      ))}
    </group>
  );
});

/** 天花和吸顶灯：面朝下，只有在屋里抬头才看得见，从上往下看不挡视线 */
const Ceilings = memo(function Ceilings({rooms, height, night}: {rooms: Room[]; height: number; night: boolean}) {
  const geos = useMemo(() => rooms.map((r) => ({r, geo: roomShape(r), at: r.labelAt ?? polygonCentroid(r.poly)})), [rooms]);
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({color: '#FFFFFF', emissive: '#FFF2D6'}), []);
  lamp.emissiveIntensity = night ? 2 : 0.3;
  const y = height * M;
  return (
    <group>
      <group rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]}>
        {geos.map(({r, geo}) => (
          <mesh key={r.id} geometry={geo} material={mat('#FBFAF7', {roughness: 1})} scale={[1, -1, 1]} />
        ))}
      </group>
      {geos.map(({r, at}) => (
        <mesh key={r.id} geometry={lampDisc} material={lamp} rotation={[Math.PI / 2, 0, 0]} position={[at[0] * M, y - 0.02, at[1] * M]} />
      ))}
    </group>
  );
});
// 只有朝下的一面，从上往下看是透明的
const lampDisc = new THREE.CircleGeometry(0.22, 32);

/** 夜景时每个房间一盏顶灯 */
const RoomLamps = memo(function RoomLamps({rooms, height}: {rooms: Room[]; height: number}) {
  return (
    <group>
      {rooms.map((r) => {
        const at = r.labelAt ?? polygonCentroid(r.poly);
        return <pointLight key={r.id} color="#FFD9A8" intensity={7} distance={8} decay={2} position={[at[0] * M, height * M - 0.25, at[1] * M]} />;
      })}
    </group>
  );
});

/** 要标名字的房间：计入面积的那些 */
const labelRooms = (plan: Plan) => plan.rooms.filter((r) => r.counted !== false);

/**
 * 房间名标签是画布外面的普通 DOM，这里每出一帧把它们挪到房间在屏幕上的位置。
 * 只在相机或数据变化时出帧，所以不费电。
 */
function LabelTracker({plan, y, els}: {plan: Plan; y: number; els: RefObject<(HTMLDivElement | null)[]>}) {
  const invalidate = useThree((s) => s.invalidate);
  const points = useMemo(
    () =>
      labelRooms(plan).map((r) => {
        const at = r.labelAt ?? polygonCentroid(r.poly);
        return new THREE.Vector3(at[0] * M, y, at[1] * M);
      }),
    [plan, y],
  );
  useEffect(() => invalidate(), [points, invalidate]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({camera, size}) => {
    points.forEach((p, i) => {
      const el = els.current?.[i];
      if (!el) return;
      v.copy(p).project(camera);
      const hidden = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.visibility = hidden ? 'hidden' : '';
      if (!hidden) el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    });
  });
  return null;
}

/** 一件家具：模型按家具数据缓存，数据没变就不重建 */
const FurnitureModel = memo(function FurnitureModel({f, selectable}: {f: Furniture; selectable: boolean}) {
  const obj = useMemo(() => furnitureObject(f), [f]);
  return (
    <primitive
      object={obj}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (!selectable) return;
        e.stopPropagation();
        usePlanStore.getState().select({kind: 'furniture', id: f.id});
      }}
    />
  );
});

const FurnitureMeshes = memo(function FurnitureMeshes({furniture, selectable}: {furniture: Furniture[]; selectable: boolean}) {
  return (
    <group>
      {furniture.map((f) => (
        <FurnitureModel key={f.id} f={f} selectable={selectable} />
      ))}
    </group>
  );
});

/** 漫游时的输入：键盘、摇杆、拖动转向，由 DOM 层写入，场景里每帧读取 */
export interface WalkInput {
  keys: Set<string>;
  joy: [number, number];
  look: [number, number];
}

type Tween = {t0: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromQ: THREE.Quaternion; toQ: THREE.Quaternion; done: () => void};

 type OrbitTween = {t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromS: THREE.Spherical; toS: THREE.Spherical};

/** 斜视、俯视、某个房间：算出目标点和相机的球坐标 */
function orbitAim(plan: Plan, target: CameraTarget, camera: THREE.PerspectiveCamera, current: THREE.Vector3) {
  const f = framing(plan);
  if (target === 'iso') {
    const t = new THREE.Vector3(...f.target);
    return {target: t, spherical: new THREE.Spherical().setFromVector3(new THREE.Vector3(...f.position).sub(t))};
  }
  if (target === 'top') {
    const half = Math.tan(((FOV / 2) * Math.PI) / 180);
    const dist = Math.max(f.d / 2 / half, f.w / 2 / (half * camera.aspect)) * 1.12 + plan.wallHeight * M;
    // theta 为 0 时相机在 +z 一侧，画面上方朝 -z，和平面图一样北在上
    return {target: new THREE.Vector3(...f.target), spherical: new THREE.Spherical(dist, 0.001, 0)};
  }
  const room = plan.rooms.find((r) => r.id === target.room);
  if (!room) return null;
  const xs = room.poly.map((p) => p[0]);
  const ys = room.poly.map((p) => p[1]);
  const t = new THREE.Vector3(((Math.min(...xs) + Math.max(...xs)) / 2) * M, 0.6, ((Math.min(...ys) + Math.max(...ys)) / 2) * M);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * M;
  const dir = camera.position.clone().sub(current).setY(0);
  if (dir.lengthSq() < 0.01) dir.set(0.6, 0, 0.8);
  dir.normalize();
  const dist = size * 1.3 + 2.2;
  const pos = new THREE.Vector3(t.x + dir.x * dist * 0.7, dist * 1.05, t.z + dir.z * dist * 0.7);
  return {target: t, spherical: new THREE.Spherical().setFromVector3(pos.sub(t))};
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * 相机控制：环绕和漫游之间飞过去（约 0.9 秒），漫游时处理走路、转头、碰撞和开门。
 */
function CameraRig({
  plan,
  mode,
  input,
  doors,
  doorOpen,
  toggleDoor,
  aimable,
}: {
  plan: Plan;
  mode: 'orbit' | 'walk';
  aimable: boolean;
  input: RefObject<WalkInput>;
  doors: DoorInfo[];
  doorOpen: Record<string, boolean>;
  toggleDoor: (id: string) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {target: THREE.Vector3; enabled: boolean; update(): void} | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<Tween | null>(null);
  const orbitTw = useRef<OrbitTween | null>(null);
  const walking = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const colliders = useMemo(() => buildColliders(plan), [plan]);
  const frame = framing(plan);
  const first = useRef(true);

  const flyTo = (pos: THREE.Vector3, q: THREE.Quaternion, done: () => void) => {
    tween.current = {t0: performance.now(), dur: REDUCED_MOTION ? 0 : 900, fromPos: camera.position.clone(), toPos: pos, fromQ: camera.quaternion.clone(), toQ: q, done};
    invalidate();
  };

  useEffect(() => {
    if (first.current && mode === 'orbit') {
      first.current = false;
      return;
    }
    first.current = false;
    if (mode === 'walk') {
      if (controls) controls.enabled = false;
      walking.current = false;
      const {pos, yaw} = startPose(plan);
      euler.current.set(0, yaw, 0);
      flyTo(new THREE.Vector3(pos[0], EYE_HEIGHT, pos[1]), new THREE.Quaternion().setFromEuler(euler.current), () => (walking.current = true));
    } else {
      walking.current = false;
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(...frame.position), new THREE.Vector3(...frame.target), new THREE.Vector3(0, 1, 0));
      flyTo(new THREE.Vector3(...frame.position), new THREE.Quaternion().setFromRotationMatrix(look), () => {
        if (!controls) return;
        controls.target.set(...frame.target);
        controls.enabled = true;
        controls.update();
      });
    }
    // 只跟着模式切换
  }, [mode]);

  // 预设视角和飞到房间：绕着目标点走弧线过去，不是直线穿过去
  const request = useDesignUi((s) => (aimable ? s.camera : null));
  const seen = useRef(request?.n ?? 0);
  useEffect(() => {
    if (!request || request.n <= seen.current) return;
    seen.current = request.n;
    if (mode !== 'orbit' || !controls) return;
    const aim = orbitAim(plan, request.target, camera as THREE.PerspectiveCamera, controls.target);
    if (!aim) return;
    controls.enabled = false;
    orbitTw.current = {
      t0: performance.now(),
      dur: REDUCED_MOTION ? 0 : 900,
      fromT: controls.target.clone(),
      toT: aim.target,
      fromS: new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)),
      toS: aim.spherical,
    };
    invalidate();
  }, [request?.n]);

  // 换了户型（比如刚从还原页生成）就重新取景
  useEffect(() => {
    if (mode !== 'orbit' || !controls) return;
    camera.position.set(...frame.position);
    controls.target.set(...frame.target);
    controls.update();
    invalidate();
  }, [plan.id]);

  // E 开关最近的门
  useEffect(() => {
    if (mode !== 'walk') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || !walking.current) return;
      const p: [number, number] = [camera.position.x, camera.position.z];
      let best: DoorInfo | null = null;
      let bestD = 1.8;
      for (const d of doors) {
        const dist = Math.hypot(d.mid[0] - p[0], d.mid[1] - p[1]);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (best) toggleDoor(best.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, doors, toggleDoor, camera]);

  useFrame((_, dt) => {
    const ot = orbitTw.current;
    if (ot) {
      const t = ot.dur ? Math.min(1, (performance.now() - ot.t0) / ot.dur) : 1;
      const k = easeInOut(t);
      const target = ot.fromT.clone().lerp(ot.toT, k);
      let dth = ot.toS.theta - ot.fromS.theta;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      const sph = new THREE.Spherical(
        ot.fromS.radius + (ot.toS.radius - ot.fromS.radius) * k,
        ot.fromS.phi + (ot.toS.phi - ot.fromS.phi) * k,
        ot.fromS.theta + dth * k,
      );
      camera.position.setFromSpherical(sph).add(target);
      camera.lookAt(target);
      if (controls) controls.target.copy(target);
      if (t >= 1) {
        orbitTw.current = null;
        if (controls) {
          controls.enabled = true;
          controls.update();
        }
      }
      invalidate();
      return;
    }
    const tw = tween.current;
    if (tw) {
      const t = tw.dur ? Math.min(1, (performance.now() - tw.t0) / tw.dur) : 1;
      const k = easeInOut(t);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      camera.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, k);
      if (t >= 1) {
        tween.current = null;
        tw.done();
      }
      invalidate();
      return;
    }
    if (mode !== 'walk' || !walking.current) return;
    const inp = input.current;
    if (!inp) return;

    // 转头：鼠标位移或拖动累计量
    const e = euler.current;
    e.y -= inp.look[0] * 0.0024;
    e.x = Math.max(-1.45, Math.min(1.45, e.x - inp.look[1] * 0.0024));
    inp.look[0] = 0;
    inp.look[1] = 0;
    camera.quaternion.setFromEuler(e);

    // 走：前后左右 + 摇杆
    const k = inp.keys;
    let fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - inp.joy[1];
    let side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + inp.joy[0];
    const mag = Math.hypot(fwd, side);
    if (mag > 1) {
      fwd /= mag;
      side /= mag;
    }
    if (mag < 0.01) return;
    const speed = (k.has('shift') ? 2.8 : 1.4) * Math.min(dt, 0.05);
    const sin = Math.sin(e.y);
    const cos = Math.cos(e.y);
    // yaw=0 时朝 -z 看
    const dx = (-sin * fwd + cos * side) * speed;
    const dz = (-cos * fwd - sin * side) * speed;
    const closedDoors = doors.filter((d) => !doorOpen[d.id]).map(doorCollider);
    const [nx, nz] = tryMove(closedDoors.length ? [...colliders, ...closedDoors] : colliders, [camera.position.x, camera.position.z], dx, dz);
    camera.position.x = nx;
    camera.position.z = nz;
  });

  return null;
}

function Scene({plan, mode, input, opts, pip, labelEls}: {plan: Plan; mode: 'orbit' | 'walk'; input: RefObject<WalkInput>; opts: SceneOptions; pip: boolean; labelEls: RefObject<(HTMLDivElement | null)[]>}) {
  const f = framing(plan);
  const openings = useMemo(() => openingsOnActiveWalls(plan), [plan]);
  const doors = useMemo(() => doorsOf(openings), [openings]);
  // 门默认开着，漫游时一路走得通
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const doorOpen = useMemo(() => Object.fromEntries(doors.map((d) => [d.id, !closed[d.id]])), [doors, closed]);
  const toggleDoor = useCallback((id: string) => setClosed((c) => ({...c, [id]: !c[id]})), []);
  // 剖切只在环绕视角下生效，漫游时墙总是全高
  const cap = opts.cut && mode === 'orbit' ? CUT_HEIGHT : Infinity;
  const labelY = (Math.min(cap, plan.wallHeight) + 150) * M;
  const sunDay = useDesignUi((s) => s.sunDay);
  const sun = useMemo(() => sunDir3D(siteOf(plan), doyOf(sunDay), opts.hour), [plan, sunDay, opts.hour]);
  return (
    <>
      <EnvironmentMap intensity={opts.night ? 0.15 : 1} />
      <Exposure value={opts.night ? 1.25 : 1.05} />
      <Lights cx={f.cx} cz={f.cz} span={Math.max(f.w, f.d)} sun={sun} night={opts.night} />
      {opts.night && <RoomLamps rooms={plan.rooms} height={plan.wallHeight} />}
      <group>
        <Ground cx={f.cx} cz={f.cz} w={f.w} d={f.d} night={opts.night} />
        <Floors rooms={plan.rooms} />
        <Walls plan={plan} cap={cap} />
        <Openings openings={openings} height={plan.wallHeight} cap={cap} />
        {cap === Infinity && <Ceilings rooms={plan.rooms} height={plan.wallHeight} night={opts.night} />}
        {doors.map((d) => (
          <DoorLeaf key={d.id} d={d} open={doorOpen[d.id] ?? true} onToggle={() => toggleDoor(d.id)} cap={cap} />
        ))}
        {opts.furniture && <FurnitureMeshes furniture={plan.furniture} selectable={mode === 'orbit'} />}
      </group>
      {showLabels(opts, mode, pip) && <LabelTracker plan={plan} y={labelY} els={labelEls} />}
      <OrbitControls target={f.target} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.1} makeDefault />
      <CameraRig plan={plan} mode={mode} input={input} doors={doors} doorOpen={doorOpen} toggleDoor={toggleDoor} aimable={!pip} />
    </>
  );
}

const showLabels = (opts: SceneOptions, mode: 'orbit' | 'walk', pip: boolean) => opts.labels && mode === 'orbit' && !pip;

/** 色调映射曝光：夜景稍微提亮，灯光才有氛围 */
function Exposure({value}: {value: number}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.toneMappingExposure = value;
    invalidate();
  }, [gl, value, invalidate]);
  return null;
}

export default function Viewer3D({mode = 'orbit', pip = false}: {mode?: 'orbit' | 'walk'; pip?: boolean}) {
  const plan = usePlanStore((s) => s.plan);
  const opts = useDesignUi((s) => s.scene);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const {position} = framing(plan);
  const input = useRef<WalkInput>({keys: new Set(), joy: [0, 0], look: [0, 0]});
  const wrap = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  const walk = mode === 'walk';

  // 漫游的键盘和鼠标输入
  useEffect(() => {
    if (!walk) return;
    const inp = input.current;
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      inp.keys.add(k);
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => inp.keys.delete(e.key.toLowerCase());
    const blur = () => inp.keys.clear();
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement && wrap.current?.contains(document.pointerLockElement)) {
        inp.look[0] += e.movementX;
        inp.look[1] += e.movementY;
      }
    };
    const lockChange = () => setLocked(!!document.pointerLockElement && !!wrap.current?.contains(document.pointerLockElement));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('mousemove', move);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('pointerlockchange', lockChange);
      inp.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [walk]);

  // 没锁鼠标时（触屏、或者用户不想锁），按住拖动也能转头
  const drag = useRef<{x: number; y: number; id: number} | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!walk || locked) return;
    if (FINE_POINTER && e.pointerType === 'mouse' && e.button === 0 && e.detail >= 1 && !e.altKey) {
      // 鼠标点一下画面就锁定，像游戏一样转头
      const canvas = wrap.current?.querySelector('canvas');
      const req = canvas?.requestPointerLock?.() as Promise<void> | undefined;
      if (req && typeof req.catch === 'function') req.catch(() => {});
    }
    drag.current = {x: e.clientX, y: e.clientY, id: e.pointerId};
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!walk || locked || !d || d.id !== e.pointerId) return;
    input.current.look[0] += (e.clientX - d.x) * 1.4;
    input.current.look[1] += (e.clientY - d.y) * 1.4;
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const endDrag = () => (drag.current = null);

  return (
    <div ref={wrap} className={walk ? 'v3-wrap is-walk' : 'v3-wrap'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <Canvas
        frameloop={walk ? 'always' : 'demand'}
        dpr={[1, 2]}
        shadows="percentage"
        gl={{antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05}}
        camera={{fov: FOV, near: 0.05, far: 400, position}}
      >
        <color attach="background" args={[opts.night ? NIGHT_BG : DAY_BG]} />
        <Scene plan={plan} mode={mode} input={input} opts={opts} pip={pip} labelEls={labelEls} />
      </Canvas>
      {showLabels(opts, mode, pip) && (
        <div className="v3-labels" aria-hidden>
          {labelRooms(plan).map((r, i) => (
            <div key={r.id} ref={(el) => void (labelEls.current[i] = el)} className="v3-label" style={{visibility: 'hidden'}}>
              {r.name}
              <small>{roomArea(r).toFixed(1)} ㎡</small>
            </div>
          ))}
        </div>
      )}
      {!pip && !walk && <SceneOverlay plan={plan} />}
      {walk && (
        <>
          {locked && <div className="v3-cross" aria-hidden />}
          <p className="v3-walk-hint">
            {FINE_POINTER
              ? locked
                ? 'WASD 移动 · 鼠标转向 · Shift 快走 · E 开关门 · Esc 松开鼠标'
                : '点一下画面锁定鼠标转向，或按住拖动 · WASD 移动 · Shift 快走 · E 开关门'
              : '左下摇杆移动 · 拖动画面转向 · 点门开关'}
          </p>
          {!FINE_POINTER && <Joystick input={input} />}
        </>
      )}
    </div>
  );
}

/** 触屏摇杆：推多远走多快 */
function Joystick({input}: {input: RefObject<WalkInput>}) {
  const knob = useRef<HTMLElement>(null);
  const id = useRef<number | null>(null);
  const R = 50;
  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > R) {
      dx = (dx / m) * R;
      dy = (dy / m) * R;
    }
    input.current.joy = [dx / R, dy / R];
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = () => {
    id.current = null;
    input.current.joy = [0, 0];
    if (knob.current) knob.current.style.transform = '';
  };
  return (
    <div
      className="v3-joy"
      onPointerDown={(e) => {
        e.stopPropagation();
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (e.pointerId === id.current) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <i ref={knob} />
    </div>
  );
}
