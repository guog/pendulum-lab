# AI 来源披露

## 适用范围

所有由 AI 创建或实质修改的 commit message、Issue、PR、评论、审查结论、Release 和发布说明，
都要明确披露 AI 参与。小改动也按本仓库约定披露。
署名描述本次动作与产物的来源，是透明度声明；密码学签名另行管理。

在既有正文上追加修改时，保留历史来源信息，并说明本次 AI 修改范围。
涉及多个代理时，AI-Agent 值可用分号列出各代理；未知模型版本应省略，不推测。
任何工具都不能冒称人类已审查、批准或完成 DCO 认证。

## AI 产物的统一尾注

在正文最后用空行分隔纯文本尾注，放在代码块、引用和 HTML 注释之外：

```text
Assisted-by: LLM
AI-Agent: OpenAI Codex
```

Assisted-by 使用 Linux 内核当前指引中的 LLM 值；AI-Agent 是本仓库增加的工具识别字段。
代理名称必须反映实际使用情况；其他代理填写自己的真实名称。
说明文字应交代 AI 执行的范围、实际验证以及仍需人类完成的事项。
commit message 保持约定式标题，署名放入正文尾注；PR 标题保持简短，署名放在 PR 正文。

独立人类贡献使用以下声明，AI 参与时不能使用它：

```text
AI-Usage: none
```

普通确定性自动化使用以下形式；使用 LLM 的机器人仍应按 AI 披露：

```text
AI-Usage: automation
Automation-Agent: Dependabot
```

这些 AI-Usage 字段是本仓库约定，不能声称是 Linux 内核标准。

## 人类责任与 DCO

参考 Linux 内核的 AI 贡献指引：AI 不添加 Signed-off-by，也不替任何人认证 DCO。
人类贡献者自行完成理解、审查、授权与责任确认。AI 不以 Co-authored-by 或虚构邮箱代替来源说明。
本仓库目前不强制引入 DCO；现有项目许可证保持不变。

## 执行与自动检查

- commit-msg hook 先检查约定式提交，再检查来源尾注；代理应在提交前显式填写真实来源。
- PR CI 检查正文与本次全部提交的来源声明；PR 标题单独按 Conventional Commits 校验。
- Issue 表单要求来源披露；Issue 和 Issue/PR 普通评论事件触发只读检查。
- Issue 与评论的工作流只有合并到默认分支后才会响应事件；检查报告不能阻止 GitHub 发布正文。
- 审查评论、Release 与发布说明按本规则由作者显式附注，当前自动检查不覆盖这些接口。
- 空白 Issue 和 gh/API 操作同样受规则约束。使用 --body-file 传入包含署名的完整正文。
- Squash 合并使用 PR 正文作为提交正文；合并前确认最终正文仍包含正确的来源尾注。
- 检查只能验证声明格式和存在性，不能识别实际是否使用 AI，也不能证明人类审查完成。

AI 来源检查是主分支 PR 必需检查。来源缺失时补齐真实信息，再重新运行检查。
代理不会自动给他人的内容添加来源声明，或为了过检查而猜测来源。

## Dependabot 更新的接续流程

Dependabot 定期 PR 用于报告候选更新。其提交消息配置为约定式标题，但原生输出不携带本仓库的来源尾注；
因此来源检查预期会阻止直接合并这些 PR，不能通过伪造 AI 声明或放宽门禁解决。

维护者或代理从最新 main 创建 codex/build-编号-依赖名称 分支，重现候选更新：
使用 npm install 更新依赖及锁文件，或核验上游 SHA 后更新 Actions 引用。
新提交与 PR 按实际执行者填写来源尾注，引用 Dependabot 原 PR，并运行全部检查。
通过审查并合并替代 PR 后，关闭原机器人 PR，注明替代链接；关闭评论也携带执行者的来源声明。
本仓库暂不启用依赖自动合并。此接续流程保留来源要求，同时利用机器人发现更新。

[Dependabot 配置参考](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
提供标题前缀与 scope 定制；来源尾注由本仓库接续流程补齐。

## 历史披露

已经共享的历史提交保持原始 SHA。已知的 AI 产物补录至
`.github/ai-provenance-legacy.json`，作为显式、可审查的历史披露例外。

- `ee6df9ef1a848a0a528f7a4a5c93a3cc39e6da8f`：由 OpenAI Codex 完成仓库工程初始化、生成文档和配置、运行检查并提交；原提交漏写尾注，在本次补录。
- PR #1：原正文由 OpenAI Codex 撰写，后有 Sourcery 自动摘要；现补充 AI 来源尾注。

历史例外仅用于已确认来源的既有提交。新增提交直接携带尾注。
初始提交及用户自行安装技能的历史提交来源未确认，不作 AI 归属推断。

## 参考来源

本规则采用本次核对的 Linux 内核透明披露与人类责任原则，并扩展至本仓库协作内容：

- [AI Coding Assistants](https://cdn.kernel.org/doc/html/latest/process/coding-assistants.html)
- [Kernel Guidelines for Tool-Generated Content](https://cdn.kernel.org/doc/html/latest/process/generated-content.html)
- [Linux Foundation guidance](https://www.linuxfoundation.org/legal/generative-ai)

各项目要求可能不同，后续以原始官方文档的当前版本为准。
