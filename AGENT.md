# 栖图 NestPlan · 项目工程基准

> 压缩后失忆时先读这一份。用户说明、README、docs/plan.md 与这里冲突时，以用户最新指示为准，并回头更新本文件。

## 项目身份

- **是什么**：纯前端的户型装修设计工具。上传户型图 → 还原成可编辑户型 → 2D 布置 + 3D 预览 / 漫游 → 「改造回放」动画（毛坯一步步变成完工，可导出视频）。
- **给谁用**：想自己琢磨装修布局的普通住户；界面、文案全中文。
- **来源**：受开源项目 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)（MIT，单个 index.html）启发后重新设计、重写。示例户型、家具库尺寸配色、地面单价、3D 家具模型和地板贴图做法移植自原项目。
- **阶段**：v0.1.0，未发版、无线上部署（CI 只构建 + 测试 + 报体积）。路线图见 `docs/plan.md`：阶段 0 骨架、1 还原、3 回放已完成；2 设计大部分完成；4 CAD 暂缓；5 AI 助手智能体未开始。
- **仓库**：`git@github.com:ZhengXiaowei/nest-plan.git`，主分支 `main`。

## 铁律

1. **纯前端，不经手用户数据和密钥**。方案存浏览器 IndexedDB；AI 请求从浏览器直连用户填写的接口。AI 密钥默认只存 `sessionStorage`，用户勾「记住」才进 `localStorage`。不要加任何栖图自己的后端或中转。
2. **首屏只有 2D 编辑器**。3D（three.js）、还原页、回放页、AI 设置窗口、AI 助手、属性表单、菜单、导入导出、日照面板都是 `lazy()` 动态加载。新功能默认也要按需加载，别往首屏塞。
3. **单位一律毫米，平面坐标 x 向右、y 向下**；3D 里换算成米、y 朝上，平面 (x, y) → 3D (x, z)。
4. **不改 `node_modules`**。给 Astryx 瘦身全靠构建插件 `scripts/astryx-slim.mjs`。
5. **保留原项目 MIT 声明**：移植自 floorplan-3d 的代码/数据要在注释里注明来源，`THIRD_PARTY_NOTICES.md` 不能删。
6. **承重墙、外墙不能拆**（`model/walls.ts` 的 `canDemolish`），只有非承重墙 `partition` / 矮墙 `low` 能拆；新砌的墙（`added: true`）"拆"就是直接删掉。
7. 文案、注释、提交信息都用中文、说人话；提交信息格式参考历史（一句话说清做了什么）。

## 技术栈

Vite 8 + React 19 + TypeScript 7（strict、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）· Astryx（Meta 开源、基于 StyleX 的组件库）+ 自定义「蓝图」主题（白底 + 群青蓝 `#2747D6`）· zustand 5 · three.js + @react-three/fiber + drei · mediabunny（WebCodecs 封装 MP4）· vitest。Node ≥ 20.19。

## 仓库结构

```
index.html / vite.config.ts      入口；vite 里挂了 astryxSlim 插件
scripts/
  astryx-slim.mjs                Astryx 瘦身插件（换 ICU 解析器、换中文文案表、去主题运行时、图标内联）
  check-budget.mjs               首屏体积报告（只报告不失败），写 dist/size.json
  patch-theme.mjs                主题生成后修正图标导入（npm run theme 自动调用）
src/
  main.tsx / App.tsx             挂载、顶栏、设计页快捷键
  lib/                           router（hash 路由，三页 trace/design/replay，默认 design）、idb、icons、toast、icuLite 等
  model/                         纯数据与几何，无 React：types、samplePlan、catalog（家具库）、materials、
                                 geometry、walls（拆墙/贴墙/吸附）、snap、dims（外圈尺寸）、sun（太阳位置）、sunlight（室内日照光线追踪）
  store/planStore.ts             方案状态 + 撤销栈（checkpoint / patch / commit 三件套）+ IndexedDB 防抖自动保存
  features/
    plan2d/                      SVG 平面图画布（按图层拆分 + memo；缩放平移直接改 viewBox）
    view3d/                      3D 视图、家具模型（models.ts 最大，1400+ 行）、第一人称漫游 walk.ts
    design/                      设计页：家具库、属性、房间预算、AI 助手、菜单、方案导入导出 planFiles.ts
    trace/                       户型还原：草稿（像素坐标）、描图画布、标定、traceStore
    ai/                          AI 设置、最小客户端（OpenAI 兼容 / Anthropic）、户型识别 prompt
    replay/                      改造回放：timeline（纯函数）、route（Dijkstra 漫游路线）、replayScene、导出视频
    sun/                         日照面板、平面光斑叠加、Web Worker 计算
  theme/                         blueprint.ts 源文件 + generated/ 生成产物（别手改 generated）
docs/plan.md                     路线图、回放设计、性能指标与瘦身做法
```

