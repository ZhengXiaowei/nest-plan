import {memo, useMemo} from 'react';
import {Canvas} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Furniture, Opening, Plan, Room, Vec2, Wall} from '../../model/types';
import {MATERIALS} from '../../model/materials';
import {planBounds} from '../../model/geometry';
import {FURNITURE_ELEVATION, FURNITURE_HEIGHT} from '../../model/catalog';
import {usePlanStore} from '../../store/planStore';

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

const WALL_COLOR: Record<Wall['kind'], string> = {
  bearing: '#E5E7EB',
  exterior: '#F3F4F6',
  partition: '#F9FAFB',
  low: '#F3F4F6',
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
      position={[((a[0] + b[0]) / 2) * M, ((y0 + y1) / 2) * M, ((a[1] + b[1]) / 2) * M]}
      rotation={[0, -angle, 0]}
      scale={[len * M, (y1 - y0) * M, t * M]}
    />
  );
}

const Walls = memo(function Walls({walls, height}: {walls: Wall[]; height: number}) {
  return (
    <group>
      {walls.map((w) => (
        <SegmentBox
          key={w.id}
          a={w.a}
          b={w.b}
          t={w.thickness}
          y0={0}
          y1={w.height ?? (w.kind === 'low' ? 1000 : height)}
          material={mat(WALL_COLOR[w.kind])}
        />
      ))}
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
        <mesh key={r.id} geometry={geo} material={mat(MATERIALS[r.material].swatch, {roughness: 0.7})} />
      ))}
    </group>
  );
});

const FurnitureMeshes = memo(function FurnitureMeshes({furniture}: {furniture: Furniture[]}) {
  return (
    <group>
      {furniture.map((f) => {
        const h = FURNITURE_HEIGHT[f.type] ?? 600;
        const y0 = FURNITURE_ELEVATION[f.type] ?? 0;
        return (
          <mesh
            key={f.id}
            geometry={unitBox}
            material={mat(f.color, {roughness: 0.9})}
            position={[f.cx * M, (y0 + h / 2) * M + 0.002, f.cy * M]}
            rotation={[0, (-f.rot * Math.PI) / 180, 0]}
            scale={[f.w * M, h * M, f.d * M]}
          />
        );
      })}
    </group>
  );
});

function Scene({plan}: {plan: Plan}) {
  const b = planBounds(plan);
  const cx = ((b.minX + b.maxX) / 2) * M;
  const cz = ((b.minY + b.maxY) / 2) * M;
  return (
    <>
      <hemisphereLight args={['#FFFFFF', '#D6DBE4', 1.6]} />
      <directionalLight position={[cx + 6, 12, cz + 8]} intensity={1.4} />
      <group>
        <Floors rooms={plan.rooms} />
        <Walls walls={plan.walls} height={plan.wallHeight} />
        <Openings openings={plan.openings} height={plan.wallHeight} />
        <FurnitureMeshes furniture={plan.furniture} />
      </group>
      <OrbitControls target={[cx, 0, cz]} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.1} makeDefault />
    </>
  );
}

export default function Viewer3D() {
  const plan = usePlanStore((s) => s.plan);
  const b = planBounds(plan);
  const cx = ((b.minX + b.maxX) / 2) * M;
  const cz = ((b.minY + b.maxY) / 2) * M;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) * M;
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{antialias: true, powerPreference: 'high-performance'}}
      camera={{fov: 40, near: 0.1, far: 200, position: [cx + span * 0.55, span * 1.05, cz + span * 1.0]}}
    >
      <color attach="background" args={['#F3F5F8']} />
      <Scene plan={plan} />
    </Canvas>
  );
}
