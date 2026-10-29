import {floorBudget} from '../../model/geometry';
import {MATERIALS} from '../../model/materials';
import {usePlanStore} from '../../store/planStore';
import {renovationStats} from '../../model/walls';
import {Button} from '@astryxdesign/core/Button';

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
              <button type="button" onClick={() => usePlanStore.getState().select({kind: 'room', id: l.roomId})}>
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
      <p className="np-hint">面积按房间内轮廓计算，飘窗不计入。单价是粗估，可在材质里调整。</p>
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
      {plan.measures.length > 0 && (
        <Button label={`清除测量线（${plan.measures.length}）`} variant="ghost" size="sm" onClick={() => usePlanStore.getState().clearMeasures()} />
      )}
    </>
  );
}
