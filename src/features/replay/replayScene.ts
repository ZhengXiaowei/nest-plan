import * as THREE from 'three';
import type {Opening, Plan, Vec2, Wall} from '../../model/types';
import {planBounds, polygonCentroid} from '../../model/geometry';
import {distToSegment, wallPieces, withCorners} from '../../model/walls';
import {floorMaterial, furnitureObject} from '../view3d/models';
import {WALL_COLOR} from '../view3d/scene';
import {doorsOf} from '../view3d/walk';
import {easeInOut, progress, type Timeline} from './timeline';

/**
 * 回放场景：一次性用 three.js 搭好全部物体（含拆掉的墙和新砌的墙），
 * 每帧按时间线 t 改变可见性、高度、颜色和位置。不走 React 渲染，播放和逐帧导出都便宜。
 */

const M = 0.001;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const CONCRETE = new THREE.Color('#BDB7AE');
const DEMOLISH_RED = new THREE.Color('#E5484D');
const NEW_WALL = new THREE.Color('#BFCBF6');
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;

function std(color: string | THREE.Color, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({color, roughness, metalness: 0, ...extra});
}

/** 沿线段的盒子，y0..y1 为底高和顶高（mm） */
function segMesh(a: Vec2, b: Vec2, t: number, y0: number, y1: number, material: THREE.Material): THREE.Mesh | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= 0 || y1 <= y0) return null;
  const m = new THREE.Mesh(unitBox, material);
  m.position.set(((a[0] + b[0]) / 2) * M, ((y0 + y1) / 2) * M, ((a[1] + b[1]) / 2) * M);
  m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  m.scale.set(len * M, (y1 - y0) * M, t * M);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const onWall = (w: Wall, o: Opening) => distToSegment([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], w.a, w.b) <= w.thickness / 2 + 30;

export interface ReplayScene {
  root: THREE.Group;
  /** 把场景摆到 t 秒时的样子 */
  apply(t: number): void;
  dispose(): void;
}

