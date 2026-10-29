import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {Heading} from '@astryxdesign/core/Heading';
import {MATERIALS, MATERIAL_IDS} from '../../model/materials';
import {roomArea} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
import {canDemolish, wallLength} from '../../model/walls';
import type {WallKind} from '../../model/types';

const WALL_KIND_NAME: Record<WallKind, string> = {bearing: '承重墙', exterior: '外墙', partition: '非承重墙', low: '矮墙'};
const mm = (v: number) => `${Math.round(v).toLocaleString('zh-CN')} mm`;
import {IconRotate, IconTrash} from '../../lib/icons';

export function PropertiesTab() {
  const selection = usePlanStore((s) => s.selection);
  const plan = usePlanStore((s) => s.plan);

  if (selection?.kind === 'furniture') {
    const f = plan.furniture.find((x) => x.id === selection.id);
    if (!f) return null;
    const store = usePlanStore.getState();
    return (
      <>
        <Heading level={3}>{f.name}</Heading>
        <dl className="np-kv">
          <dt>尺寸</dt>
          <dd>{f.w} × {f.d} mm</dd>
          <dt>位置</dt>
          <dd>x {Math.round(f.cx)} · y {Math.round(f.cy)}</dd>
          <dt>朝向</dt>
          <dd>{Math.round(f.rot)}°</dd>
        </dl>
        <HStack gap={2}>
          <Button label="旋转 90°" icon={<IconRotate />} variant="secondary" size="sm" onClick={() => store.rotateFurniture(f.id, 90)} />
          <Button label="删除" icon={<IconTrash />} variant="ghost" size="sm" onClick={() => store.removeSelected()} />
        </HStack>
      </>
    );
  }

  if (selection?.kind === 'room') {
    const room = plan.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    const area = roomArea(room);
    return (
      <>
        <Heading level={3}>{room.name}</Heading>
        <dl className="np-kv">
          <dt>面积</dt>
          <dd>{area.toFixed(2)} ㎡</dd>
          <dt>地面</dt>
          <dd>{MATERIALS[room.material].name} · ¥{MATERIALS[room.material].price}/㎡</dd>
        </dl>
        <div>
          <h3 className="np-panel-title">换地面材质</h3>
          <div className="np-swatches">
            {MATERIAL_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="np-swatch-btn"
                aria-pressed={room.material === id}
                onClick={() => usePlanStore.getState().setRoomMaterial(room.id, id)}
              >
                <i style={{background: MATERIALS[id].swatch}} />
                {MATERIALS[id].name}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (selection?.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === selection.id);
    if (!w) return null;
    const store = usePlanStore.getState();
    const demolished = plan.demolished.includes(w.id);
    const state = w.added ? '改造新砌' : demolished ? '改造时拆除' : '原有';
    return (
      <>
        <Heading level={3}>{w.added ? '新砌墙' : WALL_KIND_NAME[w.kind]}</Heading>
        <dl className="np-kv">
          <dt>长度</dt>
          <dd>{mm(wallLength(w))}</dd>
          <dt>厚度</dt>
          <dd>{mm(w.thickness)}</dd>
          <dt>状态</dt>
          <dd>{state}</dd>
        </dl>
        {w.added ? (
          <Button label="删掉这段墙" icon={<IconTrash />} variant="ghost" size="sm" onClick={() => store.toggleDemolish(w.id)} />
        ) : canDemolish(w) ? (
          <Button label={demolished ? '恢复这段墙' : '拆掉这段墙'} variant="secondary" size="sm" onClick={() => store.toggleDemolish(w.id)} />
        ) : (
          <p className="np-hint">{w.kind === 'bearing' ? '承重墙不能拆。' : '外墙属于建筑外围护结构，不建议拆。'}</p>
        )}
      </>
    );
  }

  if (selection?.kind === 'measure') {
    const m = plan.measures.find((x) => x.id === selection.id);
    if (!m) return null;
    return (
      <>
        <Heading level={3}>测量线</Heading>
        <dl className="np-kv">
          <dt>长度</dt>
          <dd>{mm(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]))}</dd>
        </dl>
        <Button label="删除" icon={<IconTrash />} variant="ghost" size="sm" onClick={() => usePlanStore.getState().removeSelected()} />
      </>
    );
  }

  return (
    <p className="np-hint">
      点家具查看尺寸、旋转或删除；点房间换地面材质；点墙看能不能拆。上方工具条可以测量、拆墙、砌新墙，切到「漫游」用第一人称在屋里走。
    </p>
  );
}
