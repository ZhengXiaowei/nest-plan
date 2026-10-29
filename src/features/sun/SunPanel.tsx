import {useRef} from 'react';
import {Selector} from '@astryxdesign/core/Selector';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {CITIES, compassName, dayLabel, siteOf} from '../../model/sun';
import {sunGrade} from '../../model/sunlight';
import {usePlanStore} from '../../store/planStore';
import {useDesignUi, type SunView} from '../design/designUi';
import {SunTime} from './SunTime';
import {useSunResult} from './useSun';
import './sun.css';

/** 图纸上方朝向：拖动指针转到正北 */
function CompassDial() {
  const site = usePlanStore((s) => siteOf(s.plan));
  const ref = useRef<SVGSVGElement>(null);
  const setFromEvent = (e: React.PointerEvent, live: boolean) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(x, -y) * 180) / Math.PI;
    if (!e.shiftKey) deg = Math.round(deg / 5) * 5;
    deg = ((deg % 360) + 360) % 360;
    usePlanStore.getState().setSite({...site, north: deg}, live);
  };
  return (
    <svg
      ref={ref}
      className="sun-dial"
      viewBox="-50 -50 100 100"
      role="slider"
      aria-label="指北针"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(site.north)}
      aria-valuetext={`正北在图纸上方顺时针 ${Math.round(site.north)} 度`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') usePlanStore.getState().setSite({...site, north: (site.north + step) % 360});
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') usePlanStore.getState().setSite({...site, north: (site.north - step + 360) % 360});
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        usePlanStore.getState().checkpoint();
        setFromEvent(e, true);
      }}
      onPointerMove={(e) => {
        if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) setFromEvent(e, true);
      }}
    >
      <circle r={46} className="sun-dial-ring" />
      {Array.from({length: 12}, (_, i) => (
        <line key={i} x1={0} y1={-46} x2={0} y2={i % 3 ? -42 : -38} transform={`rotate(${i * 30})`} className="sun-dial-tick" />
      ))}
      {/* 户型：图纸上方是房子的上方 */}
      <rect x={-13} y={-13} width={26} height={26} rx={3} className="sun-dial-house" />
      <path d="M-13 -13 L0 -22 L13 -13" className="sun-dial-roof" />
      <g transform={`rotate(${site.north})`} className="sun-dial-needle">
        <path d="M0 -40 L6 -26 L-6 -26 Z" />
        <text y={-31} dy={-12}>北</text>
      </g>
    </svg>
  );
}

const CITY_OPTIONS = CITIES.map(([name]) => name);

export default function SunPanel() {
  const site = usePlanStore((s) => siteOf(s.plan));
  const custom = usePlanStore((s) => !s.plan.site);
  const day = useDesignUi((s) => s.sunDay);
  const view = useDesignUi((s) => s.sunView);
  const {result, busy} = useSunResult();
  const set = (change: Partial<typeof site>) => usePlanStore.getState().setSite({...site, ...change});
  const southFacing = compassName((180 - site.north + 360) % 360);

  return (
    <div className="sun-panel">
      <p className="np-hint">
        按你家的城市和朝向，模拟太阳一天怎么照进屋里。平面图上看光斑，切到 3D 看阴影。
        {custom && ' 现在按上海、图纸上方朝北算，改成你家的就准了。'}
      </p>

      <div className="sun-site">
        <CompassDial />
        <div className="sun-site-fields">
          <Selector
            label="城市"
            size="sm"
            hasSearch
            options={CITY_OPTIONS}
            value={CITIES.some(([n]) => n === site.city) ? site.city! : ''}
            onChange={(name) => {
              const c = CITIES.find(([n]) => n === name);
              if (c) set({city: c[0], lat: c[1], lng: c[2]});
            }}
          />
          <NumberInput
            label="正北方向"
            size="sm"
            units="°"
            value={Math.round(site.north)}
            min={0}
            max={359}
            step={5}
            hasClear={false}
            onChange={(v) => Number.isFinite(v) && set({north: ((v % 360) + 360) % 360})}
          />
          <small className="sun-site-hint">拖左边的指针对准户型图上的指北针。图纸下方朝{southFacing}。</small>
        </div>
      </div>

      <SunTime width={176} />

      <SegmentedControl label="平面图显示" value={view} onChange={(v) => useDesignUi.getState().setSunView(v as SunView)} size="sm" layout="fill">
        <SegmentedControlItem value="now" label="此刻的光斑" />
        <SegmentedControlItem value="day" label="全天日照时长" />
      </SegmentedControl>

      <section aria-label="各房间日照" aria-busy={busy}>
        <h3 className="np-panel-title">
          {dayLabel(day)}各房间日照{busy && <span className="sun-busy">计算中…</span>}
        </h3>
        {!result ? (
          <div className="np-loading" style={{height: 120}}>计算中…</div>
        ) : (
          <ul className="sun-rooms">
            {result.rooms
              .filter((r) => r.area >= 1.5)
              .map((r) => {
                const g = sunGrade(r.max);
                const total = result.times.length ? result.times.at(-1)! - result.times[0]! : 1;
                return (
                  <li key={r.id}>
                    <span className="sun-room-name">{r.name}</span>
                    <span className="sun-bar" aria-hidden>
                      <i style={{width: `${Math.min(100, (r.max / Math.max(1, total)) * 100)}%`}} />
                    </span>
                    <span className="sun-room-val">{r.max > 0 ? `${r.max.toFixed(1)} 小时` : '晒不到'}</span>
                    <span className={`sun-grade is-${g.tone}`}>{g.label}</span>
                  </li>
                );
              })}
          </ul>
        )}
        <p className="np-hint sun-note">
          时长是房间里晒得最久那块地面的日照，窗户朝向、窗台高度、层高和拆改后的墙都算进去了；对面楼、阳台外的遮挡和窗框没算。
        </p>
      </section>
    </div>
  );
}
