import {useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CATALOG, type CatalogItem} from '../../model/catalog';
import {planBounds, polygonCentroid} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
import {uid} from '../../lib/id';
import {planView} from './designUi';

/** 新家具放在选中房间中央，没选房间就放在户型中央 */
function placeAt(): [number, number] {
  const {plan, selection} = usePlanStore.getState();
  if (selection?.kind === 'room') {
    const room = plan.rooms.find((r) => r.id === selection.id);
    if (room) return polygonCentroid(room.poly) as [number, number];
  }
  const b = planBounds(plan);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** 跟着指针走的家具卡片 */
type Ghost = {item: CatalogItem; x: number; y: number; over: boolean};

export function LibraryPanel() {
  const [q, setQ] = useState('');
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const drag = useRef<{item: CatalogItem; x: number; y: number; active: boolean} | null>(null);
  const add = (item: CatalogItem, at?: readonly [number, number]) => {
    const [cx, cy] = at ?? placeAt();
    usePlanStore.getState().addFurniture({id: uid('f'), type: item.type, name: item.name.replace(/\s.*$/, ''), cx, cy, w: item.w, d: item.d, rot: 0, color: item.color});
  };

  // 按住拖到平面图上放下；只是点一下就放到房间中央
  const onDown = (item: CatalogItem) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    drag.current = {item, x: e.clientX, y: e.clientY, active: false};
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // 触屏上竖着划是在滚动列表，往右拖才算拖家具
      if (Math.hypot(dx, dy) < 8 || (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx))) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setGhost({item: d.item, x: e.clientX, y: e.clientY, over: !!planView.toPlan(e.clientX, e.clientY)});
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    if (!d.active) return add(d.item);
    const at = planView.toPlan(e.clientX, e.clientY);
    if (at) add(d.item, at);
  };
  const groups = CATALOG.map((g) => ({...g, items: g.items.filter((i) => !q || i.name.includes(q))})).filter((g) => g.items.length);

  return (
    <div className="np-panel-section">
      <TextInput label="搜索家具" isLabelHidden placeholder="搜索家具" value={q} onChange={setQ} hasClear size="sm" />
      {groups.map((g) => (
        <section key={g.category}>
          <h3 className="np-panel-title" style={{marginTop: 16}}>{g.category}</h3>
          <div className="np-lib-grid">
            {g.items.map((item) => (
              <button
                key={`${item.type}-${item.name}`}
                type="button"
                className="np-lib-item"
                aria-label={`添加${item.name}`}
                title={`添加${item.name}，也可以拖到平面图上`}
                onPointerDown={onDown(item)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => {
                  drag.current = null;
                  setGhost(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    add(item);
                  }
                }}
              >
                <i className="np-lib-swatch" style={{background: item.color}} />
                {item.name}
                <span>{item.w}×{item.d}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="np-hint" style={{marginTop: 16}}>点一下放到选中的房间，或者直接拖到平面图上。画布上拖动摆放，按 R 旋转 90°，Delete 删除。</p>
      {ghost && (
        <div className={ghost.over ? 'np-lib-ghost is-over' : 'np-lib-ghost'} style={{transform: `translate(${ghost.x}px, ${ghost.y}px)`}} aria-hidden>
          <i className="np-lib-swatch" style={{background: ghost.item.color}} />
          {ghost.item.name}
        </div>
      )}
    </div>
  );
}
