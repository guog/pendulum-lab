# T06 稳摆耐久研究记录

在 macOS Chrome Headless 和 localhost 上，简单与标准冻结工况分别从首次稳定继续无扰动运行：简单窗口 12.008–32.008 秒，标准窗口 9.876–29.876 秒。两份浏览器原始证据保存在 `simple-browser.json.gz` 和 `standard-browser.json.gz`，包含配置、样本、事件、首次稳定快照和独立耐久结果；脚本核对了下载清单，并对快照执行读回确认；确认后的第二次导出分别保存在 `simple-confirmed.json.gz` 和 `standard-confirmed.json.gz`。截图及步骤日志对应首次下载前的页面。浏览器运行时构建标记为源码有未提交变更，见 `build-info.json`；之后修正了页面时间分母，该修正不在这两次浏览器构建中。

随后在补充合成会话接口后的源码上重新执行简单工况 Chrome 回归，`simple-final-confirmed.json.gz` 是读回确认后的证据，`simple-final-steps.jsonl` 是操作日志。证据中的构建输入 SHA-256 与本次源码一致；该运行仍为内存研究，标准工况浏览器证据来自此前的构建。

`controller-error.json.gz` 是 Node 会话中人为模拟控制器预算超时的失败记录，包含首次稳定快照、控制异常与耐久失败事件；它不是自然发生的控制器故障，也不是浏览器记录。

会话测试通过合成轨迹重现单步阈值越界、截止时刻触边和截止时刻控制异常；三份 `synthetic-*.json.gz` 保留合成输入、事件、样本与结果。合成轨迹不是自然物理实验，不赋予扰动资格，也不用于声称物理稳定通过。单元测试另覆盖手动与后台暂停、规则边界及两工况自然运行。记录为内存研究，不代表正式工作区持久化或完整产品验收。

本记录由 OpenAI Codex 实现、执行与整理；本次补充合成会话边界测试及证据，仍需人类审查。

Assisted-by: LLM
AI-Agent: OpenAI Codex
