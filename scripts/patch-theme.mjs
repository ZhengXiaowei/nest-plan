// astryx theme build 生成的主题模块会从 theme-neutral 的「源码入口」取图标，
// 这会把 defineTheme 等运行时一起打进首屏。这里改成从已构建入口取同一份图标表。
import {readFileSync, writeFileSync} from 'node:fs';

const file = new URL('../src/theme/generated/blueprint.js', import.meta.url);
const src = readFileSync(file, 'utf8');
const from = `import { neutralTheme } from '@astryxdesign/theme-neutral';\nconst themeIcons = neutralTheme["icons"];`;
const to = `import { neutralIconRegistry as themeIcons } from '@astryxdesign/theme-neutral/built';`;
if (src.includes(from)) {
  writeFileSync(file, src.replace(from, to));
  console.log('patched theme icons import');
} else if (!src.includes(to)) {
  console.warn('patch-theme: pattern not found, check the generated file');
  process.exitCode = 1;
}
