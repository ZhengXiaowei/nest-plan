import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {Heading} from '@astryxdesign/core/Heading';
import {MATERIALS, MATERIAL_IDS} from '../../model/materials';
import {roomArea} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
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

  return (
    <p className="np-hint">
      点画布上的家具查看尺寸、旋转或删除；点房间可以换地面材质。滚轮缩放，拖动空白处平移。
    </p>
  );
}
