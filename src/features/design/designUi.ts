import {create} from 'zustand';

/** 平面图上的工具：选择摆放 / 测量 / 拆墙 / 砌墙 */
export type DesignTool = 'select' | 'measure' | 'demolish' | 'build';
/** 画布视图：平面 / 3D 环绕 / 第一人称漫游 */
export type DesignView = '2d' | '3d' | 'walk';

interface DesignUi {
  tool: DesignTool;
  view: DesignView;
  setTool: (t: DesignTool) => void;
  setView: (v: DesignView) => void;
}

export const useDesignUi = create<DesignUi>()((set) => ({
  tool: 'select',
  view: '2d',
  setTool: (tool) => set({tool}),
  // 离开平面图时回到选择工具，免得回来还停在拆墙模式
  setView: (view) => set(view === '2d' ? {view} : {view, tool: 'select'}),
}));

export const TOOL_HINTS: Record<DesignTool, string> = {
  select: '拖动家具摆放，靠近墙面会自动贴上（按住 Alt 不贴）· R 旋转 · Delete 删除',
  measure: '点两下或按住拖出测量线 · 靠近墙面自动吸附 · Shift 锁水平/垂直 · Esc 取消',
  demolish: '点灰色非承重墙标记拆除，再点一次恢复 · 黑色承重墙和外墙不能拆 · 点新砌的墙会删掉它',
  build: '依次点击砌一段新墙 · 会吸附到已有墙 · 双击或 Esc 结束 · Shift 自由角度',
};
