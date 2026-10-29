// 首屏体积检查：入口 JS + 首屏预加载的 JS + CSS，按 gzip 计算。
// 首屏 JS 上限 150 KB（见 docs/plan.md），超了 CI 就失败。
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

const LIMIT_JS_KB = Number(process.env.BUDGET_JS_KB ?? 150);
const LIMIT_CSS_KB = Number(process.env.BUDGET_CSS_KB ?? 45);

const html = readFileSync('dist/index.html', 'utf8');
const refs = (re) => [...html.matchAll(re)].map((m) => m[1]);
const js = [...refs(/<script[^>]+src="([^"]+)"/g), ...refs(/<link rel="modulepreload"[^>]+href="([^"]+)"/g)];
const css = refs(/<link rel="stylesheet"[^>]+href="([^"]+)"/g);
const gz = (files) => files.reduce((s, f) => s + gzipSync(readFileSync(`dist${f}`)).length, 0) / 1024;

const jsKb = gz(js);
const cssKb = gz(css);
console.log(`首屏 JS ${jsKb.toFixed(1)} KB gzip（上限 ${LIMIT_JS_KB}），CSS ${cssKb.toFixed(1)} KB gzip（上限 ${LIMIT_CSS_KB}）`);
if (jsKb > LIMIT_JS_KB || cssKb > LIMIT_CSS_KB) {
  console.error('超出首屏体积预算');
  process.exit(1);
}
