# T04 审查修复验证

针对 #9 的复审，修复非标准配置资格、控制器异常时约束区间、主动终止分类、失败原因展示及导出读回后的资格状态。物理候选结果与证据确认后的结论分别记录；用户终止列为无效并保留独立原因。

另在 Node.js 中使用同一模型与简单工况，实际运行独立探索控制器 `swing-energy-trial-gain18`：相对于 `swing-energy-1` 仅将能量增益由 20 改为 18，控制器版本随之改变；30 秒内未达到首次稳定。完整配置、控制器定义、采样及事件保存在 `tuning-gain18.json.gz`。试验直接以 Node.js 从临时目录运行，包内构建身份为空；实际使用的完整源码保存在 `tuning-source.tar.gz`（SHA-256：`0437408bd6235ee5311a6e245e36888ef905efa72c9510377d72d8b75f2c7a54`），与当时的工作树源码比较仅 `config.ts` 的控制器版本和 `controller.ts` 的版本及能量增益不同。这是此次复审后的新探索，不能替代此前没有保存的整定轨迹，也不声称它在原受测批次之前发生。

真实 macOS Chrome Headless 页面复验从标准工况切换至简单自动起摆，12.008 秒物理时间首次完成五秒稳定；下载并读回校验后，再导出结果记录 `eligible`，用户主动终止页面提示也经验证。两次浏览器导出保存在 `browser-before-confirmation.json.gz` 与 `browser-after-confirmation.json.gz`；步骤和截图一并保存。`npm run check` 通过。

此前历史整定的每秒状态片段已从会话日志回收，见 `../recovered/README.md`；完整 10 ms 样本和事件仍不可恢复，该项验收在本记录写入时仍有证据缺口；用户随后于 2026-11-03 接受保留历史缺口并采用后续冻结批次作为 #9 研究结果，处置见 `../acceptance.md`。已有独立 Chrome 运行与本次复验不证明工作区崩溃恢复、扰动、耐久或正式重复批次通过。

本次由 OpenAI Codex 补充用户对历史缺口的后续处置及验收记录链接。

Assisted-by: LLM
AI-Agent: OpenAI Codex
