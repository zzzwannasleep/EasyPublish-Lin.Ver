# EasyPublish 二改实施清单

## 1. 文档目的

这份文档是对 `docs/easypublish-redesign-plan.md` 的继续细化，用来回答下面几个实际执行问题：

- 先改哪些文件
- 每个阶段做什么
- 每个阶段不该做什么
- 阶段完成后如何验收
- 旧代码应该如何迁移到新结构

这份文档默认仓库根目录就是当前 Electron 主工作目录。

## 当前状态（截至 2026-03-12）

- [x] M0 已完成：产品名、包名、图标、应用壳基线和构建基线已完成首轮替换
- [x] M1 已完成首轮主干拆分：`bootstrap / core / windows / preload/contracts` 已落地
- [x] M1 已完成首轮 service 化：`global / bt-account / bt-publish / forum / task` 已拆出独立 service
- [x] M2 已完成首版应用壳：新 `AppShell`、路由骨架、样式 token、布局组件和首批包装页已接入
- [x] M2 已完成任务工作流外层换壳：任务流程页已进入新视觉结构
- [x] M1 已完成收尾：`src/main/index.ts` 里的遗留 `Task` 逻辑已继续外提到独立 service
- [x] M2 已完成路由与页面壳迁移：`project-detail / features / legacy` 结构已接管旧工作流入口
- [x] M3 已建立第一轮领域类型：`Project / SiteAccount / SiteProfile / PublishResult / AppSettings` 已落地
- [x] M3 已建立第一轮存储边界：`project-store / settings-store / credential-store` 已接入主进程
- [x] M3 已接入第一轮 `projectAPI`：创建页、列表页和 Dashboard 统计已开始消费新 `Project` 模型
- [x] M3 已接入第一轮项目详情读模型：`Project Detail` 壳和阶段包装页已共享 `Project` 上下文与展示标签
- [x] M4 已完成：adapter registry、`site-service`、`site:*` IPC、`nexusphp adapter`、发布前校验与首轮项目发布面板已落地
- [x] M5 已完成：项目创建、项目编辑壳、站点账号管理、NexusPHP 发布、legacy / adapter 结果持久化、历史结果视图与日志查看已形成首版可用闭环
- [~] M6 已进入联调与分发阶段：`userDB` 敏感字段已切换为加密落盘，日志导出与诊断页已接入，Windows 出包已验证，macOS 仍待 mac 主机验收
- [~] 当前整体判断需要修正：项目不应再被理解成“基本只剩 M6”，更准确的状态是“应用壳与 MVP 闭环已完成，但主页面重构、renderer 职责收口和 `M3` 内核收口仍在中段”

### 补充判断：页面与内核视角（截至 2026-03-12）

`M2` 当前更接近“应用壳和基础视觉系统已落地”，不等于主页面已经全部重建；`M5` 当前更接近“首版可用闭环已经成立”，不等于长期稳定可维护的桌面工作台已经完成。

当前剩余工作建议分成两条主线看：

- 页面重构主线：`Project Detail` 主工作流、`Accounts`、`Projects`、`Dashboard`、`Settings`
- 内核收口主线：`task -> project` 术语统一、存储边界继续收口、统一错误返回结构、renderer / service 职责边界收口、旧路由语义与 legacy 页面继续下沉

当前最需要重估的页面结论如下：

- `Project Detail` 仍是第一优先级：编辑、检查、发布、完成这条主工作流仍大量依赖旧组件挂载，尚未真正收敛成以 `Project` 为中心的新页面体系
- `Accounts` 仍需重做：现状更像旧 BT / Forum 配置页，不是新的 `SiteAccount` 管理页
- `Projects` 仍需重做：现状更像旧表格页换壳，尚未形成项目工作台视图
- `Dashboard` 仍需重做：现状更偏导航落地页，尚未补齐“最近项目 / 发布历史 / 账号健康 / 最近失败记录”等核心工作台信息
- `Settings` 仍未真正落地：规划中已定义该模块，但当前并未形成正式主页面
- `Sites` 更适合拆分收口而不是继续堆功能：站点目录、账号校验、metadata 调试、发布沙箱不应长期挤在同一页
- `Guide / Quickstart`、`Modify`、`ForumPublish` 更适合作为 `legacy` 兼容或延后项，而不是继续占用主线页面心智

当前相对稳定、可先保留增强的部分：

- `AppShell`
- `Logs`
- 发布历史与完成页
- 基础样式 token、布局组件、状态胶囊等通用 UI 基件

