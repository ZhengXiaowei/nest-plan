import {describe, expect, it} from 'vitest';
import RealFormat from 'intl-messageformat';
// @ts-expect-error 带查询参数绕过构建插件，拿到原始英文文案
import en from '../../node_modules/@astryxdesign/core/dist/i18n/generated-locales/en.generated.js?original';
import zh from '../../node_modules/@astryxdesign/core/dist/i18n/generated-locales/zh-CN.generated.js';
import LiteFormat from './icuLite';

// 每条文案里出现的参数都喂几组值，结果要和完整的 intl-messageformat 一致
const args = (msg: string) => [...new Set([...msg.matchAll(/\{\s*([\w]+)\s*[,}]/g)].map((m) => m[1]!))];
const numeric = (msg: string, name: string) => new RegExp(`\\{\\s*${name}\\s*,\\s*(number|plural|selectordinal)`).test(msg);
// select 的参数轮流取它的每个选项
const selectOptions = (msg: string, name: string) => {
  const m = new RegExp(`\\{\\s*${name}\\s*,\\s*select\\s*,`).exec(msg);
  if (!m) return null;
  return [...msg.slice(m.index).matchAll(/(\w+)\s*\{/g)].map((x) => x[1]!);
};
const samples = [0, 1, 2, 5, 1234];

describe('icuLite', () => {
  for (const [locale, catalog] of [
    ['en', en],
    ['zh-CN', zh],
  ] as const) {
    it(`和 intl-messageformat 结果一致：${locale} 全部 ${Object.keys(catalog).length} 条`, () => {
      let checked = 0;
      for (const msg of Object.values(catalog as Record<string, string>)) {
        const names = args(msg);
        for (const n of samples) {
          const values = Object.fromEntries(
            names.map((k, i) => {
              const opts = selectOptions(msg, k);
              if (opts?.length) return [k, opts[n % opts.length]];
              return [k, numeric(msg, k) ? n + i : `v${i}`];
            }),
          );
          let expected: string;
          try {
            expected = String(new RealFormat(msg, locale).format(values));
          } catch {
            continue;
          }
          expect(new LiteFormat(msg, locale).format(values), msg).toBe(expected);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });
  }

  it('撇号转义', () => {
    expect(new LiteFormat("It''s '{literal}' {x}").format({x: 1})).toBe("It's {literal} 1");
    expect(new LiteFormat("Delete {name}'s comment?").format({name: 'A'})).toBe("Delete A's comment?");
  });

  it('plural 的 =N 和 #', () => {
    const f = new LiteFormat('{n, plural, =0 {没有} one {# 个} other {# 个}}', 'en');
    expect(f.format({n: 0})).toBe('没有');
    expect(f.format({n: 1})).toBe('1 个');
    expect(f.format({n: 1200})).toBe('1,200 个');
  });
});
