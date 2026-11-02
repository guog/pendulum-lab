# Issue tracker: GitHub

本仓库的任务和规格存放在 guog/pendulum-lab 的 GitHub Issues。
使用 gh CLI 操作。创建或修改 Issue、PR 和评论时，按 `docs/agents/ai-provenance.md` 在正文末尾添加来源尾注。

## 操作约定

- 每次会话首次创建 Issue 前，执行 `gh repo view --json nameWithOwner`，
  核实目标为 guog/pendulum-lab；操作时显式传入 `--repo guog/pendulum-lab`。
- 创建：`gh issue create --title "..." --body-file <file>`。
  多行正文写入临时文件，保留真实换行。
- 读取：`gh issue view <number> --json number,title,body,labels,comments`。
- 列表：`gh issue list --state open --json number,title,body,labels,assignees`。
  按需使用 --label 和 --state 筛选。
- 评论：`gh issue comment <number> --body-file <file>`。
- 标签：`gh issue edit <number> --add-label "..."` 或 `--remove-label "..."`。
- 关闭：先发表评论说明结果，再执行 `gh issue close <number>`。

## 父子任务与依赖

优先使用 GitHub 原生 sub-issues 和 issue dependencies，通过当前版本
gh 支持的命令或 gh api 操作。API 中要求的数据库 id 通过
`gh api repos/guog/pendulum-lab/issues/<number> --jq .id` 获取。

原生功能不可用时：

- 子任务正文顶部写 `Part of #<parent>`，父任务正文维护子任务列表。
- 被阻塞任务正文顶部写 `Blocked by: #<number>, #<number>`。

所有阻塞任务关闭后，该任务才可开始。原生依赖的未关闭阻塞数可通过
`gh api repos/guog/pendulum-lab/issues/<number> --jq .issue_dependencies_summary.blocked_by`
查询。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## 技能用语

- “publish to the issue tracker”：创建 GitHub Issue。
- “fetch the relevant ticket”：读取对应 GitHub Issue。

## Wayfinding operations

- Map：使用 wayfinder:map 标签的单个 Issue，维护 Notes、
  Decisions-so-far 和 Fog。
- Child ticket：作为 Map 的子任务，使用 `wayfinder:<type>` 标签；
  type 为 research、prototype、grilling 或 task。
- Frontier：按 Map 中的顺序，选择首个未关闭、没有未关闭阻塞项、
  且尚未分配负责人的子任务。
- Claim：执行 `gh issue edit <number> --add-assignee @me`。
- Resolve：发表评论记录结果，关闭子任务，再向 Map 的
  Decisions-so-far 追加结论摘要及链接。
