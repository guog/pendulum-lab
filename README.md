# Pendulum Lab

一阶倒立摆网页仿真与自动控制系统，目前处于需求整理与技术可行性验证准备阶段。
尚无应用实现或已通过的仿真验收结果。

## 仓库导航

- [贡献与工程约定](CONTRIBUTING.md)：提交、分支、PR、CI 与版本管理。
- [代理指引](AGENTS.md)：工程技能的配置入口。
- `docs/origin/`：本地需求来源材料；保持原样，是否纳入版本控制单独处理。
- `docs/agents/`：Issue 跟踪、分诊标签与领域文档消费规则。
- `.agents/skills/`：已安装的工程技能。

## 本地检查

使用 `.nvmrc` 指定的 Node.js 版本，以及 npm：

```sh
nvm use
npm ci
npm run check
```

`npm ci` 安装仓库检查工具并启用本地 Git hooks。
`npm run format` 可格式化仓库维护文件。
应用工程建立后，再按选定技术栈增加类型检查、行为测试与构建。
