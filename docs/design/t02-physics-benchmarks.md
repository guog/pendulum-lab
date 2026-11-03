# T02：物理与数值可信性基准

本切片仅实施[#7](https://github.com/guog/pendulum-lab/issues/7)，继承[#4](https://github.com/guog/pendulum-lab/issues/4)、[#5](https://github.com/guog/pendulum-lab/issues/5)与[T01契约](t01-implementation.md)。已确认的测试边界仍是完整实验会话及真实Chrome页面/磁盘导出；基准批次只编排同一个createSession，不建立测试专用物理引擎。

## 冻结输入与范围

批次版本physics-qv1-2；完整输入在src/benchmark-inputs.ts生成并复制进批次，读取副本不能改写运行中的输入。每个实验保存完整配置、初态、显式物理覆盖、时钟、模型/规则/构建版本。模型仍为T01的rigid-cartpole-rk4-2；没有改变RK4、物理方程、摩擦平滑、合法参数范围或候选阈值。

每个工况16项，简单/标准分别运行。除下列明确覆盖，继承各工况质量、几何、导轨和零阻力设置。

| 基准ID                | 冻结输入与观察时间                                       | 依据                                                         |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| equilibrium-down/up   | 车居中、速度均零，θ=π/0，10s                             | 精确平衡，不添加初扰；零参考能量改绝对误差                   |
| release               | θ=π/2、两速度零，10s                                     | 自然朝+π下落；独立动量参考                                   |
| rotation              | θ=π、ω=15rad/s、v=0，2s                                  | 原始非零水平总动量输入；标准工况触边保留无效                 |
| rotation-centered     | θ=π、ω=15rad/s、v=−15A/S，2s                             | 明示零水平总动量，累计角至少转两圈                           |
| weight-zero/pivot/tip | 配重分别0kg@0、0.1kg@0、0.3kg@L；θ=1.2、v=0.1、ω=0.2，1s | 质量分布、质心、惯量、初始能量及四状态独立参考               |
| coulomb/cart-viscous  | g=0、θ=π/2、v=0.2、ω=0，1s；分别Fc=0.2N/bc=0.1N·s/m      | 可审计解析车速衰减及能量账本                                 |
| joint-viscous         | bj=0.002N·m·s/rad，水平释放，2s                          | 独立动量参考及耗散                                           |
| combined-damping      | Fc=0.2、bc=0.1、bj=0.002，水平释放，10s                  | tanh平滑vs=0.01m/s；三阻力共同耗散                           |
| convergence-1ms/0.5ms | 水平释放、零阻力，10s；采样均1ms                         | 全部10001个共同原始点比较                                    |
| energy-30s            | 水平释放、零阻力，30s；1ms物理步及采样                   | 全部30001点最大相对漂移，不用图形近似                        |
| numerical-failure     | 水平释放初态显式ω=10^50，1ms                             | 计算异常后冻结，保留原输入、最后有效状态、诊断；该轨迹为无效 |

精确平衡使用原10ms采样，其余非收敛/能量场景也为10ms。收敛和30s能量场景在受测前明确选择已批准的1ms记录，未在失败后改变采样。零参考能量使用≤10^-12J绝对误差、声明尺度1J；非零30s基准Eref简单为0.240345J、标准为0.613125J。

原rotation输入、轨迹及初次参考时刻错误保存在initial-batch.json.gz。physics-qv1-2增加明确命名的rotation-centered，不删除原输入。初版参考的均分检查时刻可能不落在10ms样本上，修复为先选真实采样时刻，再由独立求解器计算期望；不对被测样本插值。该修复有版本momentum-dop853-2，原批次与失败日志保持原样。

## 独立参考与解析关系

参考生成器scripts/physics-reference.py只读取冻结的配置，不导入src/dynamics.ts，不调用会话，也不从被测轨迹生成答案。SciPy的[DOP853文档](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html)说明其为8阶积分方法，适用于高精度非刚性问题。应用为固定步RK4；离线参考使用不同状态变量、方程组织、积分器及步长策略。

从连续质量积分得到S=M+m+p、A=mL/2+pr、B=mL²/3+pr²，摆体质心距离A/(m+p)。参考以广义动量Px=S v−A cosθ ω、Pθ=Bω−A cosθ v为状态，通过质量矩阵逆解速度，积分：

- x'=v、θ'=ω。
- Px'=−Fc tanh(v/vs)−bc v。
- Pθ'=A sinθ vω+Ag sinθ−bj ω。
- D'=Fc v tanh(v/vs)+bc v²+bj ω²。

独立参考记录质量属性、初始机械能、41个真实采样时刻的四状态及累计耗散。精确平衡不用浮点sin(π)数值参考，以解析零力矩关系核验。参考rtol=10^-12、atol=10^-14、max_step=0.005s；另以10^-11、10^-13、0.01s求解，五个输出分量的最大差各须≤10^-8(SI)，原差值写入fixture。原始生成环境、库版本和生成器SHA-256写在src/physics-reference.json；fixture随应用构建摘要冻结并随证据导出。

被测四状态在41个检查点直接对齐：车位≤10^-6m、车速≤10^-5m/s、累计角≤10^-6rad、角速度≤10^-4rad/s。另核对初始机械能误差≤10^-12J；无水平阻力时系统质心关系SΔx−AΔsinθ=Px(0)t，最大残差≤10^-7kg·m。不同配重的能量与运动响应同时约束质心和惯量，避免仅验证同一组公式的自洽性。

零重力、水平杆、仅车阻力场景有独立解析解：粘性v=v0 exp(−bc t/S)；平滑库仑v=vs asinh(sinh(v0/vs) exp(−Fc t/(S vs)))，车速误差≤10^-8m/s。三类阻力分别及共同运行，要求正耗散、累计耗散无倒退（绝对容差10^-12J）、E+D−Eref最大残差≤10^-7J、独立参考耗散差≤10^-7J。不声称真实静摩擦或粘滑。

P0-PHY-03仍使用候选角差≤0.1°、车位差≤1mm；P0-PHY-04仍为30s最大相对能量漂移≤0.1%。比较全部共同采样时刻的原精度累计角，不取最短角、终点差或曲线像素。30s基准记录每个物理步，最大漂移覆盖全部物理步点；不宣称步间连续误差已有证明。

## 执行、结果及证据

createPhysicsBenchmarks编排createSession的创建、开始、推进、暂停、继续、停止、读取及导出。页面和Node行为测试使用同一编排及会话。独立Worker每批推进最多1s仿真时间后让出执行环境；消息在批次边界生效，后台暂停后可见不自动继续，没有墙钟追赶。批次完成只表示16项已执行；不把无效诊断、触边、失败或阻塞汇总为全部物理通过。

公开pause(reason)默认reason为manual。页面暂停按钮明确发送manual，可见性变化明确发送background，Worker和批次接口将该原因原样传给子实验，JSONL事件保留真实来源；两种暂停均不推进仿真时间。

结果逐项使用not_executed、blocked、passed、failed、invalid。尚未取得参考或缺少比较条件为阻塞；完成且超容差为失败；触边或数值异常使对应完整窗口验证无效。numerical-failure故意检查已有冻结路径，其轨迹仍标无效，而安全冻结行为另由测试断言。中途停止保留已执行部分，其余未执行。每项包含完整输入、关联需求、实验UUID、误差、阈值、计算关系和原因。

批次JSON schema_version=1，kind=pendulum-physics-benchmarks，包含batch_id和逻辑files：results.json、reference.json、每项experiments/<id>/下的T01配置/原始CSV/JSONL事件/result/manifest，以及根manifest。每个内层清单保持实验身份，根清单按UTF-8字节计算所有逻辑文件SHA-256和长度，不对自身递归摘要。不是工作区分块或断电耐久性承诺。

批次导出在第一次异步等待前同时取得全部已创建子实验的导出快照和批次结果。调用者随后继续、推进或停止会话，不会改变正在生成的包；暂停时导出的包继续代表该次暂停快照，不能表示后续记录已导出。停止时，仅对确实已创建的当前子实验记无效；开始后尚未推进、或刚完成前一项而下一项未创建时，未创建项目保持未执行。

页面显示16项输入及逐项结果，展开可读误差、阈值、依据及配置，同时显示初始机械能、末采样动能/势能/机械能、累计耗散、执行器/水平外力/关节力矩各自做功与收支残差（单位J）；整条能量历史保存在原始CSV。提供保存对话框写入后读回校验、下载副本与实际文件校验；生成或发起下载不冒称已保存。失败数据与通过数据一起导出，重新运行建立新批次，不能覆盖当前未导出的内存证据而无提示。错误使用已有告警样式及role=alert，普通导出进度用role=status。当前两项研究UI共享互斥操作状态，发出开始/继续命令时立即锁定另一面板，不等待Worker回执；后台均暂停。原T01动画和曲线仍表示原单次自由实验，批次区域独立说明其结果，避免动画冒充基准轨迹。

## 复现

正常检查沿用npm run check；npm run test:browser依次验证T01与T02真实Chrome流程。离线参考的可复查生成方式（输出先写临时文件，不直接覆盖冻结fixture）：

```sh
node --input-type=module -e 'import {physicsBenchmarkInputs} from "./src/benchmark-inputs.ts"; console.log(JSON.stringify(["simple","standard"].flatMap(physicsBenchmarkInputs)))' > /tmp/physics-inputs.json
uv run --python 3.13 --with scipy==1.17.0 --with numpy==2.5.4 scripts/physics-reference.py < /tmp/physics-inputs.json > /tmp/physics-reference.json
```

复查physics、initial_state、duration、全部参考点及质量属性；环境元数据可有真实变化，禁止以重新生成参考来掩盖被测失败。

本轮不实施#8执行器力/速度/功率限制或外力/力矩输入；原始账本相关列如实为零。控制器、稳定快照、持续落盘、恢复、严格独占及完整产品验证维持后续任务边界。

OpenAI Codex依据用户#7实施授权、实时规格及T01记录完成设计、实现和验证；不代人类批准合并或发布。

Assisted-by: LLM
AI-Agent: OpenAI Codex
