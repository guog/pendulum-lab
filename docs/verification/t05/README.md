# T05 标准工况首次稳定研究记录

使用与简单工况相同的已版本化 `swing-energy-1` 控制器，未修改增益或启动规则。标准配置采用 QV-1 原始参数，初态为精确静止下垂，候选时限 60 秒。真实 macOS Chrome Headless、localhost 页面运行的首次连续稳定区间为 4.876–9.876 秒。页面下载、清单校验与读回确认后，快照资格为 `eligible`；限力区间和其余原始事件保存在导出包中。

- `before-confirmation.json.gz` 与 `after-confirmation.json.gz` 是同一次标准实验读回前后的真实下载；`browser-steps.jsonl` 和 `result.png` 记录操作及页面。
- `simple-regression.json.gz` 和 `simple-browser-steps.jsonl` 记录另一条简单工况浏览器运行，首次稳定时刻 12.008 秒，两次记录的实验及配置相互独立。
- `build-info.json` 如实标记构建时源码有未提交变更；`build-inputs.tar.gz` 保存实际构建输入，按 `scripts/build-identity.ts` 的规则重新计算得到相同 SHA-256。该摘要不声称当时 Git 工作树干净。
- 这是内存研究结果，导出包的 `formal_acceptance` 为 `not_eligible`；不代表目录持久化、故障恢复、耐久、扰动或完整产品验收通过。浏览器记录是 10 ms 采样，逐物理步判定由同一实现执行，不构成独立物理模型验证。

本次由 OpenAI Codex 实现、运行并整理；仍需人类审查。

Assisted-by: LLM
AI-Agent: OpenAI Codex
