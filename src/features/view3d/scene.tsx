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
export function EnvironmentMap({intensity = 1}: {intensity?: number}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const env = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    env.current = tex;
    setEnvironment(tex, intensity);
    invalidate();
    return () => {
      env.current = null;
      setEnvironment(null);
      tex.dispose();
    };
    // 强度另外跟
  }, [gl, invalidate]);
  useEffect(() => {
    if (!env.current) return;
    setEnvironment(env.current, intensity);
    invalidate();
  }, [intensity, invalidate]);
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
export function Ground({cx, cz, w, d, night = false}: {cx: number; cz: number; w: number; d: number; night?: boolean}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.004, cz]} material={mat(night ? '#2A2E38' : '#E2DFDA', {roughness: 0.95})} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/** 指向太阳的方向和高度角，见 model/sun 的 sunDir3D */
export interface SunVector {
  dir: [number, number, number];
  el: number;
}

/**
 * 按真实太阳位置摆太阳光：高度角越低越暖越弱，落到地平线以下只剩一点暮光。
 */
export function sunLight(sun: SunVector, cx: number, cz: number) {
  const k = Math.max(0, Math.min(1, Math.sin(sun.el) / Math.sin((50 * Math.PI) / 180)));
  const warm = 1 - k;
  const d = 22;
  // 太阳在地平线以下时，光从地平线附近打过来，避免从地底往上照
  const y = Math.max(0.15, sun.dir[1]);
  return {
    position: [cx + sun.dir[0] * d, y * d, cz + sun.dir[2] * d] as [number, number, number],
    intensity: sun.el <= 0 ? 0.15 : 0.6 + k * 2.2,
    color: new THREE.Color().setHSL(0.08, 0.35 + warm * 0.55, 0.93 - warm * 0.15),
  };
}

/**
 * 天光 + 一盏带软阴影的太阳，阴影范围跟着户型大小走。
 * 给了 sun 就按真实太阳摆；night 时只留一点月光，屋里的灯另外加。
 */
export function Lights({cx, cz, span, sun, night = false}: {cx: number; cz: number; span: number; sun?: SunVector; night?: boolean}) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const half = span / 2 + 1.5;
  const s = sun ? sunLight(sun, cx, cz) : null;
  const dusk = sun ? Math.max(0, Math.min(1, (sun.el * 180) / Math.PI / 12)) : 1;
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    Object.assign(l.shadow.camera, {left: -half, right: half, top: half, bottom: -half, near: 1, far: 70});
    l.shadow.camera.updateProjectionMatrix();
  }, [cx, cz, half]);
  return (
    <>
      <hemisphereLight args={['#FFF8EE', '#B9A88F', night ? 0.12 : 0.55 + 0.6 * dusk]} />
      {/* 室内补光：墙背光面在漫游时不至于发灰 */}
      <ambientLight color={night ? '#9DB0D8' : '#FFF6EA'} intensity={night ? 0.06 : 0.3 + 0.25 * dusk} />
      <directionalLight
        ref={ref}
        position={s ? s.position : [cx + 7, 14, cz + 5]}
        intensity={night ? 0.05 : (s?.intensity ?? 2.4)}
        color={night ? '#B8C6E8' : (s?.color ?? '#FFF1DD')}
        castShadow={!night}
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

