# 预检和浏览器测试

以下命令只读取状态，不暂存、提交、修改 PR 或合并。先运行仓库完整检查并审查实际差异；预检不是审查或合并授权。

- `node scripts/workflow-preflight.mjs commit <提交信息文件>`：复用现有来源解析器与 commitlint 检查完整提交信息。
- `node scripts/workflow-preflight.mjs tree <基线引用>`：打印解析后的基线 SHA、索引树 SHA、变更文件、未暂存和未跟踪文件；记录树 SHA 并人工审查 `git diff <基线SHA> <树SHA>`。提交前运行 `node scripts/workflow-preflight.mjs tree <基线SHA> <已审查树SHA>`，若索引变化会失败。
- `node scripts/workflow-preflight.mjs pr <owner/repo> <编号> <预期完整头提交SHA>`：通过已登录的 `gh` 检查 PR 当前头提交、正文来源、该 PR 该头提交最新的 quality PR 工作流和三个必需 job。下载该 run/attempt 的 `pr-check-inputs-<attempt>` 工件，比对 CI 事件的 head/base、标题/正文 SHA-256；再复读 PR 和最新工作流，拒绝检查期间的实际输入变化。评论更新不使相同输入的检查失效。缺失、过期或错配的工件均拒绝；旧工作流没有此工件时需运行新版工作流。标题/正文修改需新 PR 事件，不能用携带旧事件的 rerun 代替。该结果不检查仓库保护设置，也不授予合并许可。

`scripts/record-contract.test.mjs` 随 `npm run check` 自动运行。它以手写夹具和独立消费者核验内存导出及目录记录（含根 workspace.json）的核心版本/标识与 CSV 表头，不导入应用读写校验器或列定义。范围来自已冻结的 #4 D-02/D-03 及受力字段扩展；它不等于完整机器 schema、物理验收或崩溃恢复证明。

## 工作区浏览器验证

`npm run test:workspace:browser -- --preflight` 一次输出缺失的前置条件；目录授权由用户或本次已获授权的原生界面工具完成。先构建当前源码，在真实桌面 Chrome 的专用命名会话中打开测试页面，并明确选择一个可写的可丢弃测试目录，保持无活动实验。原生选择框操作可由用户或本次已获授权的原生界面工具完成。

```sh
BROWSER_SESSION=workspace-test \
BROWSER_URL=http://localhost:5183/ \
BROWSER_ARTIFACTS_DIR=/tmp/workspace-preflight-unique \
npm run test:workspace:browser -- --preflight
```

正常运行去掉 `-- --preflight`，并使用新的工件目录；入口复用 `browser-workspace-visibility.mjs` 的确认前后台切换、真实标签切换、封存和历史配色验证。默认地址仍是 localhost:5183；`BROWSER_URL` 可指定其他 loopback 地址。`CHROME_EXECUTABLE` 指定实际 Chrome；`BROWSER_BUILD_INFO` 可指定已构建身份文件，必须匹配当前源码。

预检检查 Chrome 版本、测试标签、原生目录 API、已授权可写状态、开始按钮，以及页面/磁盘/当前源码三者的构建身份，写入 `preflight.json`。它不检测或解锁系统锁屏，也不自动授予辅助功能权限；原生对话框受阻时保留阻塞结果，一次处理所需权限后用新工件目录重试。执行步骤、结果与当前源码身份继续落盘；历史结果不作为当前构建通过证据，既有工件目录不覆盖。`native_picker` 明示脚本没有测试原生选择动作；选择后的真实 FSA 写入与历史读回由正常运行覆盖。此命令不进入无人值守 CI。

`npm run test:browser` 运行 T01、T02、T03 和共同快照扰动的真实 Chrome 检查。脚本共享固定版本的浏览器命令驱动和清单校验；T03 等待配置与按钮同时就绪，不能只等待可见文字。每个工件目录的 `browser-steps.jsonl` 在步骤开始及结束时持续追加，包含参数、结果及耗时，异常中断也能保留已写日志。扰动测试使用受控可见性事件，并以实际下载文件读回校验；它不声称原生保存对话框已测试。摘要、截图、实际下载及回读校验继续保留；可用 `BROWSER_ARTIFACTS_DIR` 指定工件目录。

## 启动保存故障回归

`npm run test:workspace:start-failure` 在已授权的真实 macOS Chrome 命名会话执行启动阶段故障回归。先构建当前源码并在页面原生选择一个新建的可丢弃空目录，再提供 `BROWSER_SESSION`、`BROWSER_URL`、`WORKSPACE_TEST_DIR`（同一个目录）和新的 `BROWSER_ARTIFACTS_DIR`。此测试不进入无人值守 CI；公开工作区 API 的启动故障测试随 `npm run check` 执行。

脚本核对页面、磁盘工作区 ID 及构建身份，在生产 Worker 创建初始记录后、开始提交前设置调试断点；只将该测试目录的 `tmp` 改为 0555，触发真实 FSA 写入错误，并在 finally 恢复原模式。它验证列表尚未刷新时仍可选中冻结实验、查看及下载含 live_fault 的恢复诊断，确认旧引用字节不变，再恢复权限、显式重试并封存。断点定位变化或缺少前置条件时失败，不替换 picker、Worker 或文件句柄。失败日志、截图、磁盘原件及下载保留；仅对明确指定的可丢弃目录运行。
