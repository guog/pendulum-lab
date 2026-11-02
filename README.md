# Pendulum Lab

浏览器本地的一阶倒立摆研究实验台。当前实现[T01：最小独立物理实验](https://github.com/guog/pendulum-lab/issues/6)：选择简单/标准工况，运行零阻力释放或静止下垂基准，观察真实二维运动及四状态曲线，暂停、继续、终止、重置，并显式导出可校验的原始证据。

当前为未发布实现。自动起摆、正式控制验收、目录持续保存及工作区独占均未实现或验证；完整计划见[需求基线QV-1](https://github.com/guog/pendulum-lab/issues/4)。

## 本地运行

使用`.nvmrc`指定的Node版本（支持Node 24～26）和npm：

```sh
npm ci
npm run dev
```

在桌面Chrome打开终端显示的localhost地址。首次目标环境为macOS＋Chrome＋localhost，本机只有一个应用实例。开发服务只提供静态资源，物理计算在浏览器Worker执行，实验数据不上传。

```sh
npm run build
npm run preview
```

构建输出为静态文件，可用预览命令本地复查。当前不发布软件版本或部署站点。

## 基准与证据

- 零阻力释放明确使用+π/2rad水平初态；静止下垂使用+πrad且不添加初扰。两者车位居中、初速度为零、观察窗口10秒。
- 两基准明确覆盖预设阻力为0，完整配置与覆盖项可展开查看。它们不替代后续标准自动起摆初态或工况。
- 默认物理步长1ms、记录10ms；后台自动暂停，返回后需显式继续。实际运行倍率与仿真时间分别报告。
- 数据仅在内存中，关闭或刷新会丢失未导出记录。暂停或结束后，可使用“导出并校验”写入实际文件并读回校验。
- 也可在“下载副本与文件校验”中生成JSON证据包，下载后选取实际文件校验。仅点击下载不会显示保存成功。
- 证据包包含完整配置、原始CSV、JSONL事件、结果及SHA-256清单。只标研究记录，不冒充控制验收通过或工作区已提交数据。

方程、数值方法、接口和记录格式详见[T01实现契约](docs/design/t01-implementation.md)。

## 检查

```sh
npm run typecheck
npm run test:app
npm run check
```

`check`运行格式、Markdown、类型、工具/会话行为测试及生产构建。工具检查与应用物理/控制验收是不同的结论。

真实浏览器检查需要已安装的Chrome及首次下载验证工具所需的网络：

```sh
npm run build
npm run test:browser
```

该命令启动独立静态预览服务、隔离的真实Chrome会话，执行页面操作、后台暂停、下载/读回校验与10秒平衡基准；结束后关闭它自己启动的浏览器和服务。默认查找macOS Chrome，可用`CHROME_EXECUTABLE`指定实际可执行文件。`BROWSER_ARTIFACTS_DIR`可指定日志、截图和导出证据的目的目录，默认写入独立系统临时目录。浏览器检查不纳入无Chrome的通用CI，也不以替身浏览器冒充实际目标验证。

## 仓库导航

- [贡献与工程约定](CONTRIBUTING.md)：提交、分支、PR、CI与版本管理。
- [产品上下文](PRODUCT.md)：当前目的、用户及边界。
- [代理指引](AGENTS.md)：工程技能配置入口。
- `docs/origin/`：本地需求来源材料，保持原样；是否纳入版本控制单独处理。
- `docs/agents/`：Issue跟踪、分诊及领域文档规则。

Assisted-by: LLM
AI-Agent: OpenAI Codex
