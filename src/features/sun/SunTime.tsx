import {useEffect} from 'react';
import {create} from 'zustand';
import {Slider} from '@astryxdesign/core/Slider';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {IconButton} from '@astryxdesign/core/IconButton';
import {IconPause, IconPlay} from '../../lib/icons';
import {clockText, daylight, doyOf, siteOf, type SunDayKey} from '../../model/sun';
import {usePlanStore} from '../../store/planStore';
import {useDesignUi} from '../design/designUi';

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 播放一整天用多少秒 */
const PLAY_SECONDS = 10;

/** 播放状态全局只有一份：3D 浮层和面板里的按钮同步，动画也只跑一个 */
const usePlay = create<{playing: boolean}>()(() => ({playing: false}));
let raf = 0;

function stopPlay() {
  cancelAnimationFrame(raf);
  usePlay.setState({playing: false});
}

function startPlay(lo: number, hi: number) {
  const ui = useDesignUi.getState();
  if (REDUCED_MOTION) return ui.setScene({hour: hi});
  if (ui.scene.hour >= hi - 0.1 || ui.scene.hour < lo) ui.setScene({hour: lo});
  cancelAnimationFrame(raf);
  usePlay.setState({playing: true});
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const h = useDesignUi.getState().scene.hour + ((hi - lo) * dt) / PLAY_SECONDS;
    if (h >= hi) {
      useDesignUi.getState().setScene({hour: hi});
      return stopPlay();
    }
    useDesignUi.getState().setScene({hour: h});
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** 当天日出到日落的钟点范围，极夜极昼时给个白天的默认范围 */
export function useDaySpan(): [number, number] {
  const site = usePlanStore((s) => siteOf(s.plan));
  const day = useDesignUi((s) => s.sunDay);
  const span = daylight(site, doyOf(day));
  return span ? [Math.ceil(span[0] * 4) / 4, Math.floor(span[1] * 4) / 4] : [6, 18];
}

/**
 * 日期 + 时间滑杆 + 播放一天。3D 浮层和日照面板共用。
 */
export function SunTime({width = 220, showDay = true}: {width?: number; showDay?: boolean}) {
  const hour = useDesignUi((s) => s.scene.hour);
  const night = useDesignUi((s) => s.scene.night);
  const day = useDesignUi((s) => s.sunDay);
  const ui = useDesignUi.getState();
  const [lo, hi] = useDaySpan();
  const playing = usePlay((s) => s.playing);

  // 换日期或城市后时间落在白天里，正在播放的停下
  useEffect(() => {
    const h = useDesignUi.getState().scene.hour;
    if (h < lo || h > hi) {
      stopPlay();
      ui.setScene({hour: Math.min(hi, Math.max(lo, 10))});
    }
  }, [lo, hi, ui]);

  // 离开页面时停下
  useEffect(() => stopPlay, []);

  return (
    <div className="sun-time">
      {showDay && (
        <SegmentedControl label="日期" value={day} onChange={(v) => ui.setSunDay(v as SunDayKey)} size="sm">
          <SegmentedControlItem value="winter" label="冬至" />
          <SegmentedControlItem value="equinox" label="春秋分" />
          <SegmentedControlItem value="summer" label="夏至" />
          <SegmentedControlItem value="today" label="今天" />
        </SegmentedControl>
      )}
      <div className="sun-time-row">
        <IconButton
          label={playing ? '暂停' : '播放一天的日照'}
          tooltip={playing ? '暂停' : '从日出播到日落'}
          icon={playing ? <IconPause /> : <IconPlay />}
          variant="secondary"
          size="sm"
          isDisabled={night}
          onClick={() => (playing ? stopPlay() : startPlay(lo, hi))}
        />
        <Slider
          label="时间"
          value={Math.min(hi, Math.max(lo, hour))}
          min={lo}
          max={hi}
          step={0.25}
          isDisabled={night}
          disabledMessage="夜景下没有太阳"
          formatValue={clockText}
          valueDisplay="text"
          width={width}
          onChange={(h: number) => {
            stopPlay();
            ui.setScene({hour: h});
          }}
        />
      </div>
    </div>
  );
}
