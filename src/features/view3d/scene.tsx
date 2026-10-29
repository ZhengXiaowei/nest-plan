import {useEffect, useLayoutEffect, useRef} from 'react';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import type {Plan, Room, Vec2, Wall} from '../../model/types';
import {planBounds} from '../../model/geometry';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {setEnvironment} from './models';

/**
 * 3D 视图和改造回放共用的场景零件：材质、墙段盒子、取景、灯光、环境反射。
 * 平面 (x, y) mm → 场景 (x, z) m，y 轴朝上。
 */

export const FOV = 50;
export const M = 0.001;
export const unitBox = new THREE.BoxGeometry(1, 1, 1);

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: {roughness?: number; transparent?: boolean; opacity?: number} = {}) {
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
export const WALL_COLOR: Record<Wall['kind'], string> = {
  bearing: '#E7E3DC',
  exterior: '#F1EEE8',
  partition: '#F5F2EC',
  low: '#EFEBE4',
};

/** 沿线段放一个盒子：从 a 到 b，厚度 t，底高 y0 到顶高 y1（mm） */
export function SegmentBox({a, b, t, y0, y1, material}: {a: Vec2; b: Vec2; t: number; y0: number; y1: number; material: THREE.Material}) {
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

export function roomShape(room: Room) {
  const shape = new THREE.Shape();
  room.poly.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * M, -y * M) : shape.lineTo(x * M, -y * M)));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** 环境反射：只挂给金属和光滑表面（模型模块里统一处理） */
export function EnvironmentMap() {
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
export function framing(plan: Plan) {
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
export function Ground({cx, cz, w, d}: {cx: number; cz: number; w: number; d: number}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.004, cz]} material={mat('#E2DFDA', {roughness: 0.95})} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/** 天光 + 一盏带软阴影的太阳，阴影范围跟着户型大小走 */
export function Lights({cx, cz, span}: {cx: number; cz: number; span: number}) {
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

export const FINE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
// 平板 GPU 用小一点的阴影贴图
export const SHADOW_MAP = FINE_POINTER ? 4096 : 2048;

