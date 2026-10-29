# 栖图 NestPlan

上传户型图，还原成可编辑的户型，在线做 2D 布置和 3D 预览，最后用一段「改造回放」动画看毛坯一步步变成你的家。

纯前端应用，数据保存在你自己的浏览器里。AI 功能使用你自己填写的模型接口和密钥，不经过任何栖图服务器。

## 现在能做什么

- **设计**：示例户型（三室两厅）开箱即用。拖动家具摆放、按 R 旋转、Delete 删除，撤销 / 重做，方案自动保存在本机。
- **3D 预览**：画中画实时同步，也可以切到全屏 3D 拖动旋转查看。
- **地面材质与预算**：点房间换地面材质，按面积加 5% 损耗估算地面造价。
- **户型还原（第一版）**：上传户型截图，用你连接的多模态模型识别墙体、门窗、房间；在图上点两下标定一段已知长度，生成可编辑户型。
- **AI 助手（第一版）**：带着当前户型的房间和家具信息问布局、动线、预算问题。
- **连接 AI**：支持 OpenAI 兼容接口和 Anthropic 接口，地址、密钥、模型都由你填写，默认只保存在当前会话。

## 接下来

路线图和性能、动效指标见 [docs/plan.md](docs/plan.md)。主要是：逐项校对和手动描墙、DXF（CAD）导入、拆改墙体、改造回放动画与视频导出、第一视角漫游。

## 本地开发

需要 Node.js 20.19 或更高版本。

```bash
npm install
npm run dev        # 本地开发
npm run build      # 类型检查 + 生产构建
npm run budget     # 构建后检查首屏体积
npm run theme      # 改了 src/theme/blueprint.ts 之后重新生成主题
```

## 技术栈

- Vite + React 19 + TypeScript
- [Astryx](https://github.com/facebook/astryx)（基于 StyleX 的组件库），自定义「蓝图」主题：白底 + 群青蓝 #2747D6
- 2D 平面图：SVG，单位毫米，按图层拆分避免拖动时整图重绘
- 3D：three.js + @react-three/fiber + drei，按需渲染，单独拆包、不进首屏
- 状态：zustand（含撤销栈），本地存储：IndexedDB

## 目录结构

```
src/
  model/        户型数据模型、几何计算、材质、家具库、示例户型
  store/        方案状态与撤销 / 重做、本地保存
  features/
    plan2d/     SVG 平面图画布
    view3d/     3D 视图
    design/     设计页（家具库、属性、房间预算、AI 助手）
    trace/      户型还原页
    ai/         AI 接口设置、请求客户端、户型识别
    replay/     改造回放（开发中）
  theme/        Astryx 主题源文件与生成产物
```

## 参考来源与致谢

栖图受到开源项目 **[wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)**（作者 wuyi）的启发，并在它的基础上重新设计、重写。

原项目是一个只有一个 `index.html` 的纯前端户型装修设计工具，2D 平面布置和 Three.js 3D 漫游都做得很扎实。栖图里的示例户型数据（墙体、门窗、房间、默认家具）、家具库尺寸与配色、地面材质单价都移植自原项目，换算成了新的数据模型。感谢原作者把它开源出来。

原项目以 MIT 许可证发布，原版权声明和许可证全文保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。

## 许可证

[MIT](LICENSE)。其中移植自 wy51ai/floorplan-3d 的部分同时遵循原项目的 MIT 许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
