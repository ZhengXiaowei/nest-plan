// 首屏体积报告：入口 JS + 首屏预加载的 JS + CSS，按 gzip 计算。
// 只报告，不因为体积失败：功能会越来越多，体积变大是正常的，要看的是每次变了多少。
// 用法：node scripts/check-budget.mjs [上一次的 size.json]
// 结果写到 dist/size.json；在 GitHub Actions 里还会写进这次运行的摘要页。
import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

const html = readFileSync('dist/index.html', 'utf8');
const refs = (re) => [...html.matchAll(re)].map((m) => m[1]);
const jsFiles = [...refs(/<script[^>]+src="([^"]+)"/g), ...refs(/<link rel="modulepreload"[^>]+href="([^"]+)"/g)];
const cssFiles = refs(/<link rel="stylesheet"[^>]+href="([^"]+)"/g);
const kb = (f) => gzipSync(readFileSync(`dist${f}`)).length / 1024;
const sum = (files) => files.reduce((s, f) => s + kb(f), 0);

const now = {js: round(sum(jsFiles)), css: round(sum(cssFiles))};
writeFileSync('dist/size.json', JSON.stringify(now));

const prevPath = process.argv[2];
const prev = prevPath && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
const delta = (k) => {
  if (!prev || typeof prev[k] !== 'number') return '';
  const d = round(now[k] - prev[k]);
  return d === 0 ? '（没变）' : `（${d > 0 ? '+' : ''}${d} KB，上次 ${prev[k]} KB）`;
};

const lines = [`首屏 JS ${now.js} KB gzip${delta('js')}`, `首屏 CSS ${now.css} KB gzip${delta('css')}`];
console.log(lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = [...jsFiles, ...cssFiles]
    .map((f) => [f.replace(/^\/assets\//, ''), round(kb(f))])
    .sort((a, b) => b[1] - a[1])
    .map(([f, s]) => `| ${f} | ${s} |`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## 首屏体积\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n<details><summary>首屏文件</summary>\n\n| 文件 | KB gzip |\n| --- | --- |\n${rows.join('\n')}\n\n</details>\n`,
  );
}

function round(n) {
  return Math.round(n * 10) / 10;
}
