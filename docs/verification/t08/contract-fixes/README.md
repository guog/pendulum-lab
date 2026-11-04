# PR #28 目录记录版本契约修复

修复起点：`7e91d6629865b01ed005fe9f25f6843eb098ad1e`。整分支审查基线：`9a48276e3543657e4d6031db94ee43e1bdaa500a`。

## TDD 与行为

沿用用户已确认的 `openWorkspace/create/load` 与 `WorkspaceFiles` 外部文件边界；逐项先失败再实现，没有另建内部测试接缝。

- 写入缺失：正常封存后，清单缺 `sample_schema_version`、快照缺顶层 `schema_version`、配置缺 `experiment_id`。失败见 [write-red.txt.gz](write-red.txt.gz)。现在写入 `1`、`1` 和对应实验标识，重开后的公开会话输出保持原语义。
- 采样版本：修复前清单版本 `999` 仍被接受，见 [sample-999-red.txt.gz](sample-999-red.txt.gz)；缺字段的失败另存于 [sample-red.txt.gz](sample-red.txt.gz)。现在拒绝缺失、null、0、999、字符串与小数，仅支持整数 1。
- 快照版本：重新计算摘要后，`999` 仍被接受，见 [snapshot-red.txt.gz](snapshot-red.txt.gz)。现在拒绝相同的一组非法版本，合法版本仍可封存、重开。
- 配置标识：摘要匹配但属于其他实验的配置被接受，见 [config-red.txt.gz](config-red.txt.gz)。现在拒绝错配、缺失、null、空串及非字符串标识，正确标识可读。

各项对应的 `*-green.txt.gz` 保留定向通过日志。失败案例更新文件长度与 SHA-256，确保检查的是版本或关联语义，而非散列不匹配。

## 验证与兼容性

- [check.txt.gz](check.txt.gz)：`npm run check` 通过，124 项测试全绿，包含 19 项工作区公开接口测试；格式、文档、类型检查与生产构建通过。
- Node 真实本地磁盘：10 ms / 1 ms 各 60 秒，分别 6,001 / 60,001 条样本；慢写 1.203 秒保存 1,204 条。正常重开并核对全部引用的长度和 SHA-256；新配置标识、清单采样版本及所有快照版本另外独立检查。见 [摘要](disk-contract-summary.json)、[完整清单](disk-evidence.json.gz) 和 [实际目录文件](disk-workspaces.tar.gz)。此项不是 Chrome FSA 验证。
- 本轮未重跑真实 Chrome 原生授权。之前浏览器材料保留为历史证据，不能冒称来自本轮源码。旧未发布记录缺少上述必需字段时现在明确拒绝读取，不自动补值、迁移或覆盖；原始记录保持不变。
- 本轮仅修复 PR 审查指出的文件契约 P2，单实例、崩溃恢复及损坏记录处置的范围不变。

## 整分支双轴复审

固定审查命令：`git diff 9a48276e3543657e4d6031db94ee43e1bdaa500a 56cfd8aea8f783a16bad4f790969a0936896db5d`。两位独立代理分别审查完整分支及本轮相对 `7e91d66` 的增量，未修改源码。

- Standards：明确规范违规 0 项，需处理的代码味道 0 项；核对 12 项启发式及红绿/真实磁盘材料。
- Spec：确定发现 0 项；版本及标识缺失/非法/合法恢复路径完整，另行实跑 19 项工作区测试通过。快照配置关联由清单配置摘要和逐值比较共同保证，不将延期恢复能力新增为门槛。

该树后仅补本文结论和入口文档；源码、测试与上述证据不变。提交前再固定最终索引树并检查文档增量。

Assisted-by: LLM
AI-Agent: OpenAI Codex
