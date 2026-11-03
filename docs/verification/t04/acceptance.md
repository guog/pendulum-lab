# Issue #9 独立研究结果与历史记录处置

2026-11-03，用户确认没有早期两次零阻力探索的完整备份，接受保留这一历史缺口，并以之后完整冻结和验证的批次作为 Issue #9 的研究结果。该决定不把重跑数据称作历史原始记录，也不改变原阈值、初态或其他验收条件。

## 逐项证据

- **初态及主动起摆：**`clean-batch/after-confirmation.json.gz` 的配置和首个样本记录 `x=0`、`v=0`、`theta=+π`、`omega=0`，控制器请求力与实际力均为 1 N。
- **控制器及冻结：**源码 `src/controller.ts` 提供初始化、周期更新、诊断状态、状态恢复和 reset；`tests/swing-up.test.ts` 覆盖状态恢复和重置。`clean-batch/freeze.json.txt` 在浏览器实验创建前记录控制器定义、增益、滞回、单次 10 ms 预算、工况和干净源码摘要；真实探索轨迹及源码见 `followup/tuning-gain18.json.gz` 和 `followup/tuning-source.tar.gz`。
- **四阈值及持续时间：**浏览器批次的事件记录 6.193 秒进入、6.267 秒重置、7.008 秒再次进入，12.008 秒首次完成；`clean-batch/audit-node-1ms.py.txt` 对同一实现的另一条 1 ms 采样运行逐步重算阈值及事件。该补充运行不是浏览器原始轨迹，也不是独立物理模型。
- **时限和异常：**浏览器批次在 30 秒内完成，证据包中未记录触边、超速或控制器/数值异常；测试覆盖用户终止、非标准工况、控制预算超时和未确认导出等路径。逐项事件和输出见 `clean-batch/after-confirmation.json.gz`。
- **共同快照：**同一浏览器证据包的 `snapshot.json` 记录 12.008 秒的四状态、控制器内部状态、保持力、物理 tick、控制/采样相位及能量来源；文件读回确认前阻塞，确认后的导出记录资格为 `eligible`。
- **页面及导出：**`clean-batch/browser-steps.jsonl` 和 `result.png` 记录真实 Chrome 页面运行；`before-confirmation.json.gz`、`after-confirmation.json.gz` 分别保存确认前后状态。页面路径还核验主动终止提示，证据包清单已逐文件校验。

## 已接受的限制

早期两次探索的原始 10 ms 样本和逐步事件没有备份。`recovered/` 保留可找到的每秒输出及第一次探索的失败反证；`replayed/` 是另行运行的轨迹，不是恢复的历史原始数据。用户接受的是如实保留这一历史缺口，不是声称缺失数据已恢复。

这是 #9 的独立内存研究结果；证据包的 `formal_acceptance` 为 `not_eligible`。它不代表目录持续保存、故障恢复、耐久、两种扰动或完整产品验收已通过；这些后续结论必须分别取得实际证据。人类仍需对实现及审查结论负责。

本记录由 OpenAI Codex 根据本次用户答复、固定规格和已保存证据整理。

Assisted-by: LLM
AI-Agent: OpenAI Codex
