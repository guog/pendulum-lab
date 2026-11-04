# T08 授权目录与持续保存（Issue #13）

实现基线：`9a48276e3543657e4d6031db94ee43e1bdaa500a`（同步 origin/main 后的任务分支）。

## 已执行

- 公开接缝：createSession 与 openWorkspace/create/load（用户已确认）；文件系统为唯一注入边界。
- 0.5 秒仿真时间切块；单个在途提交等待磁盘后再推进，比 1 秒未确认上限更保守。等待时 UI 显示物理推进暂停，不改采样、不丢事件。
- 临时写、关闭、读回、发布不可变批次、读回，再发布清单；只有清单发布并校验后更新确认水位。封存前交叉核验全部引用；封存与控制成功分开。
- 60 秒、10 ms/1 ms/100 ms：6,001/60,001/601 条；重开后配置、样本、事件和快照逐项匹配。
- 延迟写入、写失败、诊断保留、重试、终止尾部、只读/无读权限、无关目录保护、篡改摘要及重新计算摘要后的非法 CSV 格式拒绝。
- `node scripts/workspace-disk.mjs` 使用 Node fs 操作真实临时目录，独立用 Node crypto 验证全部引用的长度和 SHA-256。`disk-evidence.json.gz` 保存目录路径、完整清单和结果；延迟为在真实磁盘适配器注入，不是硬件拥塞证明。它不是 Chrome FSA 验证。
- Chrome 加载了真实应用和独立目录界面，截图为 `chrome-workspace-ui.png`。`node scripts/browser-smoke.mjs` 在真实 Chrome 156 上通过内存研究的开始、暂停、继续、终止、后台控制及导出文件读回；摘要、步骤与实际证据包见 `memory-smoke-*` 和 `memory-*-evidence.json.gz`。这次检查来自尚未提交的最终源代码构建（source_dirty=true），不是提交后 SHA 的浏览器证据。
- 最终完整 `npm run check`：115 项测试通过，格式、文档、类型检查与生产构建通过。工作区公开接缝共 10 项测试通过。

失败证据保留在 `*-red.txt.gz`；修复后的完整检查见 `check.txt`。`check-before-protocol-staged.txt.gz` 保留新协议文件尚未暂存时，构建身份测试按 git 文件清单复制夹具而缺文件的失败；暂存后重跑通过。Chrome 内存回归首次发现“暂停”按钮同名冲突，失败日志与步骤保留在 `memory-smoke-name-collision*`，目录按钮改为明确名称后重跑通过。

## 未完成验收及限制

真实 Chrome 原生目录选择/取消、读写授权、磁盘保存后重新选择目录：**阻塞，未执行**。
原生工具实际返回：`The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.`
另一能力状态：`Local browser use is disabled in Work settings`。CLI 可以操作独立 Chrome 页面，但原生目录选择不能据此声称已验证。

浏览器测试后续操作：启动应用，选择测试用空目录，运行 60 秒目录实验，核对确认水位、封存与重开；分别验证取消、无关目录拒绝、只读模式、权限撤回和写失败。测试数据只写所选目录，不存 IndexedDB/OPFS。

单实例为本工单前提；未实现或证明跨实例、浏览器、来源严格独占。崩溃恢复与中断写入协调由后续任务承接；此轮重开未封存清单仅展示已确认前缀，不重造未提交数据。散列用于完整性检查，不是身份认证。运行中仍有有界内存副本（配置验证的最大样本容量），磁盘是唯一持久化来源。

Issue #13 不因代码与检查通过而宣称验收完成。待上述真实 Chrome 验收通过后才可关闭。

Assisted-by: LLM
AI-Agent: OpenAI Codex
