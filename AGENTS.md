# Repository instructions

提交、分支、PR、检查或发布前，读取 `CONTRIBUTING.md` 并遵循其中的工程约定。

提交、创建或更新 Issue/PR、评论、审查及发布说明前，读取 `docs/agents/ai-provenance.md`，在本次 AI 产物末尾披露真实来源。

审查实现或准备提交前，读取 `docs/agents/review.md`，固定审查对象并检查行为边界。
调用 code-review 审查尚未提交的实现时，固定基线与暂存树，使用 `git diff <基线SHA> <树SHA>` 代替技能中比较 HEAD 的命令；其他双轴审查步骤仍照常执行。提交前确认索引树未变。

## Agent skills

### Issue tracker

任务与规格使用 guog/pendulum-lab 的 GitHub Issues；操作前读取 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认分诊标签；分诊前读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context 布局；探索领域概念或设计决策前读取 `docs/agents/domain.md`。
