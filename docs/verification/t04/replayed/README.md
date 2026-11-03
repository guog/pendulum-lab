# 早期零阻力探索的隔离重跑

这两条是**新的重跑记录**，不是原运行的已恢复样本，也不能证明原运行的每个 10 毫秒状态或逐步事件。原运行实际保存下来的每秒输出和第一条探索的失败反证见 `../recovered/README.md`；完整历史采样仍缺失。

为检查可复现性，本次从提交 `c3f2aef140bd916f0569afe01528db5347f850a5` 的 `src` 和 `package.json` 开始，在两个独立临时目录中依次应用已回收的 `trial-01-setup.sh.txt` 及 `trial-02-controller-edit.py.txt`。使用 Node.js v26.7.0 分别新建会话，各推进 30 秒仿真时间并导出 3001 个 10 毫秒采样点。每次重跑的实际源码、导出包、SHA-256、实验 ID 和执行时间记录在 `summary.json`。

每条重跑的 30 个整数秒四状态与该条历史 stdout 对齐逐项比较，最大绝对差均为 0；每秒阶段和运行状态也一致。匹配不能排除这些观测点之间存在不同轨迹，因此不能把重跑样本标记为原始样本。两次使用零阻力工况，且当时两套控制器沿用了相同版本字符串，源码归档及各自文件名用于区分，不改变该历史事实。

`trial-01-replay.json.gz` 与 `trial-02-replay.json.gz` 是**本次新实验**的配置、样本、事件、结果和清单。旧版会话当时尚未实现首次稳定判定，两个导出均记录 `first_stable: not_executed` 和 `formal_acceptance: not_eligible`；导出中的完成状态只表示 30 秒运行结束，不能表示控制达标。此前对第一次历史探索的失败反证来自原始每秒输出，而不是这些重跑记录。

`replay.mjs.txt` 是本次运行及比较的脚本原文。重跑时以 Node.js 模块标准输入执行，依次传入隔离源码目录、对应原始 stdout 路径、新输出路径及 `../recovered/provenance.json` 中对应 stdout 的 SHA-256；例如：

```sh
node --input-type=module - "$replay_dir" docs/verification/t04/recovered/trial-01-stdout.txt /tmp/trial-01-replay.json 72d01f28280fd3bff4e343bff2c6f407ba7c85e2e49eab73932ff6e7ea27c3a4 < docs/verification/t04/replayed/replay.mjs.txt
```

脚本拒绝与所给摘要不一致的原始参考文件，且仅独占创建新输出文件，不覆盖已有路径。已用临时文件验证相同路径、硬链接、符号链接及其他已有文件均被拒绝；重跑时请为每次输出选择不存在的路径。该摘要只用于发现改动，不证明身份或抵抗同时改写数据与摘要。使用者应自行核对来源和范围；本次重跑不能替代真实 Chrome 受测批次、扰动或目录恢复证据。

本次由 OpenAI Codex 构建隔离目录、运行比较并保存结果，仍需人类审查。

Assisted-by: LLM
AI-Agent: OpenAI Codex