## 关键数据流

- **方案 `Plan`**（`model/types.ts`）：walls / openings / rooms / furniture / demolished（拆掉的墙 id）/ measures / prices / site（城市经纬度 + 北向角）。`version: 1`，旧存档走 `normalizePlan` 补字段。
- **撤销**：改动前 `checkpoint()`，拖拽中用 `patch()`（不记历史），一次性改动用 `commit()`。历史上限 100。
- **还原流程**：图片 → （可选）AI 识别返回像素坐标 JSON → 草稿 `Draft`（像素）→ 校对（置信度 < 0.6 高亮）→ 标定（两点 + 实长，或尺寸标注中位数自动估）→ 换算毫米生成 `Plan`。
- **日照**：`sunStore` 按墙/门窗/房间/位置/日期算 key，变了才防抖 120 ms 丢给 `sun.worker.ts`；家具挪动不重算。网格 150 mm、每 10 分钟一条光线。
- **回放**：时间线是方案的纯函数，播放和逐帧导出都按 t 取状态，不用 GSAP；场景一次搭好，每帧只改可见性/高度/颜色/位置，不走 React。

## 命令

```bash
npm install
npm run dev        # 本地开发
npm test           # vitest，当前 9 个文件 120 个用例
npm run typecheck  # 只做类型检查
npm run build      # tsc + vite build
npm run budget     # 构建后跑：报告首屏 JS / CSS gzip 体积
npm run theme      # 改了 src/theme/blueprint.ts 后重新生成主题（会自动 patch）
```

CI（`.github/workflows/ci.yml`）：push main / PR → `npm ci` → test → build → 拉 main 上次成功构建的 `bundle-size` 产物对比 → 写进运行摘要。不因体积失败。

## 踩过的坑

