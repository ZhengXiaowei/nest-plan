// 给 Astryx 瘦身的构建插件，只影响打包结果，不改 node_modules。
// 1. intl-messageformat 换成 src/lib/icuLite.ts：Astryx 文案只用到简单的 ICU 写法，
//    不需要完整解析器。
// 2. Astryx 自带的英文文案表换成中文（缺的键用英文补），组件里的提示和读屏文字跟页面语言一致。
// 3. Theme 组件里「运行时生成主题 CSS」的代码换成占位：我们用的是 astryx theme build
//    预先生成好的主题，这段代码从来不会执行，却会把一整套配色算法打进首屏。
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const THEME_STUB = '\0astryx-slim:theme-runtime';
const isAstryx = (id) => !!id && id.replace(/\\/g, '/').includes('/@astryxdesign/core/');

export function astryxSlim() {
  return {
    name: 'nestplan:astryx-slim',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'intl-messageformat' && isAstryx(importer)) return resolve(root, 'src/lib/icuLite.ts');
      if (source === './defineTheme.js' && isAstryx(importer) && importer.replace(/\\/g, '/').endsWith('/theme/Theme.js')) return THEME_STUB;
      return null;
    },
    async load(id) {
      if (id === THEME_STUB) {
        return `export function generateThemeCSS() {
  throw new Error('栖图只用预构建主题：请用 astryx theme build 生成主题后再传给 <Theme>');
}`;
      }
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
