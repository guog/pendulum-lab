# 无效实验误差与阈值说明

合并前新出现的[Sourcery Medium发现](https://github.com/guog/pendulum-lab/pull/19#discussion_r4450687871)指出：无效项目metrics为空，页面没有误差未计算和阈值适用性的说明。独立Spec复核认定为P2展示与可审计性缺口，故在用户“没问题就合并”条件下先修复。

沿用已确认公开会话/导出边界：新增回归先在旧实现因assessment缺失而失败（red.txt），再补最小assessment元信息通过（green.txt）。标准rotation保留invalid和空metrics，明确实际/要求时长与完整窗口误差不可评估，列出原冻结阈值、单位及依据；故意数值异常标not_applicable，说明安全冻结期望与物理通过阈值不适用。人工终止显示不可评估，未开始项目仍为not_executed。公开输出和results.json保持一致，UI展示相同说明。不对前缀伪算完整窗口误差，不填actual=0，不改输入、轨迹或阈值。

## 完整验证

44项npm run check测试、格式、Markdown、类型、生产构建均通过。构建来自已提交3f5f2ad，source_dirty=false。真实Chrome 156.0.8078.80的T01流程通过；随后T02启动CLI超时，日志保留为browser-launch-failure.txt。使用同一缓存agent-browser@0.41.1关闭网络解析后单独重跑T02通过，未换浏览器或放宽断言。T01/T02来自同一构建，各自实际执行结果见[verification.json](verification.json)。

真实页面展开无效项目并验证说明，实际下载results.json验证assessment，手动暂停、后台暂停、下载/错误文件拒绝/读回、可访问性全部通过。[简单包](simple-benchmarks.json.gz)及[标准包](standard-benchmarks.json.gz)保存本次实际原始文件；32份CSV与pause-reason上一轮逐字节一致。简单15通过/1无效，标准14通过/2无效，输入和数值结论未改。9个未跟踪来源文件的列表和SHA-256保持不变。

源码3f5f2ad的[PR CI 41574334968](https://github.com/guog/pendulum-lab/actions/runs/41574334968)三项必需检查全通过；后续证据文档提交仍等待对应CI。

## 全量复审

两个全新上下文代理固定git diff 185a5a41bb5ec863968a3400271a333003c66f1e...3f5f2ad758a93a8bb9c9068e17c16004c3c67408，覆盖99文件及完整T01/T02，未仅复核最新补丁。后续提交只登记证据与审查结论，不改变被审应用源码或测试。

## Standards

硬性违反0，新增P1/P2为0。保留3项非阻断P3：应用质量属性重复、下载/读回流程重复、字符串基准ID与assessment阈值分支。旧清单构造及浏览器执行器重复建议也继续暂缓。最新assessment与原冻结阈值一致，未发现冲突。该代理只读静态审查，没有重复浏览器或修改文件。

## Spec

未解决可行动问题0。逐项输入/误差/阈值/结论与导出要求已由真实不可评估/不适用说明补齐；manual/background透传、暂停时间、完整窗口与异常诊断边界符合规格。该代理独立运行8项基准、生命周期与无效说明测试，全部通过，未运行浏览器。控制/执行器/持续记录/恢复仍为后续任务。

本轮不处理既有P3，不启用自动合并；docs/origin/保持原样。远端新Medium线程在修复、公开回归、实际Chrome和全量复审完成后标解决，最终CI通过后按用户条件授权合并。

OpenAI Codex执行TDD修复与证据整理，用户已在会话授权无阻塞问题时合并。

Assisted-by: LLM
AI-Agent: OpenAI Codex
