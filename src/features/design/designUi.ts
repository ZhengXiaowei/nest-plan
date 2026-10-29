import {create} from 'zustand';
import type {Vec2} from '../../model/types';

/** 平面图上的工具：选择摆放 / 测量 / 拆墙 / 砌墙 */
export type DesignTool = 'select' | 'measure' | 'demolish' | 'build';
/** 画布视图：平面 / 3D 环绕 / 第一人称漫游 */
export type DesignView = '2d' | '3d' | 'walk';

/** 平面图图层 */
export interface PlanLayers {
  dims: boolean;
  labels: boolean;
  furniture: boolean;
  grid: boolean;
  bearing: boolean;
}

/** 3D 显示选项 */
export interface SceneOptions {
  /** 剖切墙：墙只显示到 1.2 米，看得清屋里 */
  cut: boolean;
  furniture: boolean;
  labels: boolean;
  night: boolean;
  /** 太阳时间，7 到 18 点 */
  hour: number;
}

export type CameraPreset = 'iso' | 'top';

interface DesignUi {
  tool: DesignTool;
  view: DesignView;
  layers: PlanLayers;
  /** 拖家具时贴墙吸附 */
  wallSnap: boolean;
  scene: SceneOptions;
  /** 3D 视角请求：预设视角或飞到某个房间，n 每次加一保证重复点击也生效 */
  camera: {target: CameraPreset | {room: string}; n: number} | null;
  setTool: (t: DesignTool) => void;
  setView: (v: DesignView) => void;
  toggleLayer: (k: keyof PlanLayers) => void;
  setWallSnap: (on: boolean) => void;
  setScene: (change: Partial<SceneOptions>) => void;
  aim: (target: CameraPreset | {room: string}) => void;
}

export const useDesignUi = create<DesignUi>()((set) => ({
  tool: 'select',
  view: '2d',
  layers: {dims: true, labels: true, furniture: true, grid: true, bearing: false},
  wallSnap: true,
  scene: {cut: false, furniture: true, labels: true, night: false, hour: 10},
  camera: null,
  setTool: (tool) => set({tool}),
  // 离开平面图时回到选择工具，免得回来还停在拆墙模式
  setView: (view) => set(view === '2d' ? {view} : {view, tool: 'select'}),
  toggleLayer: (k) => set((s) => ({layers: {...s.layers, [k]: !s.layers[k]}})),
  setWallSnap: (wallSnap) => set({wallSnap}),
  setScene: (change) => set((s) => ({scene: {...s.scene, ...change}})),
  aim: (target) => set((s) => ({camera: {target, n: (s.camera?.n ?? 0) + 1}})),
}));

/** 平面图画布对外的操作，画布挂载后填上 */
export const planView: {
  fit: () => void;
  zoom: (k: number) => void;
  /** 按图纸比例显示，例如 100 表示 1:100 */
  scale: (ratio: number) => void;
  /** 屏幕坐标转平面坐标；不在画布上返回 null */
  toPlan: (clientX: number, clientY: number) => Vec2 | null;
  svg: () => SVGSVGElement | null;
} = {fit: () => {}, zoom: () => {}, scale: () => {}, toPlan: () => null, svg: () => null};

export const TOOL_HINTS: Record<DesignTool, string> = {
  select: '拖动家具摆放，靠近墙面会自动贴上（按住 Alt 不贴）· 拖右下角改尺寸 · R 旋转 · 方向键微调 · ⌘D 复制',
  measure: '点两下或按住拖出测量线 · 靠近墙面自动吸附 · Shift 锁水平/垂直 · Esc 取消',
  demolish: '点灰色非承重墙标记拆除，再点一次恢复 · 黑色承重墙和外墙不能拆 · 点新砌的墙会删掉它',
  build: '依次点击砌一段新墙 · 会吸附到已有墙 · 双击或 Esc 结束 · Shift 自由角度',
};
