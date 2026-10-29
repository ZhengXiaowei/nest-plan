import {useState} from 'react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CATALOG, type CatalogItem} from '../../model/catalog';
import {planBounds, polygonCentroid} from '../../model/geometry';
import {usePlanStore} from '../../store/planStore';
import {uid} from '../../lib/id';

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

export function LibraryPanel() {
  const [q, setQ] = useState('');
  const add = (item: CatalogItem) => {
    const [cx, cy] = placeAt();
    usePlanStore.getState().addFurniture({id: uid('f'), type: item.type, name: item.name.replace(/\s.*$/, ''), cx, cy, w: item.w, d: item.d, rot: 0, color: item.color});
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
              <button key={`${item.type}-${item.name}`} type="button" className="np-lib-item" onClick={() => add(item)} title={`添加${item.name}`}>
                <i className="np-lib-swatch" style={{background: item.color}} />
                {item.name}
                <span>{item.w}×{item.d}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="np-hint" style={{marginTop: 16}}>点一下添加到选中的房间。画布上拖动摆放，按 R 旋转 90°，Delete 删除。</p>
    </div>
  );
}