## 2. 总体执行规则

整个项目必须遵守以下执行规则：

- 一次只解决一类问题，不同时做“换壳 + 换框架 + 改业务”
- 任何阶段开始前，先保证当前分支能运行
- 结构重构优先于功能扩张
- UI 重写优先于视觉细节打磨
- 新业务优先通过 adapter 进入系统，不允许直接把站点逻辑塞回页面组件

## 3. 里程碑总览

### M0：基线准备 `[已完成]`

目标：

- 复制 / fork EasyPublish 到正式工作仓库
- 改名、改图标、改产品标识
- 保证项目本地能跑、能打包

结果：

- 一个可运行的“你的项目基线”

### M1：结构拆分 `[已完成]`

目标：

- 拆主进程单文件
- 拆 preload 契约
- 不改旧业务行为

结果：

- 同样功能，更清晰结构

### M2：应用壳重建 `[已完成]`

目标：

- 重写桌面壳
- 重做路由和页面骨架
- 建立视觉 token

结果：

- 一个看起来已经属于你自己的桌面软件

### M3：领域模型重构 `[进行中]`

目标：

- 从 task 模型转向 project 模型
- 抽出站点、账号、项目、结果等核心模型
- 重整存储层

结果：

- 内部数据结构稳定下来

### M4：Adapter 基础层 + NexusPHP 首适配器 `[已完成]`

目标：

- 定义统一 adapter 接口
- 完成第一个 `nexusphp adapter`
- 把你当前原型里的关键发布逻辑迁入新架构

结果：

- 新产品真正具备可用的首个核心业务能力

### M5：项目编辑与发布流 `[已完成]`

目标：

- 项目创建
- 项目编辑
- 站点配置
- 发布执行
- 历史与结果

结果：

- 第一版可真实使用

### M6：安全与分发 `[进行中]`

目标：

- 敏感信息安全存储
- 日志与诊断增强
- Windows / macOS 打包验证

结果：

- 可交付构建版本

## 4. 阶段 0：基线准备 `[已完成]`

### 4.1 必改文件

- `package.json`
- `electron-builder.yml`
- `build/icon.ico`
- `build/icon.icns`
- `build/icon.png`
- `src/renderer/src/App.vue`

### 4.2 具体任务

- 修改包名、产品名、作者信息、主页信息
- 修改 `appId`
- 替换图标
- 把标题栏上的文案先替换成你的项目名
- 确认 `npm run dev`
- 确认 `npm run build`
- 确认 Windows 打包脚本能跑
- 记录 macOS 打包要求，但此阶段不强求完成签名 / 公证

### 4.3 本阶段禁止事项

- 禁止引入新业务逻辑
- 禁止新增复杂页面
- 禁止大改旧 IPC
- 禁止一上来删掉旧页面

### 4.4 验收标准

- 新包名与新产品名生效
- 图标生效
- 主界面能打开
- 旧功能依然可运行
- 构建命令可执行

## 5. 阶段 1：拆主进程和 preload `[进行中]`

### 5.1 当前重点文件

- `src/main/index.ts`
- `src/preload/index.ts`

### 5.2 主进程拆分目标

建议先把 `src/main/index.ts` 拆成以下模块：

- `src/main/bootstrap/app.ts`
- `src/main/bootstrap/window.ts`
- `src/main/bootstrap/ipc.ts`
- `src/main/windows/login-window.ts`
- `src/main/core/logger.ts`
- `src/main/core/proxy.ts`
- `src/main/core/session.ts`
- `src/main/services/file-service.ts`
- `src/main/services/account-service.ts`
- `src/main/services/project-service.ts`
- `src/main/services/publish-service.ts`

### 5.3 旧代码到新模块的迁移映射

#### createWindow 相关

来源：

- `src/main/index.ts` 中的主窗口创建逻辑

迁移到：

- `src/main/bootstrap/window.ts`

职责：

- 只负责主窗口创建、窗口参数、页面加载、外链打开、窗口生命周期

#### createLoginWindow 相关

来源：

- `src/main/index.ts` 中的登录窗口逻辑

迁移到：

- `src/main/windows/login-window.ts`

职责：

- 只负责站点登录窗口、关闭时 Cookie 回写、代理注入

#### Global namespace

来源：

- `src/main/index.ts` 里的 `namespace Global`

迁移到：

