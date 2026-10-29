/**
 * 3D 环绕视角上的浮层：左边房间列表点了飞过去，左下角日照时间。
 * 跟着 3D 一起按需加载。
 */
import {Slider} from '@astryxdesign/core/Slider';
import {roomArea} from '../../model/geometry';
import type {Plan} from '../../model/types';
import {useDesignUi} from '../design/designUi';

const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export function SceneOverlay({plan}: {plan: Plan}) {
  const hour = useDesignUi((s) => s.scene.hour);
  const night = useDesignUi((s) => s.scene.night);
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
        <Slider
          label="日照"
          value={hour}
          min={7}
          max={18}
          step={0.25}
          isDisabled={night}
          disabledMessage="夜景下没有太阳"
          formatValue={clock}
          valueDisplay="text"
          width={200}
          onChange={(h: number) => ui.setScene({hour: h})}
        />
      </div>
    </>
  );
}
