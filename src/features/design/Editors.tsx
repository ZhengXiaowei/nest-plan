/**
 * 属性面板里的编辑表单：家具的尺寸、位置、颜色、层级，房间名称和地面单价。
 * 选中东西后才用得到，单独拆包，不进首屏。
 */
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {TextInput} from '@astryxdesign/core/TextInput';
import {MATERIALS, priceOf} from '../../model/materials';
import {normAngle} from '../../model/geometry';
import type {Furniture, Room} from '../../model/types';
import {usePlanStore} from '../../store/planStore';
import {IconRotate, IconTrash} from '../../lib/icons';

/** NumberInput 自己只在回车或离开输入框时才回调，所以回调里直接写进方案，撤销时一次撤回一整项 */
function Num({label, value, onCommit, min, step = 10, units}: {label: string; value: number; onCommit: (v: number) => void; min?: number; step?: number; units?: string}) {
  return (
    <NumberInput
      label={label}
      size="sm"
      value={value}
      min={min}
      step={step}
      units={units}
      hasClear={false}
      onChange={(v) => {
        if (Number.isFinite(v) && v !== value) onCommit(v);
      }}
    />
  );
}

function Text({label, value, onCommit}: {label: string; value: string; onCommit: (v: string) => void}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  };
  return (
    <TextInput
      label={label}
      size="sm"
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function FurnitureEditor({f}: {f: Furniture}) {
  const store = usePlanStore.getState();
  const set = (change: Partial<Furniture>) => store.updateFurniture(f.id, change);
  return (
    <div className="np-editor">
      <Text label="名称" value={f.name} onCommit={(name) => set({name})} />
      <div className="np-editor-grid">
        <Num label="宽" units="mm" value={f.w} min={50} onCommit={(w) => set({w})} />
        <Num label="深" units="mm" value={f.d} min={50} onCommit={(d) => set({d})} />
        <Num label="中心 X" units="mm" value={Math.round(f.cx)} onCommit={(cx) => set({cx})} />
        <Num label="中心 Y" units="mm" value={Math.round(f.cy)} onCommit={(cy) => set({cy})} />
        <Num label="旋转" units="°" value={Math.round(f.rot)} step={15} onCommit={(rot) => set({rot: normAngle(rot)})} />
        <label className="np-color-field">
          <span>颜色</span>
          <input type="color" value={f.color} onChange={(e) => set({color: e.target.value})} />
        </label>
      </div>
      <HStack gap={2} wrap="wrap">
        <Button label="旋转 90°" icon={<IconRotate />} variant="secondary" size="sm" onClick={() => store.rotateFurniture(f.id, 90)} />
        <Button label="复制" variant="secondary" size="sm" onClick={() => store.duplicateSelected()} />
        <Button label="置于顶层" variant="ghost" size="sm" onClick={() => store.reorderFurniture(f.id, 'top')} />
        <Button label="置于底层" variant="ghost" size="sm" onClick={() => store.reorderFurniture(f.id, 'bottom')} />
        <Button label="删除" icon={<IconTrash />} variant="ghost" size="sm" onClick={() => store.removeSelected()} />
      </HStack>
    </div>
  );
}

export function RoomEditor({room}: {room: Room}) {
  const plan = usePlanStore((s) => s.plan);
  const store = usePlanStore.getState();
  const custom = plan.prices?.[room.material] !== undefined;
  return (
    <div className="np-editor">
      <Text label="名称" value={room.name} onCommit={(name) => store.renameRoom(room.id, name)} />
      <Num
        label={`${MATERIALS[room.material].name}单价`}
        units="元/㎡"
        value={priceOf(plan, room.material)}
        min={0}
        step={10}
        onCommit={(v) => store.setPrice(room.material, v === MATERIALS[room.material].price ? null : v)}
      />
      {custom && (
        <p className="np-hint">
          改过的单价对所有用{MATERIALS[room.material].name}的房间生效。
          <button type="button" className="np-link" onClick={() => store.setPrice(room.material, null)}>
            恢复默认 ¥{MATERIALS[room.material].price}
          </button>
        </p>
      )}
    </div>
  );
}
