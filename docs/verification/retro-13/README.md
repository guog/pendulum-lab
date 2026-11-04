# 四项维护改进的验证记录

规格见 [用户授权与验收范围](spec.md)。基线为 `6d9fcb6a36f765276f49bae95071216954bb25df`；公共接缝经用户确认，按能力逐项红绿实现。

## 实现与证据

1. 独立记录契约：`01-contract-red` / `01-contract-green` 和 `02-csv-red` / `02-csv-green`。手工夹具覆盖缺失/错误版本与标识；真实公共写入接口分别生成内存包和目录记录，独立消费者拒绝坏 CSV 表头。只校验已冻结的核心字段，不声称完整机器 schema。
2. 父规格导航：`03-spec-*`、`04-spec-links-*`。CLI 追踪原生父任务和显式父链接，API 权限错误或父链循环失败，已有输出不变。真实 GitHub 读取 #13 收集到 #13/#4/#5，见 [来源摘要](spec-collection-summary.json)；完整正文按输出路径供审查读取，不在仓库复制父规格。
3. CI 输入：`05-ci-inputs-*`、`06-ci-comment-*`。复现评论更新时间使原预检错误失败，改为比较 run/attempt 绑定的 head/base/标题/正文摘要；`07-ci-input-boundaries-green`、`11-ci-races-green` 验证错配工件、实际输入变化、必需 job 与新 workflow 竞态均拒绝，纯评论竞态可通过。质量工作流上传对应工件；真实 PR 上再验证下载路径。
4. 浏览器入口：`08-browser-*`、`09-browser-entry-*`、`10-browser-location-*`，覆盖缺失前提、新命令入口、地址/构建身份、已有工件保护及不可写位置。进程/浏览器响应夹具不作为真实 Chrome 证明。

上述日志均在本目录以 `.txt.gz` 保存。首次新增工具的 red 包含模块/命令尚不存在的失败；后续 red 针对实际缺失行为。真实预检另发现“未授权”和“结束当前实验”双重提示；`browser-blocked.txt.gz` 保留原结果。`12-browser-incomplete-fixture.txt.gz` 保留最初漏设 ready=false 而未复现的夹具，随后补齐实际按钮状态并验证修复，见 `12-browser-prereq-green.txt.gz`，不把误通过当作失败证据。

## 最终检查与真实浏览器

- [check.txt.gz](check.txt.gz) 保留完整 `npm run check`：格式、文档、类型、测试和生产构建通过。
- 真实 Chrome 156 + 原生选择临时目录 + localhost:5299：统一命令完整运行通过，封存 29 条样本、7 条事件；包含三次后台暂停、两次显式继续，四图颜色像素验证通过。未伪造 picker、Worker 或 FSA 句柄。
- 原生选择沿用用户授权的 System Events；预检/执行脚本本身不操作 picker。前置条件未满足时一次输出缺项；授权后重试使用新目录，旧阻塞证据保留。
- [浏览器摘要](browser-summary.json)、[步骤/截图/实际工作区文件](browser-evidence.tar.gz)。源码摘要为 `b73daeef4d5ae8debbc9e86e68932f06a41ef10a19f6c4b6417e1308573426bd`、source_dirty=true；这是提交前实际构建，不冒称提交后的浏览器运行。

## 初审发现与补验

固定树 `1902134eae01d6547a5a6f70dd6fc60766f8c771` 的整分支初审：Standards 1 项 P2，Spec 2 项 P2（其中工件覆盖问题重合）。`13-legacy-evidence-*` 复现并修复没有 preflight.json 的旧工件目录仍被接受；现在浏览器操作前拒绝所有非空证据目录。`14-downstream-build-*` 复现并修复下游忽略 BROWSER_BUILD_INFO；有效路径一致传递，错误身份明确拒绝。

另以 `15-page-build-*` 先复现旧页面身份可通过预检，再要求页面、磁盘及当前源码身份一致，避免把旧页面运行归到当前构建。补验使用自定义构建身份文件和 5299 端口，真实 Chrome 再次通过，封存 22 条样本、7 条事件。见 [最终摘要](browser-final-summary.json) 与 [最终步骤/截图/实际目录文件](browser-final-evidence.tar.gz)。初轮 29 条样本的材料保留为历史，不覆盖。

第二轮固定树 `4df7d807f24e6ff0ba697a6bbfaa705df82a5ddc`：Standards 0 项，Spec 发现根 workspace.json 未进入独立验收的 1 项 P2。`16-workspace-root-*` 先复现坏版本/缺标识仍被接受，再补齐根文件存在性、schema_version=1 与工作区标识匹配检查；真实公开写入接口的根文件也进入独立消费者。

原始 `docs/origin/` 保持未跟踪且字节不变。应用源码及第三方技能安装目录不变。最新完整检查 136 项全部通过。

## 最终双轴审查

固定命令：`git diff 6d9fcb6a36f765276f49bae95071216954bb25df 662a2a9a1f94d3c0872272f8c40060f2c1bda44b`。两位新上下文代理独立审查整个分支。该树之后仅补本文结论，源码、测试及证据不变，提交前再次固定索引树。

### Standards

明确规范违规 0 项，需修改代码味道 0 项；12 项启发式、指引触发条件、证据/兼容性边界均核对。独立验收保留手写期望，刻意不共享应用常量。

### Spec

缺失/部分实现 0 项、越范围 0 项、实现错误 0 项；四项验收逐一映射通过。另独立运行定向测试 18/18 通过。CI 实际工件下载验证在 PR 创建后完成，未拿本地进程夹具替代。

Assisted-by: LLM
AI-Agent: OpenAI Codex
