import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Popover} from '@astryxdesign/core/Popover';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {navigate} from '../../lib/router';
import {toast} from '../../lib/toast';
import {IconPause, IconPlay, IconRestart, IconVideo} from '../../lib/icons';
import {usePlanStore} from '../../store/planStore';
import {buildTimeline, type Caption} from './timeline';
import type {ReplayApi, ReplayClock} from './ReplayStage';
import './replay.css';

const ReplayStage = lazy(() => import('./ReplayStage'));

const fmt = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

const RESOLUTIONS = {
  '720p': {width: 1280, height: 720},
  '1080p': {width: 1920, height: 1080},
} as const;
type Res = keyof typeof RESOLUTIONS;

/**
 * 改造回放：毛坯一步步变成方案，最后第一视角走一遍，可导出视频。
 * 播放头在 clock 里，每帧直接改进度条和时间的 DOM，不触发 React 渲染。
 */
export default function ReplayPage() {
  const hasWalls = usePlanStore((s) => s.plan.walls.length > 0);
  if (!hasWalls) {
    return (
      <main className="np-replay">
        <EmptyState
          title="还没有户型"
          description="先上传户型图还原墙体，或者在设计页画好方案，这里就能生成改造回放。"
          actions={<Button label="去还原户型" variant="primary" onClick={() => navigate('trace')} />}
        />
      </main>
    );
  }
  return <Player />;
}