- `src/main/services/file-service.ts`
- `src/main/services/settings-service.ts`
- `src/main/ipc/app.ipc.ts`

职责：

- 文件选择
- 目录选择
- 剪贴板
- 配置切换
- 配置名读取与设置

#### BT namespace

来源：

- `src/main/index.ts` 里的 `namespace BT`

迁移到：

- `src/main/sites/legacy/*`
- `src/main/services/account-service.ts`
- `src/main/services/publish-service.ts`
- `src/main/ipc/account.ipc.ts`
- `src/main/ipc/publish.ipc.ts`

职责：

- 账号校验
- 登录流程
- 发布动作
- 种子相关查询

注意：

- 这里先以“逻辑搬家”为主，不先改行为
- 站点细节可以先放进 `legacy/` 目录，等 adapter 体系建立后再进一步收口

#### Forum namespace

来源：

- `src/main/index.ts` 里的 `namespace Forum`

处理方式：

- 第一阶段单独拆成 `src/main/legacy/forum-service.ts`
- 不立即删除
- 但从架构上降级为兼容模块

#### Task namespace

来源：

- `src/main/index.ts` 里的 `namespace Task`

迁移到：

- `src/main/services/project-service.ts`
- `src/main/services/content-service.ts`
- `src/main/ipc/project.ipc.ts`

职责：

- 项目创建
- 项目列表
- 项目读取
- 项目配置保存
- 项目内容导出

### 5.4 preload 拆分目标

当前 `src/preload/index.ts` 的桥接对象太大，建议拆为：

- `src/preload/contracts/app.ts`
- `src/preload/contracts/settings.ts`
- `src/preload/contracts/account.ts`
- `src/preload/contracts/project.ts`
- `src/preload/contracts/publish.ts`
- `src/preload/contracts/site.ts`

第一阶段可以继续最终从 `index.ts` 对外暴露，但内部实现要先拆。

### 5.5 本阶段禁止事项

- 禁止顺手改业务规则
- 禁止同时重写 UI
- 禁止先引入 NexusPHP 逻辑
- 禁止把旧功能删到跑不起来

### 5.6 验收标准

- `src/main/index.ts` 明显缩小
- 主窗口依然能打开
- 登录窗口依然能打开
- 原有账号检查和旧页面仍可工作
- preload 仍然能正常桥接

## 6. 阶段 2：重建应用壳和视觉系统 `[进行中]`

### 6.1 当前重点文件

- `src/renderer/src/App.vue`
- `src/renderer/src/router/index.ts`
- `src/renderer/src/components/*`

### 6.2 先做什么

- 重写主壳 `App.vue`
- 重写路由
- 新建样式 token 文件
- 建立布局组件
- 建立基础面板、按钮、状态胶囊、工作区组件

### 6.3 页面迁移策略

旧页面不建议原地继续演化，而应按新结构重建。

建议映射关系如下：

- `CreateTask.vue` -> `views/projects/ProjectCreateView.vue`
- `TaskList.vue` -> `views/projects/ProjectsView.vue`
- `Account.vue` -> `views/accounts/AccountsView.vue`
- `Edit.vue` -> `features/project-editor/*`
- `BTPublish.vue` -> `features/publish-panel/*`
- `ForumPublish.vue` -> `legacy/forum/*`
- `Modify.vue` -> 暂时保留在 `legacy/modify/*` 或延后
- `Quickstart.vue` -> 删除或改成 Dashboard 中的引导区
- `Home.vue` -> 被新的 Dashboard 替代

### 6.4 视觉系统首批文件建议

新建：

- `src/renderer/src/styles/tokens.css`
- `src/renderer/src/styles/theme.css`
- `src/renderer/src/styles/layout.css`
- `src/renderer/src/components/layout/AppShell.vue`
- `src/renderer/src/components/layout/SidebarNav.vue`
- `src/renderer/src/components/layout/TopBar.vue`
- `src/renderer/src/components/feedback/StatusChip.vue`
- `src/renderer/src/components/base/AppPanel.vue`

### 6.5 本阶段禁止事项

- 禁止在 UI 层直接写站点请求
- 禁止顺手做大量高级交互
- 禁止把视觉细节优化放到结构之前

### 6.6 验收标准

- 应用主壳已经不是 EasyPublish 原样
- 左侧导航、顶部区、工作区布局已经成型
- 主题 token 已建立
- 至少 3 个主页面以新风格落地

## 7. 阶段 3：领域模型和存储层重构 `[进行中]`

