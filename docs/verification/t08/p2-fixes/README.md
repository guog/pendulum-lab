# Issue #13 两项 P2 定向修复

修复起点：`9057403b4ce0d3e35c2c01c05c483ced4f1dac09`。
整分支双轴复审基线：`9a48276e3543657e4d6031db94ee43e1bdaa500a`；源代码审查对象为暂存树 `f42ab44203f3e85540cc665e2f29622e088b5772`。
本轮只修复用户指定的两项 P2。复审对象后只补充证据与本说明；提交前固定并复核最终索引树。

## TDD 与修复

### 合法暂停提交超过 1,202 批

接缝：已确认的 openWorkspace/create/start/advance/pause/resume/load 公共接口；文件系统边界使用有界测试适配器。

先新增 600 秒 equilibrium、100 ms 采样、0.2 秒暂停后继续的回归。分别在 599、599.5、600 秒重新读取，覆盖旧上限前、上限处及超过上限后的完整封存。

- Red：最终封存报“非法实验清单”，失败证据 [batch-red.txt.gz](batch-red.txt.gz)。
- Green：600 秒、6,001 条样本、全部事件及快照一致，封存后重开通过：[batch-green.txt.gz](batch-green.txt.gz)。
- 修复：取消无法涵盖暂停提交的固定批次数上限；保留原有 16 MiB 清单限制，读写共享同一常量，发布清单前检查大小，避免写入读取端必定拒绝的清单。

### 启动确认前进入后台

接缝：已确认的真实 Chrome 页面按钮、可见性事件、状态与重新读取的事件记录。使用真实 Worker、原生授权目录及本地文件系统；没有替换 picker 或注入假句柄。

- Red：先通过真实界面复现。最终版本脚本又在 `9057403` 干净旧构建上作同脚本对照：隐藏后未暂停，25 秒等待超时，仿真仍推进到 14.128 秒。见 [visibility-red-original.tar.gz](visibility-red-original.tar.gz)。
- Green：最终脚本在修复后的生产构建上通过开始确认前隐藏、继续确认前隐藏、返回后保持暂停、真实切换标签页、正常封存及事件读回。前两次均停在 0 秒；最终封存 22 条样本、7 条事件，含 3 次 background 暂停和 2 次显式继续。见 [visibility-green-summary.json](visibility-green-summary.json) 与 [visibility-green.tar.gz](visibility-green.tar.gz)。
- 修复：页面隐藏时，对仍处于活动生命周期的实验排队暂停，不依赖尚未返回的 running 状态；Worker 仅对正在运行的会话执行暂停，重复暂停或终止后的迟到请求不再提交。
- 构建身份：修复后源摘要 `cda42ea8543fbf4b028914a47d7ca42016bbe50b9ffa25e57ccf19c7d64c59ee`，`source_dirty=true`，表示提交前修复源码的实际验证，不冒称提交后 SHA 证据。

执行方式：先启动 `localhost:5183` 生产预览，在命名的 Chrome 会话中明确选择测试目录，然后：

```sh
BROWSER_SESSION=<测试会话> BROWSER_ARTIFACTS_DIR=<证据目录> \
  node scripts/browser-workspace-visibility.mjs
```

脚本固定应用标签，避免活动标签变化导致读错页面。早期脚本还曾错误等待“隐藏时继续按钮可用”；已改为等待暂停状态及提交完成。标签漂移和错误等待条件的失败记录均保存在 [tooling-failures.tar.gz](tooling-failures.tar.gz)，不把它们当作应用失败或通过依据。最终同脚本红绿对照独立保留。真实目录记录（含失败实验）在 [native-workspace-files.tar.gz](native-workspace-files.tar.gz)。

## 检查与整分支复审

- `npm run check`：116 项测试全部通过，格式、文档、类型检查及构建通过，见 [check.txt.gz](check.txt.gz)。
- 真实 Chrome 内存研究回归通过，见 [memory-browser-smoke.tar.gz](memory-browser-smoke.tar.gz)。
- Standards：0 项规范违规，0 项需处理的代码异味。
- Spec：指定两项修复通过；整分支复审发现 **1 项其他 P2 未解决**：load 只核对 result 的实验标识、样本数与时间，没有充分检查结果版本、状态、规则版本及最终状态与快照的对应关系。将结果改为不支持的版本或矛盾状态并更新摘要后，仍可能显示 sealed-verified。这是已有的结构校验缺口，不是本轮两项修复引入的问题；本次按明确范围保留为待处理项。

新增 P2 已在修复前 `9057403` 和本轮修复后分别复现，脚本及输出在 [unresolved-result-validation.tar.gz](unresolved-result-validation.tar.gz)。

本轮固定对象当时尚不能宣称审查问题已全部清零。跨实例独占与完整崩溃恢复仍属后续任务，本次未扩展。

后续上述结果校验缺口、历史配色及 CSV 类型校验已修复，最新验证与审查结论见 [后续修复记录](../result-color-fixes/README.md)。本页保留为本轮历史。

Assisted-by: LLM
AI-Agent: OpenAI Codex