function Player() {
  const plan = usePlanStore((s) => s.plan);
  const tl = useMemo(() => buildTimeline(plan), [plan]);
  const clock = useRef<ReplayClock>({t: 0, playing: false, exporting: false}).current;
  const api = useRef<ReplayApi>(null);
  const [playing, setPlaying] = useState(false);
  const [cap, setCap] = useState<Caption | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  const capEl = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [res, setRes] = useState<Res>('1080p');
  const [menu, setMenu] = useState(false);

  // 换了方案就回到开头
  useEffect(() => {
    clock.t = 0;
    clock.playing = false;
    setPlaying(false);
    api.current?.seek(0);
  }, [tl, clock]);

  const lastKey = useRef('');
  const lastSec = useRef(-1);
  const onTick = useCallback(
    (t: number, c: Caption) => {
      const k = t / tl.duration;
      if (fill.current) fill.current.style.transform = `scaleX(${k})`;
      if (head.current) head.current.style.left = `${k * 100}%`;
      const sec = Math.floor(t);
      if (sec !== lastSec.current && timeEl.current) {
        lastSec.current = sec;
        timeEl.current.textContent = `${fmt(t)} / ${fmt(tl.duration)}`;
      }
      // 暂停时字幕一直清楚，播放时随章节淡入淡出
      if (capEl.current) capEl.current.style.opacity = String(clock.playing ? c.alpha : 1);
      const key = `${c.index}|${c.title}|${c.sub}`;
      if (key !== lastKey.current) {
        lastKey.current = key;
        setCap(c);
      }
    },
    [tl, clock],
  );

  const play = useCallback(() => {
    if (clock.t >= tl.duration - 0.05) clock.t = 0;
    clock.playing = true;
    setPlaying(true);
  }, [clock, tl]);
  const pause = useCallback(() => {
    clock.playing = false;
    setPlaying(false);
  }, [clock]);
  const seek = useCallback((t: number) => api.current?.seek(t), []);
  const onEnd = useCallback(() => setPlaying(false), []);

  // 空格播放暂停，左右键快退快进 5 秒
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (exporting !== null || e.metaKey || e.ctrlKey || e.altKey) return;
      // 焦点在按钮上时空格留给按钮自己
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (clock.playing) pause();
        else play();
      } else if (e.key === 'ArrowLeft') seek(clock.t - 5);
      else if (e.key === 'ArrowRight') seek(clock.t + 5);
      else if (e.key === 'Home') seek(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, play, pause, seek, exporting]);

  // 离开页面时停掉导出
  useEffect(() => () => abort.current?.abort(), []);

  // 拖进度条
  const track = useRef<HTMLDivElement>(null);
  const scrubTo = (e: ReactPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * tl.duration);
  };

  const startExport = async () => {
    setMenu(false);
    pause();
    const ctl = new AbortController();
    abort.current = ctl;
    setExporting(0);
    let last = 0;
    try {
      const v = await api.current!.exportVideo(
        {...RESOLUTIONS[res], fps: 30},
        (p) => {
          // 进度每 1% 才更新一次界面
          if (p - last >= 0.01 || p === 1) {
            last = p;
            setExporting(p);
          }
        },
        ctl.signal,
      );
      const url = URL.createObjectURL(v.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${plan.name}-改造回放.${v.ext}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(`视频已导出（${(v.blob.size / 1048576).toFixed(1)} MB）`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast((err as Error).message || '导出失败', 'error', 4000);
    } finally {
      abort.current = null;
      setExporting(null);
      seek(clock.t);
    }
  };

  return (
    <main className="rp">
      <div className="rp-stage">
        <Suspense fallback={<div className="np-loading">正在搭场景…</div>}>
          <ReplayStage ref={api} plan={plan} tl={tl} clock={clock} playing={playing} onTick={onTick} onEnd={onEnd} />
        </Suspense>
        {cap && (
          <div ref={capEl} className="rp-caption" aria-live="polite">
            <span className="rp-caption-no">
              {String(cap.index + 1).padStart(2, '0')} / {String(cap.total).padStart(2, '0')}
            </span>
            <h2 key={cap.title}>{cap.title}</h2>
            {cap.sub && <p key={cap.sub}>{cap.sub}</p>}
          </div>
        )}
        {!playing && exporting === null && (
          <button className="rp-big-play" type="button" aria-label="播放回放" onClick={play}>
            <IconPlay />
          </button>
        )}
        {exporting !== null && (
          <div className="rp-export-mask">
            <div className="rp-export-card">
              <strong>正在导出视频</strong>
              <p>逐帧渲染，导出的视频不会掉帧。导出时别关这个页面。</p>
              <ProgressBar label="导出进度" value={Math.round(exporting * 100)} hasValueLabel />
              <Button label="取消" variant="secondary" size="sm" onClick={() => abort.current?.abort()} />
            </div>
          </div>
        )}
      </div>

      <div className="rp-bar">
        <IconButton
          label={playing ? '暂停' : '播放'}
          tooltip={playing ? '暂停（空格）' : '播放（空格）'}
          icon={playing ? <IconPause /> : <IconPlay />}
          variant="primary"
          onClick={playing ? pause : play}
          isDisabled={exporting !== null}
        />
        <IconButton label="从头播放" icon={<IconRestart />} variant="ghost" onClick={() => seek(0)} isDisabled={exporting !== null} />
        <span ref={timeEl} className="rp-time">
          00:00 / {fmt(tl.duration)}
        </span>

        <div
          ref={track}
          className="rp-track"
          role="slider"
          tabIndex={0}
          aria-label="回放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(tl.duration)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubTo(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e);
          }}
        >
          <div className="rp-track-bar">
            <div ref={fill} className="rp-track-fill" />
            {tl.chapters.slice(1).map((c) => (
              <i key={c.id} className="rp-track-tick" style={{left: `${(c.start / tl.duration) * 100}%`}} />
            ))}
            <div ref={head} className="rp-track-head" />
          </div>
          <div className="rp-chapters">
            {tl.chapters.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={cap?.index === i ? 'is-current' : undefined}
                style={{flexGrow: c.end - c.start}}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => seek(c.start + 0.01)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <Popover
          isOpen={menu}
          onOpenChange={setMenu}
          placement="above"
          alignment="end"
          content={
            <div className="rp-export-menu">
              <strong>导出视频</strong>
              <p>{fmt(tl.duration)} · 30 帧 · 带章节字幕</p>
              <SegmentedControl label="清晰度" value={res} onChange={(v) => setRes(v as Res)} size="sm">
                <SegmentedControlItem value="720p" label="720p" />
                <SegmentedControlItem value="1080p" label="1080p" />
              </SegmentedControl>
              <Button label="开始导出" variant="primary" size="sm" onClick={startExport} />
            </div>
          }
        >
          <Button label="导出视频" icon={<IconVideo />} variant="secondary" isDisabled={exporting !== null} />
        </Popover>
      </div>
    </main>
  );
}