### 7.1 当前重点

把“旧业务术语”和“新产品术语”彻底分开。

### 7.2 具体任务

- 定义 `Project`
- 定义 `SiteAccount`
- 定义 `SiteProfile`
- 定义 `PublishResult`
- 抽出普通配置存储
- 抽出敏感信息存储
- 统一错误返回结构

### 7.3 建议新文件

- `src/main/storage/settings-store.ts`
- `src/main/storage/project-store.ts`
- `src/main/storage/credential-store.ts`
- `src/renderer/src/types/project.ts`
- `src/renderer/src/types/site.ts`
- `src/renderer/src/types/account.ts`
- `src/renderer/src/types/publish.ts`

### 7.4 本阶段禁止事项

- 禁止马上扩展新站点
- 禁止继续沿用“task”作为长期核心术语
- 禁止让页面直接理解底层旧数据结构

### 7.5 验收标准

- 新页面已基于 `Project` 模型工作
- 普通数据和敏感数据边界明确
- 存储逻辑不再散落在多个旧模块中

## 8. 阶段 4：建立 Adapter 层并接入 NexusPHP `[已完成]`

### 8.1 当前重点

这是整个二改最关键的业务阶段。

目标不是单纯“支持一个站点”，而是把后续所有站点扩展的路打通。

### 8.2 建议新增文件

- `src/main/sites/adapter.ts`
- `src/main/sites/registry.ts`
- `src/main/sites/nexusphp/adapter.ts`
- `src/main/sites/nexusphp/auth.ts`
- `src/main/sites/nexusphp/schema.ts`
- `src/main/sites/nexusphp/mapper.ts`

### 8.3 需要从你当前原型迁移的逻辑

来源：

- 已迁移完成的历史 Tauri 原型（原位于根目录的 `src-tauri/src/main.rs` 与 `dist/app.js`，现已移除）

优先迁移：

- 站点 URL 归一化
- API URL 推导
- API Key / 用户名密码双模式鉴权
- `load_sections`
- `publish_torrent`
- 子分类、标签、基础上传字段模型

### 8.4 UI 对接任务

渲染层需要增加：

- 站点能力驱动表单
- 分区 / 分类加载
- 发布前校验
- 原始响应展示

### 8.5 本阶段禁止事项

- 禁止把 NexusPHP 逻辑写回页面组件
- 禁止绕过 adapter 直接在 service 里写站点私货
- 禁止在没有统一 capability 的前提下硬编码 UI

### 8.6 验收标准

- `nexusphp adapter` 可以独立完成发布
- UI 能根据站点能力动态渲染必要字段
- 原始返回和错误信息可查看
- 至少完成一个真实可用的发布闭环

### 8.7 当前完成情况（截至 2026-03-12）

- `src/main/sites/adapter.ts`、`registry.ts`、`site-service.ts`、`site:*` IPC、preload contract 与 renderer bridge 已接入
- `nexusphp adapter` 已覆盖 URL 归一化、API base 推导、双模式鉴权、metadata 加载、`publish_torrent` 和发布前校验
- `/sites` 适配器页面与 `Project Detail` 里的 `NexusProjectPublishPanel` 已能按 capability 拉取 metadata、渲染分类 / 标签 / 子分类、显示原始响应并执行发布
- 发布成功后的远程链接会回写到项目存储，项目工作流可直接消费新的发布结果
- 工程验收已通过 `npm run typecheck` 与 `npm run build`；真实站点联调仍需在有效账号和网络环境下完成

## 9. 阶段 5：项目编辑器与发布工作流 `[已完成]`

### 9.1 当前重点

把“能发布”升级成“能长期使用”。

### 9.2 具体任务

- 项目创建页
- 项目详情页
- 文件管理
- 内容编辑
- 目标站点配置
- 发布执行面板
- 发布历史与结果页

### 9.3 推荐拆分

新建：

- `src/renderer/src/features/project-editor/`
- `src/renderer/src/features/publish-panel/`
- `src/renderer/src/features/site-manager/`
- `src/renderer/src/views/project-detail/`

### 9.4 MVP 范围

第一版可用 MVP 建议只包含：

- 项目创建
- 项目编辑
- 站点账号管理
- NexusPHP 分区加载
- NexusPHP 发布
- 发布结果记录
- 日志查看

### 9.5 暂缓内容

建议延后：

- 复杂模板系统
- 论坛发帖逻辑
- 自动更新
- 多种高级批量操作

