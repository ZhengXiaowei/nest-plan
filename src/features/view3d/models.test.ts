import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {Furniture} from '../../model/types';
import {CATALOG} from '../../model/catalog';
import {furnitureObject} from './models';

const items = CATALOG.flatMap((g) => g.items);

const make = (type: string, w: number, d: number, color: string, rot = 0, cx = 0, cy = 0): Furniture => ({
  id: `${type}-${w}`,
  type,
  name: type,
  cx,
  cy,
  w,
  d,
  rot,
  color,
});

// 去掉平移后的包围盒尺寸（米）
function extents(f: Furniture) {
  const g = furnitureObject(f);
  g.position.set(0, 0, 0);
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
}

// 原版里有意超出占地的造型：绿植叶冠外伸、梳妆台前带凳子
const OVERHANG = new Set(['plant', 'dresser']);
const near = (got: number, want: number) => Math.abs(got - want) <= Math.max(want * 0.15, 0.04);

describe('furnitureObject', () => {
  it.each(items.map((i) => [i.type, i.name, i] as const))('%s（%s）生成非空模型且尺寸接近 w×d', (_t, _n, item) => {
    const f = make(item.type, item.w, item.d, item.color);
    const g = furnitureObject(f);
    let meshes = 0;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(0);
    expect(g.userData.fid).toBe(f.id);
    const s = extents(f);
    expect(s.y).toBeGreaterThan(0);
    if (OVERHANG.has(item.type)) {
      expect(s.x).toBeGreaterThanOrEqual(item.w * 0.001 * 0.85);
      expect(s.z).toBeGreaterThanOrEqual(item.d * 0.001 * 0.85);
    } else {
      expect(near(s.x, item.w * 0.001), `x ${s.x} vs ${item.w}`).toBe(true);
      expect(near(s.z, item.d * 0.001), `z ${s.z} vs ${item.d}`).toBe(true);
    }
  });

  it('旋转 90° 时 x / z 尺寸互换', () => {
    for (const item of items) {
      const a = extents(make(item.type, item.w, item.d, item.color, 0));
      const b = extents(make(item.type, item.w, item.d, item.color, 90));
      expect(b.x).toBeCloseTo(a.z, 3);
      expect(b.z).toBeCloseTo(a.x, 3);
    }
  });

  it('位置为 cx、cy 换算成米，旋转为 -rot', () => {
    const g = furnitureObject(make('sofa', 2400, 900, '#B7C4B0', 30, 3200, -1500));
    expect(g.position.x).toBeCloseTo(3.2, 6);
    expect(g.position.y).toBe(0);
    expect(g.position.z).toBeCloseTo(-1.5, 6);
    expect(g.rotation.y).toBeCloseTo((-30 * Math.PI) / 180, 6);
  });

  it('正面朝平面局部 +y：沙发靠背在 -z 侧，旋转 90° 后在 +x 侧', () => {
    // 沙发靠背在局部 -z（平面局部 -y）；顺时针转 90° 后平面局部 -y 指向 +x
    const back = (rot: number) => {
      const g = furnitureObject(make('sofa', 2000, 900, '#B7C4B0', rot));
      g.position.set(0, 0, 0);
      g.updateMatrixWorld(true);
      // 取高于 0.75m 的部分（只有靠背），看它的中心
      const box = new THREE.Box3();
      const v = new THREE.Box3();
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        v.setFromObject(m);
        if (v.max.y > 0.8) box.union(v);
      });
      return box.getCenter(new THREE.Vector3());
    };
    expect(back(0).z).toBeLessThan(-0.1);
    expect(back(90).x).toBeGreaterThan(0.1);
  });

  it('未知类型回退为圆角盒子', () => {
    const s = extents(make('mystery', 1000, 500, '#888888'));
    expect(s.x).toBeCloseTo(1, 3);
    expect(s.z).toBeCloseTo(0.5, 3);
    expect(s.y).toBeCloseTo(0.6, 3);
  });

  it('相同参数复用几何体与材质', () => {
    const a = furnitureObject(make('chair', 450, 480, '#CFC6B8'));
    const b = furnitureObject(make('chair', 450, 480, '#CFC6B8'));
    const ma = a.children[0] as THREE.Mesh;
    const mb = b.children[0] as THREE.Mesh;
    expect(ma.geometry).toBe(mb.geometry);
    expect(ma.material).toBe(mb.material);
  });
});
