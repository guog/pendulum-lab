# Domain Docs

## 布局

采用 single-context：

- 根目录 GLOSSARY.md：领域术语。
- docs/adr/：架构与领域决策。

## 读取规则

探索代码库前，读取 GLOSSARY.md，以及与当前工作相关的 ADR。

文件尚不存在时静默继续；由 domain-modeling 技能在术语或决策
实际确定后按需创建。

## 使用术语

Issue 标题、设计建议、假设和测试名称使用 GLOSSARY.md 定义的术语。
发现术语缺口时，交由 domain-modeling 澄清。

## ADR 冲突

建议与已有 ADR 冲突时，明确指出 ADR 编号、冲突内容和重新讨论的理由。
