/**
 * 顶栏「方案」菜单和画布「图层」菜单。第一次点开才加载这个文件，不进首屏。
 */
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuDivider, DropdownMenuItem} from '@astryxdesign/core/DropdownMenu';
import {Button} from '@astryxdesign/core/Button';
import {toast} from '../../lib/toast';
import {usePlanStore} from '../../store/planStore';
import {createSamplePlan} from '../../model/samplePlan';
import {useDesignUi, type PlanLayers} from './designUi';
import type {MenuKind} from './LazyMenu';
import {exportPlanImage, exportPlanFile, pickPlanFile, toggleFullscreen} from './planFiles';

export interface MenuProps {
  kind: MenuKind;
  label: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const LAYER_ITEMS: [keyof PlanLayers, string][] = [
  ['dims', '外圈尺寸'],
  ['labels', '房间名和面积'],
  ['furniture', '家具'],
  ['grid', '网格'],
  ['bearing', '突出承重墙'],
];

function LayersItems() {
  const layers = useDesignUi((s) => s.layers);
  const wallSnap = useDesignUi((s) => s.wallSnap);
  const ui = useDesignUi.getState();
  return (
    <>
      {LAYER_ITEMS.map(([k, label]) => (
        <DropdownMenuCheckboxItem key={k} label={label} value={layers[k]} onChange={() => ui.toggleLayer(k)} hasCloseOnSelect={false} />
      ))}
      <DropdownMenuDivider />
      <DropdownMenuCheckboxItem label="拖家具时贴墙" value={wallSnap} onChange={(on) => ui.setWallSnap(on)} hasCloseOnSelect={false} />
    </>
  );
}

function SceneItems() {
  const scene = useDesignUi((s) => s.scene);
  const walk = useDesignUi((s) => s.view === 'walk');
  const set = useDesignUi.getState().setScene;
  return (
    <>
      <DropdownMenuCheckboxItem label="家具" value={scene.furniture} onChange={(furniture) => set({furniture})} hasCloseOnSelect={false} />
      {!walk && <DropdownMenuCheckboxItem label="房间名" value={scene.labels} onChange={(labels) => set({labels})} hasCloseOnSelect={false} />}
      <DropdownMenuCheckboxItem label="夜景" value={scene.night} onChange={(night) => set({night})} hasCloseOnSelect={false} />
    </>
  );
}

function PlanItems() {
  const run = (fn: () => Promise<unknown>, fail: string) => () => void fn().catch((e: Error) => toast(e.message || fail, 'error', 4000));
  return (
    <>
      <DropdownMenuItem label="导出平面图图片" description="PNG，带尺寸和房间名" onClick={run(exportPlanImage, '导出图片失败')} />
      <DropdownMenuItem label="导出方案文件" description="JSON，可以在别的设备导入" onClick={run(exportPlanFile, '导出失败')} />
      <DropdownMenuItem
        label="导入方案文件"
        description="栖图方案，或原版 floorplan-3d 导出的布置"
        onClick={run(async () => {
          const plan = await pickPlanFile();
          if (!plan) return;
          usePlanStore.getState().replacePlan(plan);
          toast('方案已导入，可撤销');
        }, '文件格式不对')}
      />
      <DropdownMenuDivider />
      <DropdownMenuItem label="全屏" description="Shift F" onClick={toggleFullscreen} />
      <DropdownMenuDivider />
      <DropdownMenuItem
        label="重置为示例方案"
        variant="destructive"
        onClick={() => {
          usePlanStore.getState().replacePlan(createSamplePlan());
          toast('已重置为示例方案，可撤销');
        }}
      />
    </>
  );
}

export default function Menu({kind, label, icon, isOpen, onOpenChange}: MenuProps) {
  return (
    <DropdownMenu
      isMenuOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="below"
      alignment="end"
      menuWidth={kind === 'plan' ? 260 : 200}
      renderTrigger={(props) => <Button {...props} label={label} icon={icon} variant="ghost" size="sm" />}
    >
      {kind === 'layers' ? <LayersItems /> : kind === 'scene' ? <SceneItems /> : <PlanItems />}
    </DropdownMenu>
  );
}
