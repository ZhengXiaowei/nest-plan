import {describe, expect, it} from 'vitest';
import {createSamplePlan} from './samplePlan';
import {dimensionChains} from './dims';

const segs = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!);

describe('外圈尺寸标注', () => {
  const chains = dimensionChains(createSamplePlan().walls);
  it('四边各两道', () => {
    expect(chains).toHaveLength(8);
      });
  it('分段加起来等于总长，且都在户型外面', () => {
    for (let i = 0; i < chains.length; i += 2) {
      const inner = chains[i]!;
      const outer = chains[i + 1]!;
      expect(segs(inner.ticks).reduce((a, b) => a + b, 0)).toBe(outer.ticks[1]! - outer.ticks[0]!);
      expect(Math.abs(outer.at)).toBeGreaterThan(0);
    }
  });
});
