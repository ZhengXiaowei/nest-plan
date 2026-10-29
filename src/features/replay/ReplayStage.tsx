import {useEffect, useImperativeHandle, useMemo, useRef, type Ref} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import * as THREE from 'three';
import type {Plan} from '../../model/types';
import {EnvironmentMap, FOV, Lights} from '../view3d/scene';
import {planBounds} from '../../model/geometry';
import {buildReplayScene} from './replayScene';
import {cameraAt, captionAt, type Caption, type Timeline} from './timeline';
import {drawOverlay, encodeVideo, type EncodedVideo} from './exportVideo';

/** 播放头：页面和场景共用，播放时每帧前进，不经过 React 状态 */
export interface ReplayClock {
  t: number;
  playing: boolean;
  exporting: boolean;
}

export interface ReplayApi {
  /** 跳到某一秒并重画一帧 */
  seek(t: number): void;
  exportVideo(opts: {width: number; height: number; fps: number}, onProgress: (p: number) => void, signal: AbortSignal): Promise<EncodedVideo>;
}

interface Props {
  plan: Plan;
  tl: Timeline;
  clock: ReplayClock;
  playing: boolean;
  onTick: (t: number, cap: Caption) => void;
  onEnd: () => void;
  ref?: Ref<ReplayApi>;
}

function Stage({plan, tl, clock, onTick, onEnd, apiRef}: Omit<Props, 'playing' | 'ref'> & {apiRef?: Ref<ReplayApi>}) {
  const scene = useMemo(() => buildReplayScene(plan, tl), [plan, tl]);
  useEffect(() => () => scene.dispose(), [scene]);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  // 走进屋里时补光：没有天花板，只靠太阳的话背光的墙会发灰。灯挂上场景后第一次用到时再收集
  const fill = useRef<{l: THREE.Light; base: number}[] | null>(null);
  const indoorFill = (k: number) => {
    if (!fill.current) {
      const lights: {l: THREE.Light; base: number}[] = [];
      get().scene.traverse((o) => {
        if (o instanceof THREE.HemisphereLight || o instanceof THREE.AmbientLight) lights.push({l: o, base: o.intensity});
      });
      if (!lights.length) return;
      fill.current = lights;
    }
    for (const {l, base} of fill.current) l.intensity = base * (1 + 0.55 * k);
  };

  const pose = (t: number) => {
    const {camera} = get();
    const c = cameraAt(tl, t);
    camera.position.set(...c.pos);
    camera.quaternion.set(...c.quat);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== c.fov) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    scene.apply(t);
    indoorFill(Math.max(0, Math.min(1, (6 - c.pos[1]) / 4.4)));
    return captionAt(tl, plan, t, [c.pos[0], c.pos[2]]);
  };

  useFrame((_, dt) => {
    if (clock.exporting) return;
    if (clock.playing) {
      clock.t = Math.min(tl.duration, clock.t + Math.min(dt, 0.1));
      if (clock.t >= tl.duration) {
        clock.playing = false;
        onEnd();
      }
    }
    onTick(clock.t, pose(clock.t));
  });

  useImperativeHandle(
    apiRef,
    () => ({
      seek(t) {
        clock.t = Math.max(0, Math.min(tl.duration, t));
        invalidate();
      },
      async exportVideo({width, height, fps}, onProgress, signal) {
        const state = get();
        const prev = {w: state.size.width, h: state.size.height, dpr: state.viewport.dpr, loop: state.frameloop};
        clock.playing = false;
        clock.exporting = true;
        state.setFrameloop('never');
        state.setDpr(1);
        state.setSize(width, height);
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d')!;
        const frames = Math.ceil(tl.duration * fps) + 1;
        try {
          return await encodeVideo({
            canvas: out,
            fps,
            frames,
            signal,
            onProgress,
            draw(i) {
              const t = Math.min(tl.duration, i / fps);
              const cap = pose(t);
              const s = get();
              s.gl.render(s.scene, s.camera);
              // 渲染完马上拷走，不必开 preserveDrawingBuffer
              ctx.drawImage(s.gl.domElement, 0, 0, width, height);
              drawOverlay(ctx, cap, width, height);
            },
          });
        } finally {
          clock.exporting = false;
          const s = get();
          s.setSize(prev.w, prev.h);
          s.setDpr(prev.dpr);
          s.setFrameloop(prev.loop);
          invalidate();
        }
      },
    }),
    [tl, plan, scene],
  );

  return <primitive object={scene.root} />;
}

/** 回放画面：播放时连续出帧，暂停时只在拖动进度时出帧 */
export default function ReplayStage({plan, tl, clock, playing, onTick, onEnd, ref}: Props) {
  const b = planBounds(plan);
  const cx = (b.minX + b.maxX) / 2000;
  const cz = (b.minY + b.maxY) / 2000;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 1000;
  return (
    <Canvas
      frameloop={playing ? 'always' : 'demand'}
      dpr={[1, 2]}
      shadows="percentage"
      gl={{antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05}}
      camera={{fov: FOV, near: 0.05, far: 400}}
    >
      <color attach="background" args={['#F3F5F8']} />
      <EnvironmentMap />
      <Lights cx={cx} cz={cz} span={span} />
      <Stage plan={plan} tl={tl} clock={clock} onTick={onTick} onEnd={onEnd} apiRef={ref} />
    </Canvas>
  );
}
