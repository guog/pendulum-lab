# T04 自动起摆验证记录

Issue #9；本记录由 OpenAI Codex 生成。候选控制器为 `swing-energy-1`；冻结的算法、增益、滞回、启动脉冲和单次 10 ms 预算见导出包的 `controller.json`。整定期间曾试用无阻力工况及不同切换参数；该探索不作为验收，未保留完整轨迹。最终受测工况采用简单预设和规定阻力（0.2 N、0.1 N·s/m、0.002 N·m·s/rad），未改初态或阈值。

- 真实浏览器：macOS、Google Chrome 156 Headless、localhost；执行 `BROWSER_ARTIFACTS_DIR=<目录> node scripts/browser-swing-up.mjs`。构建身份和浏览器 user agent 保存于证据包。
- 物理步 1 ms，控制及采样周期 10 ms。首次进入最终连续合格区间为 7.008 s，首次完整五秒为 12.008 s；期间没有触边或超速资格取消。运行结果、完整原始采样、事件、快照、配置摘要和清单见 `swing-up-evidence.json.gz`。
- 浏览器运行从标准工况切换到自动起摆，核对选择器锁定为简单工况；下载后重新读取实际文件并校验。`result.png` 为导出校验前候选快照提示，`browser-steps.jsonl` 保留页面操作过程。
- 这是单次内存研究及导出证据；不代表工作区恢复、后续扰动、耐久、正式重复批次或完整产品验收通过。快照初始标记为等待导出校验，导出包本身不声称已成功持久化。构建时源树有待提交变更，以包内源码 SHA-256 标识实际受测输入。
- 仓库检查 `npm run check` 与会话行为测试已执行；该检查不替代真实浏览器和磁盘故障验收。

Assisted-by: LLM
AI-Agent: OpenAI Codex
