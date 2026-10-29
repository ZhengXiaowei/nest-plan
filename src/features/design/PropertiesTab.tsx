import {lazy, Suspense} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {MATERIALS, MATERIAL_IDS, priceOf} from '../../model/materials';
import {roomArea} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
import {canDemolish, wallLength} from '../../model/walls';
import type {WallKind} from '../../model/types';

const WALL_KIND_NAME: Record<WallKind, string> = {bearing: '承重墙', exterior: '外墙', partition: '非承重墙', low: '矮墙'};
const mm = (v: number) => `${Math.round(v).toLocaleString('zh-CN')} mm`;
import {IconTrash} from '../../lib/icons';

// 编辑表单选中东西后才需要，单独拆包
const FurnitureEditor = lazy(() => import('./Editors').then((m) => ({default: m.FurnitureEditor})));
const RoomEditor = lazy(() => import('./Editors').then((m) => ({default: m.RoomEditor})));
// AI 布置带着提示词和摆放计算，选中房间才加载
const AutoLayout = lazy(() => import('./AutoLayout'));
const loading = <div className="np-loading" style={{height: 120}}>加载中…</div>;

const SHORTCUTS: [string, string][] = [
  ['V / M / X / B', '选择 / 测量 / 拆墙 / 砌墙'],
  ['R', '旋转 90°（Shift 反向）'],
  ['方向键', '微调 10mm（Shift 100mm）'],
  ['⌘/Ctrl D', '复制'],
  ['Delete', '删除'],
  ['⌘/Ctrl Z', '撤销（加 Shift 重做）'],
  ['T', '切换平面 / 3D'],
  ['F', '适应窗口'],
  ['Shift F', '全屏'],
  ['Esc', '取消选择'],
];

export function PropertiesTab() {
  const selection = usePlanStore((s) => s.selection);
  const plan = usePlanStore((s) => s.plan);

  if (selection?.kind === 'furniture') {
    const f = plan.furniture.find((x) => x.id === selection.id);
    if (!f) return null;
    return (
      <>
        <Heading level={3}>{f.name}</Heading>
        <Suspense fallback={loading}>
          <FurnitureEditor f={f} />
        </Suspense>
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
          <dd>
            {MATERIALS[room.material].name} · ¥{priceOf(plan, room.material)}/㎡
          </dd>
        </dl>
        <Suspense fallback={loading}>
          {/* 换房间时重建，上一个房间的需求和结果不会带过来 */}
          <AutoLayout key={room.id} room={room} />
        </Suspense>
        <Suspense fallback={loading}>
          <RoomEditor room={room} />
        </Suspense>
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
    <>
      <p className="np-hint">
        点家具改尺寸、颜色、位置；点房间换地面材质和单价；点墙看能不能拆。上方工具条可以测量、拆墙、砌新墙，切到「漫游」用第一人称在屋里走。
      </p>
      <div>
        <h3 className="np-panel-title">快捷键</h3>
        <dl className="np-kbd">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
