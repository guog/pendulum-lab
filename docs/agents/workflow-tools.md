# 预检和浏览器测试

以下命令只读取状态，不暂存、提交、修改 PR 或合并。先运行仓库完整检查并审查实际差异；预检不是审查或合并授权。

- `node scripts/workflow-preflight.mjs commit <提交信息文件>`：复用现有来源解析器与 commitlint 检查完整提交信息。
- `node scripts/workflow-preflight.mjs tree <基线引用>`：打印解析后的基线 SHA、索引树 SHA、变更文件、未暂存和未跟踪文件；记录树 SHA 并人工审查 `git diff <基线SHA> <树SHA>`。提交前运行 `node scripts/workflow-preflight.mjs tree <基线SHA> <已审查树SHA>`，若索引变化会失败。
- `node scripts/workflow-preflight.mjs pr <owner/repo> <编号> <预期完整头提交SHA>`：通过已登录的 `gh` 检查 PR 当前头提交、正文来源、该 PR 该头提交最新的 quality PR 工作流和三个必需 job；复读 PR 检查期间是否发生变化。工作流必须晚于 PR 最近更新时间；如更新时间因无关变更而刷新，需触发新检查后重试。该结果不检查仓库保护设置，也不授予合并许可。

`npm run test:browser` 运行 T01、T02、T03 和共同快照扰动的真实 Chrome 检查。脚本共享固定版本的浏览器命令驱动和清单校验；T03 等待配置与按钮同时就绪，不能只等待可见文字。每个工件目录的 `browser-steps.jsonl` 在步骤开始及结束时持续追加，包含参数、结果及耗时，异常中断也能保留已写日志。扰动测试使用受控可见性事件，并以实际下载文件读回校验；它不声称原生保存对话框已测试。摘要、截图、实际下载及回读校验继续保留；可用 `BROWSER_ARTIFACTS_DIR` 指定工件目录。