### 9.6 验收标准

- 用户可以创建项目并保存
- 用户可以配置至少一个站点并完成发布
- 历史结果可回看
- 失败时可看到可读错误信息

## 10. 阶段 6：安全、诊断和分发 `[进行中]`

### 10.1 具体任务

- [~] 敏感信息迁移到安全存储
- [x] 增加日志导出
- [x] 增加原始响应调试页
- [x] 增加发布失败定位信息
- [x] 验证 Windows 构建
- [~] 验证 macOS 构建
- 预留签名和公证流程

### 10.2 特别注意

`electron-builder.yml` 当前虽然已有 mac 配置，但并不等于已经可用于正式对外分发。

如果要给别人稳定使用，后续还要补：

- Apple Developer 签名
- notarization
- 分发校验

### 10.3 验收标准

- 本地敏感数据不再是最终明文方案
- 可以导出日志
- Windows 和 macOS 都能出包

### 10.4 当前完成情况（截至 2026-03-12）

- `src/main/storage/secure-user-data.ts` 已接管 `userDB` 的磁盘读写，对密码、API Token 和 Cookie 做透明加解密
- 现有 `lowdb` 用户数据文件保留原路径与结构，旧明文数据会在首次写回时自动迁移为加密落盘
- 现有主进程服务仍继续消费解密后的内存态 `userDB`，因此本轮不需要同步重写 BT / Forum / Site 业务调用链
- `log-service`、`log:*` IPC、preload contract 与 renderer bridge 已补齐诊断导出，日志页可直接导出 JSON 诊断包
- `/logs` 已补齐失败原始响应展开查看、失败快照复制和诊断导出入口，形成首轮调试闭环
- 已在 Windows 主机通过 `npm run build:win`，产物已生成 `Nexus Publish-0.1.0-setup.exe`、`Nexus Publish-0.1.0-win.zip` 与 `win-unpacked`
- 已在当前 Windows 主机验证 `npm run build:mac` 的真实阻塞为 electron-builder 平台限制：`Build for macOS is supported only on macOS`
- `M6` 剩余重点收敛为真实环境联调、macOS 主机打包验收，以及后续签名 / notarization / 分发校验

## 11. 推荐分支策略

建议按阶段拆分分支：

- `chore/rebrand-baseline`
- `refactor/main-preload-split`
- `feat/app-shell`
- `feat/domain-model`
- `feat/nexusphp-adapter`
- `feat/project-workflow`
- `feat/security-packaging`

不要在一个超大分支里把所有事情一起做完。

## 12. 阶段间依赖关系

必须按下面的依赖顺序推进：

- M0 完成后，才能进入 M1
- M1 完成后，才能安全进入 M2
- M2 和 M3 可以部分交叉，但必须以 M1 为前提
- M4 必须建立在 M1 和 M3 至少基本完成之后
- M5 必须建立在 M4 至少有一个稳定 adapter 之后
- M6 放到最后

## 13. 当前最建议你立刻做的事

如果接下来开始真正动手，最先做的不是业务，而是下面这 5 件事：

1. [x] 在正式仓库里准备 EasyPublish 基线
2. [x] 改名、改图标、改产品标识
3. [x] 拆 `src/main/index.ts`
4. [x] 拆 `src/preload/index.ts`
5. [x] 建立新的 `AppShell + Router + styles token`

只要这 5 件事做完，后面的开发会明显顺很多。

## 14. 下一步建议

当前更合适的后续顺序是：

1. 继续完成 `M3` 收尾，先把 `task -> project`、存储边界、统一错误返回和 renderer / service 职责边界收干净
2. 重做 `Project Detail` 主工作流，逐步替换 `Edit / Check / BTPublish / Finish` 的旧组件挂载
3. 重做 `Accounts`，从旧 BT / Forum 配置页转向 `SiteAccount` 管理页
4. 重做 `Projects`，从旧表格页转向项目工作台视图
5. 重做 `Dashboard`，补齐最近项目、发布历史、账号健康和失败记录
6. 补齐 `Settings` 页面
7. 拆分 `Sites` 页面，收敛站点目录、账号校验、metadata 调试和发布沙箱
8. 收口 `App.vue` 与旧路由语义，继续把 `Guide / Modify / Forum` 下沉为 `legacy`
9. 并行推进 `M6` 剩余项：真实环境联调、macOS 主机打包验收，以及后续签名 / notarization / 分发校验
