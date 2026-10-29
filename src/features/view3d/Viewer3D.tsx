import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject} from 'react';
import {Canvas, useFrame, useThree, type ThreeEvent} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Furniture, Opening, Plan, Room, Vec2, Wall} from '../../model/types';
import {planBounds} from '../../model/geometry';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {floorMaterial, furnitureObject, setEnvironment} from './models';
import {usePlanStore} from '../../store/planStore';
import {activeWalls, wallPieces, withCorners} from '../../model/walls';
import {buildColliders, doorCollider, doorsOf, EYE_HEIGHT, openingsOnActiveWalls, startPose, tryMove, type DoorInfo} from './walk';
import './view3d.css';

const FOV = 50;
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ADDED_WALL_COLOR = '#DCE3FB';

/**
 * 3D 视图：按需渲染（frameloop="demand"），只有相机或数据变化时才出帧。
 * 平面 (x, y) mm → 场景 (x, z) m，y 轴朝上。
 */

const M = 0.001;
const unitBox = new THREE.BoxGeometry(1, 1, 1);

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: {roughness?: number; transparent?: boolean; opacity?: number} = {}) {
  const key = `${color}|${opts.roughness ?? 0.85}|${opts.opacity ?? 1}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    materialCache.set(key, m);
  }
  return m;
}

// 墙面统一暖白乳胶漆，承重墙略深一点，方便在 3D 里分辨
const WALL_COLOR: Record<Wall['kind'], string> = {
  bearing: '#E7E3DC',
  exterior: '#F1EEE8',
  partition: '#F5F2EC',
  low: '#EFEBE4',
};

/** 沿线段放一个盒子：从 a 到 b，厚度 t，底高 y0 到顶高 y1（mm） */
function SegmentBox({a, b, t, y0, y1, material}: {a: Vec2; b: Vec2; t: number; y0: number; y1: number; material: THREE.Material}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= 0 || y1 <= y0) return null;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (
    <mesh
      geometry={unitBox}
      material={material}
      castShadow
      receiveShadow
      position={[((a[0] + b[0]) / 2) * M, ((y0 + y1) / 2) * M, ((a[1] + b[1]) / 2) * M]}
      rotation={[0, -angle, 0]}
      scale={[len * M, (y1 - y0) * M, t * M]}
    />
  );
}

const Walls = memo(function Walls({plan}: {plan: Plan}) {
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
        const top = w.height ?? (w.kind === 'low' ? 1000 : plan.wallHeight);
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

const Openings = memo(function Openings({openings, height}: {openings: Opening[]; height: number}) {
  const wall = mat('#F3F4F6');
  const glass = mat('#BFD3F2', {roughness: 0.1, transparent: true, opacity: 0.35});
  const frame = mat('#2747D6', {roughness: 0.6});
  return (
    <group>
      {openings.map((o) => {
        const head = o.head ?? 2100;
        const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
        return (
          <group key={o.id}>
            {sill > 0 && <SegmentBox a={o.a} b={o.b} t={o.thickness} y0={0} y1={sill} material={wall} />}
            <SegmentBox a={o.a} b={o.b} t={o.thickness} y0={head} y1={height} material={wall} />
            {o.kind === 'window' && <SegmentBox a={o.a} b={o.b} t={20} y0={sill} y1={head} material={glass} />}
            {o.kind === 'slidingDoor' && <SegmentBox a={o.a} b={o.b} t={30} y0={0} y1={head} material={glass} />}
            {o.isEntry && <SegmentBox a={o.a} b={o.b} t={o.thickness + 20} y0={head} y1={head + 40} material={frame} />}
          </group>
        );
      })}
    </group>
  );
});

/** 平开门扇：绕铰链转，点一下开关，带缓动 */
function DoorLeaf({d, open, onToggle}: {d: DoorInfo; open: boolean; onToggle: () => void}) {
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
        position={[d.leaf / 2, d.head / 2, 0]}
        scale={[d.leaf - 0.01, d.head - 0.01, 0.04]}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
    </group>
  );
}

function roomShape(room: Room) {
  const shape = new THREE.Shape();
  room.poly.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * M, -y * M) : shape.lineTo(x * M, -y * M)));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
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

/** 环境反射：只挂给金属和光滑表面（模型模块里统一处理） */
function EnvironmentMap() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    setEnvironment(env);
    invalidate();
    return () => {
      setEnvironment(null);
      env.dispose();
    };
  }, [gl, invalidate]);
  return null;
}

/** 整套房子的外接球，用来摆相机：保证任何尺寸的户型一进来都完整可见 */
function framing(plan: Plan) {
  const b = planBounds(plan);
  const w = (b.maxX - b.minX) * M;
  const d = (b.maxY - b.minY) * M;
  const cx = ((b.minX + b.maxX) / 2) * M;
  const cz = ((b.minY + b.maxY) / 2) * M;
  const radius = Math.hypot(w, d, plan.wallHeight * M) / 2;
  const distance = (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.05;
  const dir = new THREE.Vector3(0.42, 1.25, 0.72).normalize();
  return {
    cx,
    cz,
    w,
    d,
    target: [cx, 0, cz] as [number, number, number],
    position: [cx + dir.x * distance, dir.y * distance, cz + dir.z * distance] as [number, number, number],
  };
}

/** 毛坯地面：没圈成房间的地方也有地，不会露出背景 */
function Ground({cx, cz, w, d}: {cx: number; cz: number; w: number; d: number}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.004, cz]} material={mat('#E2DFDA', {roughness: 0.95})} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/** 天光 + 一盏带软阴影的太阳，阴影范围跟着户型大小走 */
function Lights({cx, cz, span}: {cx: number; cz: number; span: number}) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const half = span / 2 + 1.5;
  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    Object.assign(l.shadow.camera, {left: -half, right: half, top: half, bottom: -half, near: 1, far: 60});
    l.shadow.camera.updateProjectionMatrix();
  }, [cx, cz, half]);
  return (
    <>
      <hemisphereLight args={['#FFF8EE', '#B9A88F', 1.15]} />
      {/* 室内补光：墙背光面在漫游时不至于发灰 */}
      <ambientLight color="#FFF6EA" intensity={0.55} />
      <directionalLight
        ref={sun}
        position={[cx + 7, 14, cz + 5]}
        intensity={2.4}
        color="#FFF1DD"
        castShadow
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

/** 漫游时的输入：键盘、摇杆、拖动转向，由 DOM 层写入，场景里每帧读取 */
export interface WalkInput {
  keys: Set<string>;
  joy: [number, number];
  look: [number, number];
}

type Tween = {t0: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromQ: THREE.Quaternion; toQ: THREE.Quaternion; done: () => void};

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
}: {
  plan: Plan;
  mode: 'orbit' | 'walk';
  input: RefObject<WalkInput>;
  doors: DoorInfo[];
  doorOpen: Record<string, boolean>;
  toggleDoor: (id: string) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {target: THREE.Vector3; enabled: boolean; update(): void} | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<Tween | null>(null);
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

function Scene({plan, mode, input}: {plan: Plan; mode: 'orbit' | 'walk'; input: RefObject<WalkInput>}) {
  const f = framing(plan);
  const openings = useMemo(() => openingsOnActiveWalls(plan), [plan]);
  const doors = useMemo(() => doorsOf(openings), [openings]);
  // 门默认开着，漫游时一路走得通
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const doorOpen = useMemo(() => Object.fromEntries(doors.map((d) => [d.id, !closed[d.id]])), [doors, closed]);
  const toggleDoor = useCallback((id: string) => setClosed((c) => ({...c, [id]: !c[id]})), []);
  return (
    <>
      <EnvironmentMap />
      <Lights cx={f.cx} cz={f.cz} span={Math.max(f.w, f.d)} />
      <group>
        <Ground cx={f.cx} cz={f.cz} w={f.w} d={f.d} />
        <Floors rooms={plan.rooms} />
        <Walls plan={plan} />
        <Openings openings={openings} height={plan.wallHeight} />
        {doors.map((d) => (
          <DoorLeaf key={d.id} d={d} open={doorOpen[d.id] ?? true} onToggle={() => toggleDoor(d.id)} />
        ))}
        <FurnitureMeshes furniture={plan.furniture} selectable={mode === 'orbit'} />
      </group>
      <OrbitControls target={f.target} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.1} makeDefault />
      <CameraRig plan={plan} mode={mode} input={input} doors={doors} doorOpen={doorOpen} toggleDoor={toggleDoor} />
    </>
  );
}

const FINE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
// 平板 GPU 用小一点的阴影贴图
const SHADOW_MAP = FINE_POINTER ? 4096 : 2048;

export default function Viewer3D({mode = 'orbit'}: {mode?: 'orbit' | 'walk'}) {
  const plan = usePlanStore((s) => s.plan);
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
        shadows="soft"
        gl={{antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05}}
        camera={{fov: FOV, near: 0.05, far: 400, position}}
      >
        <color attach="background" args={['#F3F5F8']} />
        <Scene plan={plan} mode={mode} input={input} />
      </Canvas>
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