- **Astryx 瘦身插件依赖内部文件路径**：`@astryxdesign/core` 的 `theme/Theme.js`、`i18n/generated-locales/en.generated.js`，theme-neutral 的 `icons.mjs` 格式，以及 lucide 的 `__iconData` 写法。升级 Astryx / lucide 后插件可能直接抛错（有明确报错文案），先查 `scripts/astryx-slim.mjs`。
- **`icuLite` 替换了 intl-messageformat**：只支持参数、number、plural、select。Astryx 新增复杂 ICU 写法时 `src/lib/icuLite.test.ts` 会挂，要补实现。
- **`astryx theme build` 生成的模块会从 theme-neutral 源码入口取图标**，把 defineTheme 运行时带进首屏；`patch-theme.mjs` 负责改成 `/built` 入口，所以永远用 `npm run theme`，别单跑 astryx CLI。
- **Anthropic 浏览器直连**必须带 `anthropic-dangerous-direct-browser-access: true` 头。
- **模型回复不一定是一段字符串**（2026-10-29，用户 AI 识别时只看到「Unexpected end of JSON input」）：带深度思考的模型会把输出上限用完、正式回复为空（`finish_reason: length` / `stop_reason: max_tokens`）；部分网关把 `content` 返回成分段数组；模型也可能只回一段文字不给 JSON。`ai/client.ts` 里 `complete` 对空回复抛带原因的中文 `AiError`，`extractJson` 区分「没有 JSON」和「被截断」。复现用例在 `ai/client.test.ts`，在本地验证时可以起一个按模型名返回不同回复的假接口。
- **DeepSeek 默认开着深度思考**（2026-10，用户用的就是 DeepSeek）：识图只有 `deepseek-flash` 能用，`deepseek-v4-pro` 不支持图片。关思考两种协议都是 `thinking: {"type": "disabled"}`（官方文档表格里这一格横跨 OpenAI 和 Anthropic 两列，WebFetch 摘要会读错，要看原始 HTML）。设置里的 `thinking` 开关只对 `canToggleThinking` 认得的接口生效，目前只有 `api.deepseek.com`。别家先不加：智谱部分模型强制思考、传 disabled 会报错；通义 `-thinking` 后缀模型关不掉。
- **「测试连接」只给 16 个 token**：开着思考的模型来不及回复，所以测试连接固定传 `thinking: false`；认不出的接口关不了思考，推理模型仍可能显示「连接失败」加深度思考的提示，其实接口是通的。
- **AI 识别的坐标不能要像素**（2026-10-29，用户反馈识别结果整体缩小、偏左上）：接口会先缩放图片再给模型，DeepSeek 缩到约 1300×1300 的像素量，2048×1935 的图被缩到 0.653 倍，模型给的就是这张缩小图上的坐标。现在提示词要 0~1000 相对坐标，`toImagePixels` 按图片宽高分别换算。识别出的墙再经 `tidyWalls` 规整（拉正、对齐、墙角接上），墙角按「中心线相接」约定，3D 由 `withCorners` 补墙角方块。
- **从截图反推坐标变换要先定死图片原点**：第一次分析时把图片左上角当自由参数拟合，凑出了「0~1000 相对坐标」的错误结论；拿到原图尺寸、用真实原点算才发现是缩放。用户的原图在工作区 `exports/`（不是我建的，别动、别提交）。
- **示例户型的墙是按矩形转的中心线**，墙角处两段中心线差半个墙厚，不在端点相接；拿它当规整算法的标准答案时只能比「是否拉正、垂直方向位置」，不能比端点。
- **手上没有真实的 DeepSeek 密钥**：请求参数只能靠单测和本地假接口验证，真实效果要用户用自己的密钥验收。不要拿假密钥去请求真实的第三方接口。
- **IndexedDB 在隐私模式可能不可用**，持久化失败要静默降级，不能挡住启动。
- **切出 2D 视图会把工具重置为「选择」**（`designUi.setView`），避免回来还停在拆墙模式。
- **首屏体积**：react-dom ≈ 60 KB 最大，其次 Astryx 文案表和主题 token。161 → 142 KB 靠瘦身插件；补齐原版功能后 149 KB；加日照后 150.6 KB（2026-10-29 本地实测）。

## 当前状态与待办（2026-10-29）

- `main` 最新：`7839348` 真实日照（城市 / 朝向 / 日期模拟太阳，平面光斑与日照时长，3D 真实太阳光）。
- 进行中：`fix/ai-empty-reply` 分支，① AI 识别空回复时说清原因 ② DeepSeek 深度思考开关 ③ 识别坐标改用 0~1000 相对坐标 + 墙体规整。等用户用自己的 DeepSeek 密钥验收后再合回 main。
- 识别质量的后续方向（未立项）：整体对齐工具（拖动缩放整份识别结果贴合原图）；传统图像算法从像素里找墙，AI 只认房间名。
- 本地开发服务通常是用户自己在 5173 端口开的（就在本目录）；我验证时用 `.claude/launch.json` 起的服务会自动换到 5174。
- 已有但没做完：`designUi.PanelTab` 里留了 `'check'`（通道宽度检查），界面上还没有这个页签。
- 路线图下一步（`docs/plan.md`）：PDF 户型图导入；AI 助手从单轮问答升级为能直接改方案的智能体（摆家具、查动线、出预算）；之后 DXF（CAD）导入。
- 性能待办：LCP / INP 还没实测；3D 家具改 InstancedMesh、模型 KTX2 + meshopt；还原页图片预处理移到 Worker；按用到的组件裁剪 Astryx 文案表（约 26 KB 未压缩）。
- 文档小偏差：`docs/plan.md` 里首屏 JS 写的 149 KB，日照功能合入后实际 150.6 KB。
