# 贡献与工程约定

## 当前阶段与来源资料

仓库当前维护需求资料与工程工具。新增应用实现需明确开发授权，并遵守需求中的阶段闸门。
`docs/origin/` 是原始需求来源，工程初始化和格式化保持其内容不变。
第三方 `.agents/skills/` 与 `skills-lock.json` 由技能安装流程维护。

## 提交规范

使用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：

```text
type(scope): 描述
```

scope 可省略，描述可使用中文。类型由 `@commitlint/config-conventional` 校验。
常用类型为 feat、fix、docs、test、refactor、ci、chore、build、perf、style、revert。
破坏性变更使用 `!`，并在正文的 `BREAKING CHANGE:` 中说明影响与迁移方法。
一次提交聚焦一个完整改动；关联任务写入正文或 PR。

```text
chore(repo): initialize engineering conventions
feat(simulation): add fixed-step integration
fix(storage): preserve committed data after interruption
```

`npm ci` 启用 pre-commit（运行仓库检查）和 commit-msg（校验提交信息）hooks。
PR 标题使用相同规范，由 CI 校验，作为 squash 合并的最终提交标题。

## AI 来源署名

AI 创建或实质修改的提交、Issue、PR、评论、审查与发布说明必须署名。
具体格式、非 AI 来源声明及历史补录规则见 [AI 来源披露](docs/agents/ai-provenance.md)。
AI 使用 `Assisted-by: LLM` 与真实 `AI-Agent` 尾注；人类独立贡献使用 `AI-Usage: none`。
AI 不代人类添加 Signed-off-by；披露不能代替人类审查与批准。

## 分支与审查

采用 [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)：
短期任务分支 → PR → CI 与审查 → 人类批准 → squash 合并到 main。
每个分支只承载相关变更，合并后删除。main 保持可检查、可继续开发。

分支统一为 `codex/<type>-<issue-number>-<description>`；没有 Issue 时省略编号。
例如 `codex/feat-42-fixed-step-integrator` 或 `codex/chore-repository-initialization`。
这将来源规格中的 feat/、fix/ 前缀示例具体化为环境要求的 codex/ 前缀，类型保留在其后。
来源规格的原文保持不变；如正式基线要求字面前缀，先记录并解决冲突。

PR 说明问题、最终变更、关联需求、真实验证结果、风险及回退方式。
CI 通过与代理审查均不能代替人类合并批准。

## 检查范围与命令

```sh
npm ci
npm run check
npm run format
printf '%s\n' 'docs: update contribution guide' | npm run lint:commit
```

`check` 执行格式检查、Markdown lint 与来源校验工具测试。配置排除了来源资料、第三方技能及锁文件的格式化。
依赖锁文件仍由 `npm ci` 校验安装一致性。
package.json 暂时覆盖 re2js 与 katex 至安全修复版本；上游解除受影响版本锁定后移除对应 overrides。
当前没有应用测试、构建或性能验收；应用建立后增加真实检查，再纳入 CI。
保留原有 Prettier 风格配置，以 `package.json` 中的脚本作为命令来源。

GitHub Actions 在 PR、main 与 codex/ 分支推送时运行；手动运行入口在工作流进入默认分支后可用。
PR 标题通过环境变量传入校验命令。依赖的 Actions 固定到提交 SHA，Dependabot 每月检查更新。

Dependabot PR 用作候选更新通知；缺少来源声明时，按 [来源规则中的接续流程](docs/agents/ai-provenance.md#dependabot-更新的接续流程) 在维护分支重现更新，通过检查后合并替代 PR。

## 版本与兼容性

软件发布遵循 [SemVer 2.0.0](https://semver.org/)，初期使用 0.y.z。
package.json 的 0.0.0 是未发布占位；首次可运行预览才发布 0.1.0。
0.x 阶段的本仓库约定：兼容修复递增 patch，功能或破坏性变更递增 minor，破坏性变更写明迁移影响。
1.0.0 表示已明确并承诺稳定的公开接口；之后不兼容变更递增 major，兼容功能递增 minor，兼容修复递增 patch。

公开兼容性边界应包含导出接口、用户可观察的行为及持久化文件契约。
SRS 修订号、软件发布号和工作区 schemaVersion 分开管理；读取兼容性由文件格式契约判断。
已发布标签及产物保持不可变，修复通过新版本发布。

发布通过专门 PR 更新版本号、锁文件和 CHANGELOG，记录兼容性与迁移说明。
CI 通过且人类批准后合并，在确认的提交上创建 vX.Y.Z 标签及 GitHub Release。
目前只建立人工发布约定，不自动打标签、发布包或部署。

## GitHub 合并门禁

主分支目标策略：PR 合并，必需检查为 `Repository checks`、`PR title` 与 `AI provenance`，禁止强推与删除。
人工批准是工作约定；若有第二名维护者，再启用至少一名独立审批人的强制要求。
仓库保护属于 GitHub 设置，工作流文件本身不会启用它；以仓库实时设置为准。

## Issue 与领域文档

任务、规格、分诊使用 `docs/agents/` 已确认的配置。
领域词汇与决策在实际确定时由对应技能写入 GLOSSARY.md 与 docs/adr/。
配置维护可直接编辑 docs/agents/*.md；切换任务跟踪方式或重置配置时再运行初始化技能。
