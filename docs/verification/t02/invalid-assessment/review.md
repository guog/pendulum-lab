# 无效实验误差与阈值说明

合并前新出现的[Sourcery Medium发现](https://github.com/guog/pendulum-lab/pull/19#discussion_r4450687871)指出：无效项目metrics为空，页面没有误差未计算和阈值适用性的说明。独立Spec复核认定为P2展示与可审计性缺口，故在用户“没问题就合并”条件下先修复。

沿用已确认公开会话/导出边界：新增回归先在旧实现因assessment缺失而失败（red.txt），再补最小assessment元信息通过（green.txt）。标准rotation保留invalid和空metrics，明确实际/要求时长与完整窗口误差不可评估，列出原冻结阈值、单位及依据；故意数值异常标not_applicable，说明安全冻结期望与物理通过阈值不适用。人工终止显示不可评估，未开始项目仍为not_executed。公开输出和results.json保持一致，UI展示相同说明。不对前缀伪算完整窗口误差，不填actual=0，不改输入、轨迹或阈值。

完整检查、真实浏览器及固定基点全量复审结果完成后补记。本轮不处理既有P3，不启用自动合并；docs/origin/保持原样。

OpenAI Codex执行TDD修复与证据整理，用户已在会话授权无阻塞问题时合并。

Assisted-by: LLM
AI-Agent: OpenAI Codex
