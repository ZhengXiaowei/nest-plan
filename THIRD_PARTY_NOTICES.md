# 第三方声明

## wy51ai/floorplan-3d

栖图的示例户型数据（墙体、门窗、房间、默认家具摆放）、家具库的尺寸与配色、地面材质单价，
以及 3D 家具模型的建模方式和地板贴图的绘制方式，移植自开源项目 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)。
涉及的文件：`src/model/samplePlan.ts`、`src/model/catalog.ts`、`src/model/materials.ts`、`src/features/view3d/models.ts`。
原项目以 MIT 许可证发布，以下为其许可证全文：

```
MIT License

Copyright (c) 2026 wuyi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 依赖库

运行时依赖（React、three.js、@react-three/fiber、@react-three/drei、zustand、Astryx 等）
各自的许可证随 npm 包一起分发，可在 `node_modules/<包名>/LICENSE` 查看。