export function buildReplayScene(plan: Plan, tl: Timeline): ReplayScene {
  const root = new THREE.Group();
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T) => (owned.push(m), m);

  // 毛坯地面：水泥找平
  const b = planBounds(plan);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((b.maxX - b.minX) * M + 1, (b.maxY - b.minY) * M + 1), own(std('#CFCAC2', 0.95)));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(((b.minX + b.maxX) / 2) * M, -0.004, ((b.minY + b.maxY) / 2) * M);
  ground.receiveShadow = true;
  root.add(ground);

  // 墙面材质：按墙种类各一份，刷墙时从水泥灰变成乳胶漆
  const paintMats = new Map<Wall['kind'], {m: THREE.MeshStandardMaterial; to: THREE.Color}>();
  const paintMat = (kind: Wall['kind']) => {
    let p = paintMats.get(kind);
    if (!p) {
      p = {m: own(std(CONCRETE.clone())), to: new THREE.Color(WALL_COLOR[kind])};
      paintMats.set(kind, p);
    }
    return p.m;
  };
  const capMat = own(std('#34312D', 0.9));
  const skirtMat = own(std('#CFC6B8', 0.6));
  const glassMat = own(std('#BFD3F2', 0.1, {transparent: true, opacity: 0.35}));
  const frameMat = own(std('#2747D6', 0.6));
  const leafMat = own(std('#D9CBB4', 0.6));

  interface WallAnim {
    w: Wall;
    group: THREE.Group;
    body: THREE.MeshStandardMaterial;
    skirts: THREE.Object3D[];
    leaves: THREE.Object3D[];
  }
  const walls: WallAnim[] = [];
  const corners = withCorners(plan.walls);
  const doors = doorsOf(plan.openings);
  plan.walls.forEach((w0, i) => {
    const w = corners[i]!;
    const openings = plan.openings.filter((o) => onWall(w0, o));
    const own1 = plan.demolished.includes(w0.id) || w0.added;
    // 要拆的墙和新砌的墙各用自己的材质，好单独变色
    const body = own1 ? own(std(CONCRETE.clone())) : paintMat(w0.kind);
    const group = new THREE.Group();
    const top = w0.height ?? (w0.kind === 'low' ? 1000 : plan.wallHeight);
    const skirts: THREE.Object3D[] = [];
    for (const [a, bb] of wallPieces(w, openings)) {
      const parts = [segMesh(a, bb, w.thickness, 0, top, body), segMesh(a, bb, w.thickness + 2, top, top + 12, capMat)];
      const sk = segMesh(a, bb, w.thickness + 16, 0, 80, skirtMat);
      if (sk) skirts.push(sk);
      for (const m of [...parts, sk]) if (m) group.add(m);
    }
    const leaves: THREE.Object3D[] = [];
    for (const o of openings) {
      const head = o.head ?? 2100;
      const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
      const ms = [
        sill > 0 ? segMesh(o.a, o.b, o.thickness, 0, sill, body) : null,
        segMesh(o.a, o.b, o.thickness, head, plan.wallHeight, body),
        o.kind === 'window' ? segMesh(o.a, o.b, 20, sill, head, glassMat) : null,
        o.kind === 'slidingDoor' ? segMesh(o.a, o.b, 30, 0, head, glassMat) : null,
        o.isEntry ? segMesh(o.a, o.b, o.thickness + 20, head, head + 40, frameMat) : null,
      ];
      for (const m of ms) if (m) group.add(m);
      // 门扇开着，刷完墙再装
      const d = doors.find((x) => x.id === o.id);
      if (d) {
        const pivot = new THREE.Group();
        pivot.position.set(d.hinge[0], 0, d.hinge[1]);
        pivot.rotation.y = d.open;
        const leaf = new THREE.Mesh(unitBox, leafMat);
        leaf.position.set(d.leaf / 2, d.head / 2, 0);
        leaf.scale.set(d.leaf - 0.01, d.head - 0.01, 0.04);
        leaf.castShadow = true;
        pivot.add(leaf);
        group.add(pivot);
        leaves.push(pivot);
      }
    }
    root.add(group);
    walls.push({w: w0, group, body, skirts, leaves});
  });

  // 地面：每个房间一块，从房间中心铺开
  const floors = plan.rooms.map((r) => {
    const c = polygonCentroid(r.poly);
    const shape = new THREE.Shape();
    r.poly.forEach(([x, y], i) => (i === 0 ? shape.moveTo((x - c[0]) * M, -(y - c[1]) * M) : shape.lineTo((x - c[0]) * M, -(y - c[1]) * M)));
    shape.closePath();
    const m = own(floorMaterial(r.material).clone());
    m.transparent = true;
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.position.set(c[0] * M, 0.002, c[1] * M);
    g.add(mesh);
    // 贴图 UV 按米算，挪了原点要补回来，花纹才和 3D 视图对得上
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute | undefined;
    if (uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + c[0] * M, uv.getY(i) - c[1] * M);
      uv.needsUpdate = true;
    }
    root.add(g);
    return {id: r.id, g, m};
  });

  // 家具
  const furniture = plan.furniture.map((f) => {
    const obj = furnitureObject(f);
    root.add(obj);
    return {id: f.id, obj, y: obj.position.y, s: obj.scale.clone()};
  });

  const tmp = new THREE.Color();
  function apply(t: number) {
    const paint = easeInOut(progress(tl.paint, t));
    for (const {m, to} of paintMats.values()) m.color.copy(CONCRETE).lerp(to, paint);
    for (const wa of walls) {
      const dem = tl.demolish.get(wa.w.id);
      const bld = tl.build.get(wa.w.id);
      let h = 1;
      if (dem) {
        const p = progress(dem, t);
        // 先闪红，再沉下去
        const flash = Math.min(1, p / 0.25);
        tmp.copy(CONCRETE).lerp(DEMOLISH_RED, Math.sin(flash * Math.PI) * 0.85);
        wa.body.color.copy(tmp);
        h = p <= 0.25 ? 1 : 1 - easeIn((p - 0.25) / 0.75);
      } else if (bld) {
        const p = progress(bld, t);
        h = easeOut(p);
        wa.body.color.copy(NEW_WALL).lerp(new THREE.Color(WALL_COLOR[wa.w.kind]), paint);
      } else if (wa.w.added) {
        wa.body.color.copy(NEW_WALL).lerp(new THREE.Color(WALL_COLOR[wa.w.kind]), paint);
      }
      wa.group.visible = h > 0.001;
      wa.group.scale.y = Math.max(0.001, h);
      for (const s of wa.skirts) s.visible = paint > 0.5;
      for (const l of wa.leaves) l.visible = paint >= 1;
    }
    for (const f of floors) {
      const p = progress(tl.floors.get(f.id), t);
      f.g.visible = p > 0;
      f.m.opacity = easeOut(p);
      f.m.transparent = p < 1;
      const s = 0.6 + 0.4 * easeOut(p);
      f.g.scale.set(s, 1, s);
    }
    for (const f of furniture) {
      const p = progress(tl.furniture.get(f.id), t);
      f.obj.visible = p > 0;
      const k = easeOut(p);
      f.obj.position.y = f.y + (1 - k) * 0.7;
      f.obj.scale.copy(f.s).multiplyScalar(0.9 + 0.1 * k);
    }
  }

  return {
    root,
    apply,
    dispose() {
      for (const m of owned) m.dispose();
      for (const f of floors) (f.g.children[0] as THREE.Mesh).geometry.dispose();
      ground.geometry.dispose();
    },
  };
}
