// 给 Astryx 瘦身的构建插件，只影响打包结果，不改 node_modules。
// 1. intl-messageformat 换成 src/lib/icuLite.ts：Astryx 文案只用到简单的 ICU 写法，
//    不需要完整解析器。
// 2. Astryx 自带的英文文案表换成中文（缺的键用英文补），组件里的提示和读屏文字跟页面语言一致。
// 4. 主题图标表换成内联 SVG：theme-neutral 的图标表用 lucide-react 组件，会把 lucide 的
//    运行时一起打进首屏。这里在构建时把同样的 29 个图标的路径数据抄出来，画出来一模一样。
// 3. Theme 组件里「运行时生成主题 CSS」的代码换成占位：我们用的是 astryx theme build
//    预先生成好的主题，这段代码从来不会执行，却会把一整套配色算法打进首屏。
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const THEME_STUB = '\0astryx-slim:theme-runtime';
const ICONS = '\0astryx-slim:theme-icons';
const require = createRequire(import.meta.url);
const isAstryx = (id) => !!id && id.replace(/\\/g, '/').includes('/@astryxdesign/core/');

export function astryxSlim() {
  return {
    name: 'nestplan:astryx-slim',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'intl-messageformat' && isAstryx(importer)) return resolve(root, 'src/lib/icuLite.ts');
      if (source === '@astryxdesign/theme-neutral/built' && importer?.replace(/\\/g, '/').endsWith('/src/theme/generated/blueprint.js')) return ICONS;
      if (source === './defineTheme.js' && isAstryx(importer) && importer.replace(/\\/g, '/').endsWith('/theme/Theme.js')) return THEME_STUB;
      return null;
    },
    async load(id) {
      if (id === THEME_STUB) {
        return `export function generateThemeCSS() {
  throw new Error('栖图只用预构建主题：请用 astryx theme build 生成主题后再传给 <Theme>');
}`;
      }
      if (id === ICONS) return inlineIcons();
      const path = id.replace(/\\/g, '/');
      if (isAstryx(path) && path.endsWith('/i18n/generated-locales/en.generated.js')) {
        const en = (await import(id)).default;
        const zh = (await import(id.replace(/en\.generated\.js$/, 'zh-CN.generated.js'))).default;
        const merged = {};
        for (const key of Object.keys(en)) merged[key] = zh[key] ?? en[key];
        return `export default ${JSON.stringify(merged)};`;
      }
      return null;
    },
  };
}

/** 读 theme-neutral 的图标表和 lucide 的路径数据，生成不依赖 lucide-react 的同名图标表 */
async function inlineIcons() {
  const neutral = dirname(require.resolve('@astryxdesign/theme-neutral/built'));
  const src = await readFile(resolve(neutral, 'icons.mjs'), 'utf8');
  const lucideDir = resolve(dirname(createRequire(resolve(neutral, 'icons.mjs')).resolve('lucide-react')), '../esm');
  const index = await readFile(resolve(lucideDir, 'lucide-react.mjs'), 'utf8');
  const entries = [...src.matchAll(/^\s*(\w+): \/\* @__PURE__ \*\/ jsx\((\w+), \{ \.\.\.iconProps \}\)/gm)];
  if (entries.length < 10) throw new Error('astryx-slim: theme-neutral 图标表格式变了，请检查 scripts/astryx-slim.mjs');
  const lines = [];
  for (const [, key, comp] of entries) {
    const file = new RegExp(`default as ${comp},[^\\n]*from '(\\./icons/[^']+)'`).exec(index)?.[1];
    if (!file) throw new Error(`astryx-slim: 找不到 lucide 图标 ${comp}`);
    const mod = await readFile(resolve(lucideDir, file), 'utf8');
    const data = /const __iconData = (\{[\s\S]*?\n\});/.exec(mod)?.[1];
    if (!data) throw new Error(`astryx-slim: 读不出 ${comp} 的路径`);
    const {name, node} = Function(`return (${data})`)();
    lines.push(`  ${key}: icon(${JSON.stringify(name)}, ${JSON.stringify(node.map(([tag, {key: _k, ...attrs}]) => [tag, attrs]))}),`);
  }
  return `import {jsx} from 'react/jsx-runtime';
const icon = (name, node) => jsx('svg', {
  xmlns: 'http://www.w3.org/2000/svg', width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'lucide lucide-' + name, 'aria-hidden': true,
  children: node.map(([tag, attrs], i) => jsx(tag, attrs, i)),
});
export const neutralIconRegistry = {
${lines.join('\n')}
};
`;
}
