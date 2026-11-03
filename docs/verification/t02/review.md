# T02验证与审查记录

本轮仅实施[#7](https://github.com/guog/pendulum-lab/issues/7)。依据[#4](https://github.com/guog/pendulum-lab/issues/4)、[#5](https://github.com/guog/pendulum-lab/issues/5)、[T01实现与记录契约](../../design/t01-implementation.md)及其历史验证继续工作。未跟踪docs/origin/的文件列表和SHA-256在开始、结束时比较，保持原样且未纳入提交。

## 审查基点与范围

会话开始时HEAD为185a5a41bb5ec863968a3400271a333003c66f1e，按用户要求固定为审查基点。随后fetch得到最新origin/main为58083b53b3c50a877cf9190595fbc95defbd96f2，在其上新建codex/feat-7-physics-benchmarks。全量审查使用git diff 185a5a4...HEAD；其中58083b5是已合并T01，本轮#7的增量另以58083b5...HEAD定位，不把T01重新算作本轮交付。

Standards与Spec独立代理审查结论在审查完成后登记；本提交前不冒称已完成审查。

## 实际执行

- npm run check：39项测试（21项工程工具、14项既有会话行为、4项新增完整基准行为）、格式、Markdown、类型及生产构建通过。
- npm run test:browser：真实macOS15.8.2、arm64、Apple M1 Max、32GiB、已安装Google Chrome156.0.8078.76，localhost静态资源服务。配置保存真实UA；系统版本来自宿主命令，不根据Chrome缩减UA推测。
- 页面分别执行简单、标准每工况16项；实际下载完整配置、原始CSV、事件、结果、参考和两级SHA-256清单，逐文件核对身份、长度和摘要。下载后仍显示未确认，错误文件拒绝，选取实际文件读回后才确认导出。
- 页面显示逐项输入、误差、阈值与五种结论；展开长配置可键盘聚焦和滚动。1440px及1100px桌面检查；axe最终0项violation，SVG背景对比度需人工查看。
- T01原操作、暂停/继续/终止/重置、实际切页后台暂停、下载及1001点精确平衡回归继续通过。T02开始回执前后台暂停使用受控visibility事件检查，返回可见不自动继续；不冒称它是锁屏或真实极短切页时序证明。

实际文件[verification.json](verification.json)保存环境、批次UUID、源码身份和摘要；[简单批次](simple-benchmarks.json.gz)与[标准批次](standard-benchmarks.json.gz)为实际Chrome下载文件的gzip无损压缩，解压后的外层文件摘要见元数据，内层清单可独立按UTF-8字节复查。压缩只减少仓库体积，原始十进制样本未重采样或改精度。

源码身份source_revision记录构建时真实HEAD，source_dirty=true表示构建输入在该提交基础上已修改，source_sha256覆盖本轮实际应用输入。不得把构建时的旧HEAD当成已含本轮源码的提交；后续文档、证据和审查登记不进入应用摘要。

## 数值结果与边界

| 场景                  | 简单                | 标准                | 冻结候选阈值                |
| --------------------- | ------------------- | ------------------- | --------------------------- |
| 10s两步长最大累计角差 | 5.7650063×10^-10rad | 2.6593883×10^-10rad | ≤0.1°，约1.7453293×10^-3rad |
| 10s两步长最大车位差   | 1.9477774×10^-11m   | 1.4114585×10^-11m   | ≤1mm                        |
| 30s最大相对能量漂移   | 6.5849351×10^-11    | 2.7978254×10^-11    | ≤0.001（0.1%）              |
| 全部16项状态          | 15通过、1无效       | 14通过、2无效       | 分项结论，不作全部通过汇总  |

精确下垂/倒立均无状态偏差；自然下落、零水平总动量多圈、无配重/轴端/杆端配重、三种阻力分别及共同运行，通过解析关系及独立DOP853参考比较。参考自身两组精度设置的最大分量差为2.74838×10^-11(SI)，并非被测RK4与其自身比较。每项实际误差与依据均在原始结果中。

以下无效结果保持原输入与证据：

1. 标准rotation具有初始水平总动量，有限轨道内提前触边，不能完成原2s窗口。其四状态、触边时刻和事件保留，未通过延长轨道或裁剪速度修饰。新增不同ID的rotation-centered显式令总水平动量为零，完成多圈验证；原输入继续随每批执行和导出。
2. 两工况numerical-failure显式注入ω=10^50rad/s，首步出现非有限计算，状态冻结在t=0的最后有效初态，保留numerical_error诊断，CSV不含NaN/Infinity。安全冻结行为测试通过，物理轨迹仍为无效，不计物理通过。

这些结果仅支持本次冻结输入的P0-PHY-01～04覆盖，不是所有合法参数组合的数学证明。执行器与外力/力矩账本仍为零，#8及其后任务未实施；自动起摆、控制资格、持续落盘/恢复、严格独占、Windows/Edge和完整性能指标均不由本记录验收。

## 红绿与失败历史

- red-equilibria.txt、red-reference.txt、red-damping.txt、red-convergence-energy.txt：各公开会话基准切片先失败后实现，保留Node原输出。
- initial-batch.json.gz、red-rotation-boundary.txt：初版批次原输入、轨迹、结果及测试输出。均匀参考时刻不落在实际样本点造成缺失，最初标阻塞；修复为真实采样时刻计算独立参考，数值参数和阈值未变。保留真实触边及新增案例的版本说明见[实现契约](../../design/t02-physics-benchmarks.md)。
- red-browser-disclosure.txt：第二工况沿用了已展开的原生details，脚本再次点击将其关闭，因而读不到误差。修复测试为先读取open状态再决定点击；未改变应用判定。
- red-accessibility.json、red-browser-keyboard.txt：真实axe检测展开配置滚动区域缺少键盘焦点，给出1项violation；增加tabIndex=0及可访问名称后复测0项。

## Standards

待独立审查。

## Spec

待独立审查。

OpenAI Codex完成本轮实现、红绿测试、真实Chrome运行、原始文件校验和证据整理；代理审查不代替人类合并批准，软件未发布。

Assisted-by: LLM
AI-Agent: OpenAI Codex
