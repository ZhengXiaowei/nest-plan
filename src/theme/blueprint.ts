import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

/**
 * 栖图「蓝图」主题：在 neutral 基础上换主色（群青蓝），不用渐变。
 * 字体用系统中文字体，不额外加载网络字体，保证首屏速度。
 *
 * 改完后运行 `npm run theme` 重新生成 src/theme/generated/。
 */
export const blueprintTheme = defineTheme({
  name: 'blueprint',
  extends: neutralTheme,
  typography: {
    body: {
      family: 'system-ui',
      fallbacks: '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    },
    code: {
      family: 'ui-monospace',
      fallbacks: '"SF Mono", Menlo, Consolas, monospace',
    },
  },
  tokens: {
    '--color-accent': ['#2747D6', '#7B93F5'],
  },
});
