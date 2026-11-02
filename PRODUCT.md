# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

T01当前实现选型为TypeScript、原生HTML/CSS及Vite，采用浏览器Worker隔离计算。已确认QV-1允许维护良好的前端技术，不要求特定框架；具体选型是本次实现决策，不倒称原访谈指定了该框架。技术栈偏好问题已提出，未将未答复记作用户对具体选型的确认。

## Users

实验者与项目负责人，希望快速判断约定倒立摆模型是否可信，以及控制目标是否可达，并能独立检查原始证据。

## Product Purpose

在真实动力学、有限执行器与导轨约束下研究一阶滑块倒立摆。当前T01只交付自由运动基准、最小实验台与内存记录显式导出，不实现自动起摆或目录持续保存。

## Operating Context

首次验证组合为macOS、桌面Chrome、localhost静态启动，用户保证本机一个应用实例、一个窗口与一个标签页。完整产品仍以Windows/macOS的Chrome/Edge为目标，其他组合按QV-1后置。

## Capabilities and Constraints

- 最小中文工程实验台，简单/标准预设，明确标注的零阻力释放与静止下垂基准。
- 物理时间独立于显示和现实时间，默认1ms物理步和10ms记录；暂停与后台暂停不推进。
- 内存研究需用户明确导出后才形成可保存证据，不承诺崩溃保全或工作区独占。
- 四状态、模型参数、真实样本与事件、版本化结果是可检查的事实，不用预设动画或隐藏扰动制造效果。
- 不包含移动端专项支持、二阶动力学、真实装置安全认证、云端实验存储、自动上传或服务器物理计算。

## Evidence on Hand

[已确认需求QV-1](https://github.com/guog/pendulum-lab/issues/4)、[逐项来源追踪](https://github.com/guog/pendulum-lab/issues/5)及[当前任务T01](https://github.com/guog/pendulum-lab/issues/6)。规格中的性能、物理和控制阈值不等于已通过的验证结果。

## Product Principles

- 用原始证据解释结果及失败，不能为达标静默改参数、阈值、初态或采样。
- 模型、控制、保存及界面能力分别说明验证范围。
- 快速阶段优先最小闭环，完整产品延期要求继续保留。

本记录由OpenAI Codex据本次已确认规格与实现范围整理，不新增产品承诺。

Assisted-by: LLM
AI-Agent: OpenAI Codex
