# PR #31 启动保存故障恢复入口修复

审查发现：新空工作区已经创建初始记录，但 start 提交失败时，Worker 尚未刷新实验列表。原页面只能从列表选择恢复对象，因此冻结实验不能查看或导出。

现在故障进度带来的实验 ID 会补入历史选项；自动选择仍只在新实验首次出现时发生，用户显式选择其它历史保持有效。冻结、禁止继续/终止及显式重试规则保持原样。

## 红绿回归

- 红色：干净提交 `1ea5f4ac415c0bc56fb6e00c17d398ed75fe7e59`，真实 macOS / Chrome 156 / localhost:5198。原生授权新空目录，在生产 Worker 完成 create、尚未调用 start 时暂停；OS 将测试目录 tmp 设为0555，恢复执行产生真实 NoModificationAllowedError。页面冻结0秒，历史为空，恢复与导出禁用，回归测试按预期失败。
- 绿色：干净修复提交 `bea7393af2ba79bf028886154372918b337e12e5`，`source_dirty=false`，源码摘要 `be9ddee35b0134dfdf66822a0171edee244d55a0910393ca7cae67b0421ba043`。同一路径重新原生授权新空目录，页面选中冻结实验并可查看、下载；下载包含已确认0秒的 ready 快照（0样本），以及 live_fault 中尚未保存的首个样本、start/storage_error/pause 事件和最后有效状态。旧确认引用字节、长度及SHA-256保持一致。恢复原权限后重试保持暂停，随后终止并封存。
- 真实页面正常回归：同一干净修复构建通过开始/继续确认前切后台、真实标签切换、正常封存和四条历史曲线配色检查。
- 自动检查：公开工作区 API 新增启动失败、前缀恢复、故障诊断及重试封存用例；完整仓库检查147/147，格式、Markdown、类型检查及构建通过。真实页面回归入口为 `npm run test:workspace:start-failure`，前置条件见 [工具说明](../../../agents/workflow-tools.md#启动保存故障回归)，不在无人值守 CI 中冒充原生授权测试。

首轮绿色尝试实际下载已成功，但测试错误预期 ready 前缀含1样本而失败：首个样本实际仅在失败 start 的内存尾部。该失败、原下载和日志原样保留；只修正测试预期为持久化0样本、live_fault 1样本，再使用新目录重跑，不修改持久化实现或采样标准。

[红色页面](red.png) · [干净修复构建恢复页面](recovery.png)。`evidence.tar.gz` 保存旧审查复现、红色/错误预期/绿色/干净提交全流程、断点及Worker源码、浏览器JSONL、磁盘前后原件、实际下载与清理记录；`build-inputs.tar.gz` 为干净修复构建输入。`summary.json` 和 `independent-verification.json` 提供索引及独立文件核验；`check.log.gz` 保留完整检查输出。

## 复审与范围

沿用用户指定的 review-agent，主代理直接复审，没有委派或发布 GitHub 审查评论。完整PR基线 `5074fce45de89efe220fddd18adb8ca66aeef78a`，修复阶段基线 `1ea5f4ac415c0bc56fb6e00c17d398ed75fe7e59`；提交前固定完整索引树 `018a88385417548197172ec65501e9418b3ba094` 并确认提交前未变。Standards与Spec分别检查，均无新增可行动问题，原P2已由真实红绿回归验证修复。后续证据提交仅增加本目录和导航，应用构建输入与受测提交相同。

本次只修改页面恢复入口及回归测试，不修改目录写入、清单、故障冻结或恢复协议。三处强退、容量不足及Chrome实际撤权仍引用明确绑定 `6d826d4` 的 [原验收](../acceptance-6d826d4/README.md)，未冒称在修复构建上重跑。硬件断电、严格独占及全平台矩阵仍未验证，formal_acceptance仍为not_eligible。

本次由OpenAI Codex实现、测试、直接复审并整理，用户已授权修复验证及复审通过后合并PR；不发布软件。

Assisted-by: LLM
AI-Agent: OpenAI Codex
