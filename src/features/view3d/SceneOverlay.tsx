/**
 * 3D 环绕视角上的浮层：左边房间列表点了飞过去，左下角日照时间。
 * 跟着 3D 一起按需加载。
 */
import {roomArea} from '../../model/geometry';
import type {Plan} from '../../model/types';
import {useDesignUi} from '../design/designUi';
import {SunTime} from '../sun/SunTime';

export function SceneOverlay({plan}: {plan: Plan}) {
  const ui = useDesignUi.getState();
  const rooms = plan.rooms.filter((r) => r.counted !== false);
  const total = rooms.reduce((a, r) => a + roomArea(r), 0);
  return (
    <>
      <nav className="v3-rooms" aria-label="飞到房间">
        <button type="button" onClick={() => ui.aim('iso')}>
          <span>全屋</span>
          <small>{total.toFixed(1)} ㎡</small>
        </button>
        {rooms.map((r) => (
          <button key={r.id} type="button" onClick={() => ui.aim({room: r.id})}>
            <span>{r.name}</span>
            <small>{roomArea(r).toFixed(1)} ㎡</small>
          </button>
        ))}
      </nav>
      <div className="v3-sun">
        <SunTime width={180} />
      </div>
    </>
  );
}
