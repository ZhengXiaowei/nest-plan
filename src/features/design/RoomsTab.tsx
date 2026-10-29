import {floorBudget} from '../../model/geometry';
import {MATERIALS} from '../../model/materials';
import {useDesignUi} from './designUi';
import {usePlanStore} from '../../store/planStore';
import {renovationStats} from '../../model/walls';
import {Button} from '@astryxdesign/core/Button';
import {toast} from '../../lib/toast';

const yuan = (v: number) => `¥${Math.round(v).toLocaleString('zh-CN')}`;

export function RoomsTab() {
  const plan = usePlanStore((s) => s.plan);
  const budget = floorBudget(plan);
  const reno = renovationStats(plan);
  return (
    <>
      <div>
        <h3 className="np-panel-title">地面预算（含 5% 损耗）</h3>
        {budget.lines.map((l) => {
          const room = plan.rooms.find((r) => r.id === l.roomId)!;
          return (
            <div key={l.roomId} className="np-room-row">
              <button
                type="button"
                onClick={() => {
                  usePlanStore.getState().select({kind: 'room', id: l.roomId});
                  // 在 3D 里就飞过去看
                  if (useDesignUi.getState().view === '3d') useDesignUi.getState().aim({room: l.roomId});
                }}
              >
                {l.name} · {MATERIALS[room.material].name}
              </button>
              <span>
                {l.area.toFixed(1)} ㎡ · {yuan(l.cost)}
              </span>
            </div>
          );
        })}
        <div className="np-total">
          <span>合计 {budget.area.toFixed(1)} ㎡</span>
          <b>{yuan(budget.total)}</b>
        </div>
      </div>
      <p className="np-hint">面积按房间内轮廓计算，飘窗不计入。单价是粗估，点房间可以改。</p>
      <div>
        <h3 className="np-panel-title">方案统计</h3>
        <div className="np-room-row">
          <span>家具</span>
          <span>{plan.furniture.length} 件</span>
        </div>
        <div className="np-room-row">
          <span>测量线</span>
          <span>{plan.measures.length} 条</span>
        </div>
      </div>
      <div>
        <h3 className="np-panel-title">墙体改造</h3>
        <div className="np-room-row">
          <span>拆除</span>
          <span>{reno.demolishedM.toFixed(1)} m</span>
        </div>
        <div className="np-room-row">
          <span>新砌</span>
          <span>{reno.addedM.toFixed(1)} m</span>
        </div>
      </div>
      <div className="np-row-actions">
        <Button label="清除测量线" variant="ghost" size="sm" isDisabled={!plan.measures.length} onClick={() => usePlanStore.getState().clearMeasures()} />
        <Button
          label="清空布置"
          variant="ghost"
          size="sm"
          isDisabled={!plan.furniture.length}
          onClick={() => {
            usePlanStore.getState().clearFurniture();
            toast('已清空所有家具，可撤销');
          }}
        />
      </div>
    </>
  );
}
