# T03：受限执行器、外扰与导轨边界

对应[任务 #8](https://github.com/guog/pendulum-lab/issues/8)、[QV-1 #4](https://github.com/guog/pendulum-lab/issues/4)及[来源追踪 #5](https://github.com/guog/pendulum-lab/issues/5)。从origin/main的66f0c75开始，继承[T01会话与导出契约](t01-implementation.md)和[T02物理基准](t02-physics-benchmarks.md)，不改变来源资料、参数合法范围或正式控制判据。

## 受力输入与时钟

完整实验会话仍是页面、Node测试及基准的共同入口。配置新增可选input_program，按at_s记录force_requested_N、force_external_N和torque_external_Nm的一个或多个新保持值；未指定字段保持原值，缺省均为0。时间必须在观察窗口内且落在物理步边界，不静默舍入；数值必须有限，拒绝未知字段、空命令及超过10000条的程序。配置在创建时复制，与实验身份、模型及构建摘要一起导出。

调度先按整数物理步排序。同刻外扰置零先于外扰开始，随后更新预定请求力；同类命令保持数组序号。事件保留原command_index、计划时间、实际生效仿真时间、字段及数值。输入保持于相邻命令间，0.1秒外扰在[start,start+0.1s)有效。暂停不消费输入程序；继续不追赶墙钟，重置清空输入进度、做功、资格及事件。

受力基准显式使用prescribed模式，配置与样本一致；free模式拒绝非零执行器预定请求。这是冻结研究输入，不是自动控制器或通用手动控制界面。指定请求力可以在明确物理步边界改变；后续自动控制器的10ms更新与保持语义不在本切片实施。触边及数值错误优先于同刻后续输入，初始触边也不执行t=0输入。观察窗口结束后不再应用排队命令；终止样本保留入射区间的输入及真实部分步累计量。

## 执行器与分类能量

模型版本rigid-cartpole-rk4-3保留T01方程、坐标、质量分布及RK4连续插值，增加独立的执行器、水平外力、关节外力矩。每物理步及RK4各阶段重新根据当前车速计算实际驱动力：

1. 请求力裁限到±Fmax。
2. abs(v)≥vmax且Fv>0时实际力为0；允许反向制动。
3. abs(Fv)>Pmax时进一步将力限制到sign(F)Pmax/abs(v)，驱动和制动同样处理。v=0不进入除法分支。

不截断速度或坐标，不引入关节驱动电机，不建模电能回馈。外力与关节力矩不经过执行器限幅。速度阈值是实际状态的方向约束；RK4处理阈值附近的不光滑动力学仍有离散误差，不宣称证明连续系统绝无超速。任何观察到的超速均记录并取消资格，不能当作合格控制轨迹。

积分器以同一组阶段同时积分阻力耗散、执行器Factual·v、水平外力Fexternal·v和关节外力矩τexternal·ω。能量残差为E+D−E0−Wactuator−Whorizontal−Wtorque。external_work_J保留为两类外扰之和，两个分类列同时保存。触边的四状态与四个能量累计量取同一部分步连续插值，不能把完整步做功算入终止点。

原CSV列次序保持，末尾追加saturation_reasons（用竖线分隔原因）及saturated。逻辑文件新增reference.json；result.json追加actuation_assessment、qualification_reasons、condition_intervals。配置与研究包schema仍为1，扩展字段为兼容追加；模型、基准及判定版本独立记录。

## 逐步事件与终止

逐物理步检查限力、限功率、速度方向、超速与安全区。每个区间生成start/end事件，包含开始、结束、持续仿真时长及四状态。暂停时区间保持，持续时间只随仿真推进；终止关闭的区间标active_at_end=true，不能误称限制已经解除。超速原因记录入射区间的水平外力、关节外力矩、摆杆耦合、初态或执行器/步长跨阈值因素，不伪称单一因素已被因果隔离。

导轨仍以滑块中心为准，安全区使用冻结safety_buffer_m。安全区告警与超速/限制事件按物理步边界记录；只有实际触边使用步内定位，不宣称普通告警是精确连续穿越时刻。首次触边保留入射速度，无反弹；独立终止事件包含四状态和轨道边界。已有T01“步内越出又返回”的双向及双步长回归继续适用。

qualification_reasons是累积集合，超速恢复不清除历史违规；边界及数值异常同样取消资格。全部研究实验仍formal_acceptance=not_eligible，起摆、耐久、两种快照扰动恢复均not_executed。物理诊断通过不代表正式控制通过。

## 冻结基准与独立关系

actuation-qv1-1在src/actuator-benchmarks.ts定义简单/标准各10项，默认物理1ms、本切片公开高频采样1ms。除了下表明确覆盖，沿用工况质量、几何、轨道及零阻力设置；每份导出包含完整实际配置及覆盖项。所有初态明确标为诊断，不能冒充标准自动起摆或合格稳定快照。

| 基准               | 明确输入与窗口                                                                                  | 独立核验                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| near-zero          | g=0、水平杆、v=10^-12m/s，请求1N，0.2s                                                          | v=v0+Ft/S、x=v0t+Ft²/(2S)、W=FΔx                          |
| force-limit        | g=0、水平杆静止，请求2Fmax，0.02s                                                               | 实际Fmax，匀加速关系及执行器做功                          |
| power-drive/brake  | g=0、水平杆、v=1m/s，请求±40N、Pmax=5W，0.05s                                                   | v²−v0²=2Pt/S，W=Pt，制动负功率                            |
| speed-direction    | g=0、水平杆、v=vmax，前0.1s请求+10N、后0.1s请求−10N                                             | 前段不主动加速，后段解析制动                              |
| external-overspeed | g=0、水平杆、v=vmax−0.01，外力+10N@0、−10N@0.1、0N@0.2，0.21s                                   | 冲量抵消、真实超速与恢复、永久资格取消                    |
| coupling-overspeed | g=0、θ=−π/2、ω=4rad/s、v=vmax−0.01，无受力，0.05s                                               | 耦合导致超速，实际状态保留与原因事件                      |
| joint-torque       | g=9.81、静止下垂，τ=+0.1N·m@[0,0.1)，窗口0.2s                                                   | 独立广义动量参考、Wτ=τΔθ                                  |
| combined-work      | g=9.81、θ=1.2、v=0.1、ω=0.2；请求1N、外力2N、力矩0.1N·m@[0,0.1)，车粘性0.1、关节粘性0.002，0.2s | 四状态、三类做功及耗散的独立参考                          |
| rail-boundary      | g=0、水平杆、x=半行程−0.0001、v=0.2；请求1N、外力2N，后续1ms排队力矩                            | 解0.0001=0.2t+(3/S)t²/2；部分步各类做功、无反弹与优先终止 |

S为滑块、均匀杆及配重总质量。所有基准核对最大力、绝对功率、超速方向输入及分类能量残差。解析车位/车速与做功一般容差10^-9(SI)，恒功率关系10^-8，能量残差及独立参考各分量10^-7，触边时间10^-10s、位置10^-12m。精确阈值、公式及逐项误差同时在页面与result.json报告；提前停止为invalid，输入偏离冻结基准为blocked，未完成为not_executed，超阈值为failed，不汇总成控制成功。

关节及混合作用参考由scripts/actuation-reference.py读取冻结配置生成，不导入应用动力学或被测轨迹。采用不同状态变量Px、Pθ，积分Px'=Factual+Fexternal+Ffriction，Pθ'=A sinθ·vω+Ag sinθ+τexternal+τfriction，并单独积分三类做功和耗散；速度由质量矩阵反解。离散输入边界精确分段。[SciPy文档](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html)给出DOP853为8阶方法；本参考使用1.17.0版、rtol=10^-12、atol=10^-14、max_step=0.0005s，并与10^-11、10^-13、0.001s交叉核对，每分量差≤10^-9。生成器摘要、实际Python/SciPy/NumPy版本与全部参考点保存在src/actuation-reference.json并随构建、证据冻结。

复现：Node导出两个工况joint-torque/combined-work的完整配置JSON数组，传入安装scipy==1.17.0的Python环境执行scripts/actuation-reference.py。运行时不安装或调用Python；浏览器使用已冻结的参考，计算仍在Worker。

## 页面与证据

沿用实验台的工况、开始/暂停/继续/终止/重置和真实文件读回校验，追加受力基准选择、八条受力/功率/残差/饱和/超速曲线、分类能量账本、独立核验误差阈值、限制与终止事件。参数摘要逐项显示冻结的力/速/功率、安全缓冲区及三类阻力，不能沿用自由运动的零阻力文案。四状态曲线和二维装置保持；显示时长取实际冻结窗口。未确认文件仍显示未导出，后续实验不能沿用旧保存状态。

真实Chrome脚本scripts/browser-actuation.mjs从生产页面执行20个场景，实际下载并读回JSON、逐文件核对清单SHA-256和字节数、核对构建身份及浏览器版本、上传文件确认导出，并拒绝受控错误文件。它验证明确导出路径，不代替目录持续提交、权限或中断恢复。npm run test:browser保留T01/T02并追加T03；实际结果和限制见docs/verification/t03/。

OpenAI Codex依据本次implement #8授权完成实现和验证契约；用户原始资料不变。

Assisted-by: LLM
AI-Agent: OpenAI Codex
