# Issue #13 结果完整性与历史配色修复

修复起点：`cbf92efa9bd901db9296e9445720202fbfb3458f`。整分支双轴复审基线：`9a48276e3543657e4d6031db94ee43e1bdaa500a`，最终源代码审查树：`1bf6983f86c3a6aad8e23d43ea7b0a303198c800`。树之后仅补证据与文档，提交前再次固定索引树。

## TDD 与结果

测试接缝沿用用户已确认的 `openWorkspace/load` 公共接口及真实 Chrome 页面；文件系统仅在公共边界注入故障数据。每项先失败、保留日志，再实现并运行定向验证。

- **P2 结果校验**：先复现不支持的版本、结果与快照/配置矛盾、诊断格式错误在摘要匹配后仍被接受。`result-*-red.txt.gz` 保留各轮失败。现在拒绝不支持的版本及错误类型；逐项核对状态、规则、执行模式、资格、稳定/耐久结论及最终状态。终止快照也核对最后原始样本。合法 JSON 属性换序不会误报，历史诊断值原样保留，不用当前算法重算或覆盖过去结果。
- **P3 历史配色**：真实 Chrome 读取历史 Canvas 像素，修复前速度/角度/角速度对应色的像素数均为 0，见 [color-red.tar.gz](color-red.tar.gz)。主界面和历史现在共享 `signalColors`：位置蓝、速度青、角度棕、角速度紫。最终浏览器验证四张图各找到 4,280 个对应颜色的实心像素。
- **复审发现的 CSV P2**：此前非法布尔文本会变成 false、空数值会变成 0，仍可能显示 sealed-verified。先补 [csv-cells-red.txt.gz](csv-cells-red.txt.gz)，再在转换前校验布尔、有限十进制、控制模式/阶段与饱和原因；拒绝非法单元而不补值。所有新输入回归都更新了摘要，确保检验的是格式/引用关系，而不只是散列变化。

## 最终验证

- `npm run check`：120 项测试全部通过，格式、文档、类型检查、构建通过，见 [check.txt.gz](check.txt.gz)。工作区公开接缝共 15 项测试通过，包含三档采样、600 秒暂停封存、正常历史及新输入拒绝回归。
- 最终生产构建的真实 Chrome 原生授权目录、Worker、磁盘写入与历史读回、开始/继续确认前后台暂停、真实标签切换及颜色像素回归通过。最终封存 24 条样本、7 条事件，含三次后台暂停及两次显式继续。
- 源代码摘要：`d1aeca33cc9007e55fdbea140ec4b3276a110ff6b6595a7a5c733121b17a2768`，`source_dirty=true`。这是提交前最终源码的实际验证；后续提交仅包含该源码及验证材料，不冒称测试来自提交后 SHA。
- Chrome 内存研究回归通过，证据见 [memory-browser-green.tar.gz](memory-browser-green.tar.gz)。
- 最终整分支独立双轴复审：Standards 0 项，Spec 0 项未解决。CSV 初审发现已修复后复审；正常有限数字（含科学计数法）及现有写入枚举均可读。复审未修改工作区。

浏览器索引：[browser-summary.json](browser-summary.json)；完整步骤、事件与截图：[browser-green.tar.gz](browser-green.tar.gz)；最后一次原生目录实验的实际文件：[final-native-workspace.tar.gz](final-native-workspace.tar.gz)。原生选择动作日志含本任务前后操作，见 `native-picker-steps.jsonl.gz`。目录选择沿用用户授权的 System Events；没有伪造 picker、Worker 或句柄。

旧轮次的未解决说明及原始失败材料保留为历史。当前上述 P2/P3 均已处理；跨实例独占、完整崩溃恢复等延期边界保持原任务范围。

Assisted-by: LLM
AI-Agent: OpenAI Codex
