import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// 3D、还原页、回放页都是动态 import，构建时自动拆包，首屏只加载 2D 编辑器。
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // three.js 所在的 3D 包按需加载，不影响首屏，放宽提示阈值
    chunkSizeWarningLimit: 1000,
  },
});
