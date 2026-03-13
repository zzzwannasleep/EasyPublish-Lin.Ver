# EasyPublish 二改桌面版架构规划

## 1. 文档目的

这份文档用于明确后续二改方向，不是随手记录的想法，而是后面实际开发时要遵守的基础约束。

这份规划主要解决以下问题：

- 这个项目到底做成什么
- 为什么要基于 EasyPublish 二改
- 主体技术架构怎么定
- 模块应该如何拆分
- UI 应该走什么视觉方向
- 先做什么，后做什么

本规划默认目标平台只有：

- Windows
- macOS

## 当前状态（截至 2026-03-12）

- [x] 已确认以 `EasyPublish` 为桌面版底座继续推进
- [x] 已保留 `Electron + Vue 3 + TypeScript` 技术基线，没有切换框架
- [x] 已完成首轮 `main / preload / renderer` 分层梳理，并开始把主进程逻辑 service 化
- [x] 已完成首版桌面工作台外壳，新的导航、顶栏、布局和视觉 token 已接入
- [x] 已完成工作流路由重挂载，旧 `Edit / Check / BTPublish / ForumPublish / Finish` 已通过新的 `views / features / legacy` 壳接入
- [x] 已建立第一轮 `Project` 领域模型与 typed `projectAPI`，创建页 / 列表页 / Dashboard 统计已开始走新模型
- [x] 已建立第一轮 `Project Detail` 共享上下文，新工作流壳与阶段包装页已直接展示 `Project` 元数据
- [x] Adapter 体系、site registry / service、`site:*` IPC 与 `nexusphp adapter` 已落地，NexusPHP metadata / publish / validation 已进入新链路
- [x] 新项目工作流已形成首版可用闭环：项目创建、编辑壳、adapter/legacy 发布、结果历史与日志查看已经接入同一套桌面工作台
- [~] 敏感信息安全存储已开始首轮替换：`userDB` 敏感字段已切换为加密落盘兼容迁移，日志导出与原始响应诊断页已接入，Windows 出包已验证

## 2. 项目定位

### 2.1 总目标

基于 `EasyPublish` 已有的桌面端基础能力，重构出一个面向 PT / NexusPHP 发布场景的新桌面软件。

它的最终形态应当是：

- 一个桌面发布工作台
- 以“项目”为中心，而不是以临时表单为中心
- 能管理账号、站点、发布任务、历史记录和结果
- 后续可以继续扩展更多站点，但第一阶段优先把核心发布流程做稳

### 2.2 产品边界

第一阶段只做桌面版，不考虑：

- Web 版
- 手机端
- Linux 发行版
- 团队协作 / 云同步
- 插件市场
- 一上来就支持非常复杂的自动规则推断

这些方向以后可以讨论，但不能影响当前架构落地。

### 2.3 为什么选择 EasyPublish 作为底座

因为它已经具备一个成熟桌面软件最麻烦的那部分基础设施：

- Electron 桌面壳
- Windows / macOS 打包链路
- 登录窗口模式
- Cookie / Session 处理模式
- 文件选择与目录选择
- 代理配置
- 主进程 / preload / 渲染层的基础结构

如果重新从头做桌面壳，时间会大量花在非业务层；而你当前仓库里的 Tauri 原型更适合被视为“业务逻辑参考”，不适合继续承担最终桌面版底座职责。

## 3. 核心决策

### 3.1 代码基线

项目应当以 `EasyPublish` 为 fork 起点，而不是完全重写。

原因：

- 可以直接继承桌面应用骨架
- 可以继承已跑通的构建和打包方式
- 可以保留登录窗口、浏览器验证、代理和 IPC 这类桌面层能力
- 后续主要精力可以集中在“业务重构”和“UI 重写”

### 3.2 技术栈

第一阶段建议固定以下技术栈，不做框架切换：

- Electron
- Vue 3
- TypeScript
- electron-vite
- electron-builder

这一点非常重要：

- 不要在同一个阶段同时做“换框架”和“改业务”
- 不要一边重写 UI，一边把 Electron 换成 Tauri
- 不要在架构还没拆干净前贸然扩展大量功能

### 3.3 数据存储策略

存储必须按敏感级别拆开。

普通结构化数据可以继续用本地 JSON 或 `lowdb`，例如：

- 应用设置
- 站点定义
- 项目数据
- 发布历史
- 草稿内容

敏感数据必须独立处理，例如：

- 密码
- API Token
- 长期保存的 Cookie

推荐策略：

- 普通数据继续用文件存储
- 敏感信息接入系统安全存储
- 不再沿用 EasyPublish 里“明文长期存储敏感信息”的最终方案

## 4. 总体架构原则

### 4.1 Electron 三层模型必须严格保留

整个程序必须保持以下分层：

- `main`：有权限的主进程
- `preload`：桥接层
- `renderer`：纯 UI 层

渲染层不应直接掌控：

- 文件系统
- Cookie / Session
- 代理设置
- 站点登录流程
- 有权限的网络调用

### 4.2 业务逻辑不得堆进页面组件

Vue 页面组件只负责：

- 展示状态
- 收集输入
- 触发动作
- 呈现结果和进度

Vue 页面组件不负责：

- 站点请求拼装
- 登录流程判断
- Cookie 管理
- 配置文件直接读写
- 发布规则计算

也就是说，不能再让页面组件变成“半个 service 层”。

### 4.3 站点支持必须走 Adapter 体系

后续支持的每一个站点，都必须抽象成一个站点适配器。

这条是整个项目最重要的中长期架构约束。

适配器负责：

- 站点能力声明
- 登录或鉴权
- 元数据加载
- 发布
- 更新
- 结果归一化

UI 不应该基于“站点名 if else”来判断功能，而应该基于“站点能力”来渲染。

### 4.4 以 Project 为中心，而不是以临时任务为中心

新的产品模型应当从“临时任务”转向“项目”。

一个项目应当承载：

- 标题
- 副标题 / 简介
- 描述内容
- 文件附件
- 站点选择
- 每站点发布参数
- 发布结果
- 历史记录
- 草稿状态

项目是核心对象，页面只是它的不同视图。

### 4.5 重构顺序必须渐进

正确顺序应该是：

1. 先保持现有行为能跑
2. 再拆文件
3. 再统一术语
4. 再替换业务逻辑
5. 最后重写完整 UI

不要反过来。

如果一开始就先改 UI、再改业务、再拆结构，最终大概率会进入维护混乱状态。

## 5. 推荐的目标目录结构

建议最终逐步收敛到下面这种结构：

```text
src/
  main/
    index.ts
    bootstrap/
      app.ts
      window.ts
      ipc.ts
    core/
      logger.ts
      error.ts
      proxy.ts
      session.ts
    storage/
      settings-store.ts
      project-store.ts
      credential-store.ts
    services/
      project-service.ts
      publish-service.ts
      account-service.ts
      file-service.ts
      content-service.ts
    sites/
      adapter.ts
      registry.ts
      nexusphp/
        adapter.ts
        schema.ts
        mapper.ts
        auth.ts
      legacy/
        ...
    ipc/
      app.ipc.ts
      settings.ipc.ts
      account.ipc.ts
      project.ipc.ts
      publish.ipc.ts
      site.ipc.ts
    windows/
      login-window.ts
      main-window.ts
      validation-overlay.ts
  preload/
    index.ts
    contracts/
      app.ts
      settings.ts
      account.ts
      project.ts
      publish.ts
      site.ts
  renderer/
    index.html
    src/
      main.ts
      App.vue
      app/
        shell/
        providers/
      router/
      views/
        dashboard/
        projects/
        project-detail/
        accounts/
        sites/
        settings/
        logs/
      features/
        project-editor/
        publish-panel/
        account-manager/
        site-manager/
      components/
        base/
        layout/
        feedback/
        forms/
      services/
        api/
        bridge/
      stores/
      styles/
        tokens.css
        theme.css
        layout.css
      types/
```

这个结构不是要求你第一天就全部重构完成，而是要求后续新增代码往这个方向靠。

## 6. 现有 EasyPublish 代码的取舍策略

### 6.1 应该保留的部分

这些部分值得先保留：

- Electron 进程结构
- 构建和打包配置
- 窗口生命周期逻辑
- 登录窗口模式
- 代理配置模式
- 文件 / 目录选择能力
- preload 桥接思路
- 日志基础设施

### 6.2 应该重写的部分

这些部分可以临时使用，但不应作为最终形态：

- 当前路由结构
- 当前页面组织方式
- 当前主界面外观
- 当前业务命名
- 当前主进程单文件组织
- 当前大量字符串 IPC

### 6.3 不应继续主导最终产品的部分

这些是旧产品领域逻辑，不应继续决定新产品的核心结构：

- VCB 主站发帖逻辑
- 动漫模板生成作为核心主流程
- 以 bangumi / nyaa / acgrip 这些站点为中心的整体设计

如果后续保留旧站点兼容，它们也应当退到 adapter 层里，而不是继续主导全局结构。

## 7. 你当前本地原型的复用策略

你现在这个仓库里的 Tauri 原型并不是白做的，它里面有一部分业务抽象是有价值的。

值得迁移思路的部分主要有：

- 站点地址归一化
- API 地址推导
- 双鉴权模式
  - API Key
  - 用户名密码
- 拉取分区的流程
- multipart 上传发布流程
- NexusPHP 上传字段模型

这些逻辑最初主要来自根目录 Tauri 原型（原 `src-tauri/src/main.rs` 与 `dist/app.js`，现已移除）。

正确做法不是把 Rust 强行嵌回 Electron，而是把这些业务规则重新实现成 Electron 的 `nexusphp adapter`。

## 8. 领域模型设计

### 8.1 应用设置

`AppSettings`

- 主题
- 语言
- 代理设置
- 日志级别
- 更新策略
- 默认路径

### 8.2 站点账号

`SiteAccount`

- site id
- 鉴权方式
- 用户名
- 最近校验状态
- 最近校验时间
- 是否启用

敏感字段独立存储：

- 密码
- API Token
- 长期 Cookie

### 8.3 站点定义

`SiteProfile`

- id
- 站点名
- adapter 类型
- base URL
- capability 集
- 自定义字段映射

### 8.4 发布项目

`PublishProject`

- id
- 项目名称
- 工作目录
- 内容草稿
- 源文件列表
- 目标站点列表
- 每站点参数
- 当前状态
- 发布结果
- 创建时间
- 更新时间

### 8.5 发布结果

`PublishResult`

- site id
- 状态
- 远端 ID
- 远端 URL
- 提示信息
- 原始返回快照
- 时间戳

## 9. 模块定义

### 9.1 Shell 模块

职责：

- 主窗口
- 标题栏控制
- 主体布局
- 路由容器
- 全局弹窗与覆盖层

不负责任何具体站点业务。

### 9.2 Account 模块

职责：

- 账号列表管理
- 鉴权方式切换
- 账号状态校验
- 凭证读写
- 登录窗口触发

### 9.3 Site 模块

职责：

- 站点注册
- adapter 调度
- capability 声明
- 站点字段与通用字段映射

这个模块是“产品通用逻辑”和“站点差异逻辑”的边界。

### 9.4 Project 模块

职责：

- 创建项目
- 打开项目
- 保存草稿
- 附件管理
- 删除 / 归档 / 复制

### 9.5 Publish 模块

职责：

- 校验发布前置条件
- 选择目标站点
- 顺序执行发布
- 汇总结果
- 记录日志与原始响应

### 9.6 Content 模块

职责：

- 内容编辑器
- 可选结构化字段编辑
- 内容预览
- 格式转换能力

### 9.7 Settings 模块

职责：

- 代理
- 路径
- 主题
- 更新策略
- 诊断配置

### 9.8 Log / Diagnostics 模块

职责：

- 运行日志
- 发布日志
- 错误日志
- 导出调试信息

## 10. IPC 设计规则

IPC 必须命名空间化和类型化。

建议统一成以下命名空间：

- `app:*`
- `settings:*`
- `account:*`
- `project:*`
- `publish:*`
- `site:*`
- `dialog:*`
- `log:*`

规则如下：

- 普通操作优先使用 request / response
- 长任务进度才使用事件流
- 每个 IPC 都应有明确的请求和响应模型
- 不再把“随手拼 JSON 字符串”作为长期约定

EasyPublish 当前的字符串式 IPC 可以暂时兼容，但不应成为最终标准。

## 11. 站点适配器设计

每个适配器都应该满足统一接口，形态上类似：

```ts
export interface SiteAdapter {
  id: string
  name: string
  capabilities: SiteCapabilities
  validateAccount(input: ValidateAccountInput): Promise<AccountStatus>
  loadMetadata(input: LoadMetadataInput): Promise<MetadataResult>
  publish(input: PublishInput): Promise<PublishResult>
  update?(input: UpdateInput): Promise<UpdateResult>
}
```

`SiteCapabilities` 应当描述站点到底支持什么，例如：

- 是否支持 API Key
- 是否支持账号密码
- 是否支持浏览器登录
- 是否支持自动拉取分区
- 是否支持标签
- 是否支持子分类
- 是否支持更新
- 是否需要验证码或额外验证

UI 应当根据 capability 渲染，而不是根据站点名称硬编码条件分支。

## 12. UI 和视觉方向

### 12.1 设计目标

新的 UI 不应该像一个普通后台管理页，也不应该继续沿用 EasyPublish 当前偏默认组件库的味道。

它应该更像：

- 一个桌面工作台
- 一个可长期使用的生产工具
- 一个面向高频操作的发布界面

关键词：

- 专业
- 克制
- 工具感
- 信息密度高但不凌乱
- 明显是桌面端，而不是网页后台套壳

### 12.2 视觉基调

建议采用：

- 深石墨色背景
- 稳定的深灰面板层级
- 铜橙色作为主强调色
- 低饱和青绿色表示成功
- 克制红色表示失败

建议的基础色方向：

- 背景：`#12161B`
- 主面板：`#1A2129`
- 次级面板：`#222B35`
- 分割线：`rgba(255,255,255,0.08)`
- 主文字：`#E7ECF2`
- 次级文字：`#98A4B3`
- 主强调：`#D67B28`
- 强调深色：`#A9551A`
- 成功：`#2FA37A`
- 警告：`#D0A14A`
- 失败：`#C45A5A`

这个方向和你当前原型里偏暖铜色的气质是兼容的，也更适合工具类桌面应用。

### 12.3 字体方向

不建议继续走默认浏览器 / 默认组件库字体感觉。

建议方向：

- 标题和数字：更有几何感的字体
- 正文：清晰、耐读、支持中文的无衬线字体

可参考的组合思路：

- 标题 / 数字：`IBM Plex Sans`
- 正文：`Noto Sans SC`

最终具体字体可以后续再定，但方向应明确为“有设计意图的桌面字体体系”。

### 12.4 布局结构

建议采用三段式桌面布局：

- 左侧：导航栏
- 中间：主工作区
- 右侧或底部：状态、结果、日志、原始返回

不要把整个软件做成又长又单列的表单页。

桌面应用应该充分利用宽屏空间，而不是像手机页面拉宽。

### 12.5 组件风格

建议重点使用这些模式：

- 框架感明确的面板
- 分栏工作区
- 顶部命令栏
- 状态胶囊
- 目标站点矩阵
- 发布进度时间线
- 固定项目摘要区

尽量避免：

- 单页超长表单
- 依赖大量弹窗串联主流程
- 默认 Element Plus 外观直接裸用
- 大量业务都塞在单个 `.vue` 文件

### 12.6 动效

动效只做功能性强化，不做花哨展示。

建议保留：

- 路由切换淡入淡出
- 折叠展开
- 发布步骤状态过渡

不需要一开始就做复杂动画系统。

## 13. 渲染层信息架构

建议第一版完整产品包含这些主路由：

### 13.1 Dashboard

用于展示：

- 最近项目
- 发布历史
- 账号健康状态
- 最近失败记录

### 13.2 Projects

用于：

- 浏览项目列表
- 按状态筛选
- 新建 / 复制 / 归档 / 删除

### 13.3 Project Detail

这是主工作区，负责：

- 编辑项目信息
- 附件管理
- 选择目标站点
- 查看预览
- 执行发布

建议拆成标签页：

- Basic Info
- Content
- Files
- Target Sites
- Publish
- History

### 13.4 Accounts

用于：

- 管理站点账号
- 校验鉴权状态
- 查看账号可用性

### 13.5 Sites

用于：

- 配置站点地址
- 启停站点
- 管理字段映射和默认行为

### 13.6 Settings

用于：

- 代理
- 存储路径
- 主题
- 诊断设置
- 更新策略

### 13.7 Logs

用于：

- 查看运行日志
- 查看请求错误
- 查看原始发布响应

## 14. 编码与模块化约束

### 14.1 文件规模约束

建议约束：

- 页面组件尽量只负责页面编排
- 主进程中单文件超过 400 到 500 行时，应考虑拆分
- 站点逻辑必须收敛在 adapter 目录下

### 14.2 命名约束

命名必须转向新产品领域，不再让旧产品术语继续污染架构。

例如：

- 持久发布单元应统一叫 `project`
- 通用站点应统一叫 `site`
- 登录记录应统一叫 `account`

不建议长期继续使用过度临时、过度旧业务语义的命名。

### 14.3 错误处理

所有有权限的操作都应返回统一结构：

- 用户可读消息
- 技术细节
- 是否可重试
- 原始响应快照（可选）

### 14.4 日志规则

下列行为应统一记录日志：

- 应用启动
- 窗口异常
- 账号校验
- 站点发布
- 适配器错误
- 文件操作

## 15. 分阶段实施计划

### Phase 0：Fork 与基线冻结 `[已完成]`

目标：

- fork EasyPublish
- 改为你的仓库
- 保证项目先能原样跑起来
- 记录现状

交付：

- 一个能跑的二改起点

### Phase 1：只拆结构，不改行为 `[已完成]`

目标：

- 拆 `main/index.ts`
- 拆 preload 契约
- 梳理 IPC 命名
- 保持原功能不变

交付：

- 结构变清晰，但旧功能还能跑

### Phase 2：重建应用壳与路由 `[已完成]`

目标：

- 重写主界面壳
- 重写导航结构
- 建立设计 token
- 建立主题和布局体系

交付：

- 一个外观上已经属于你自己的桌面工作台

### Phase 3：统一领域模型 `[进行中]`

目标：

- 从 `task` 转向 `project`
- 统一站点、账号、项目、结果模型
- 把存储层抽出来

交付：

- 稳定的内部模型和术语

### Phase 4：建立 Adapter 基础层 `[已完成]`

目标：

- 定义 adapter 接口
- 把现有旧站点逻辑包进 adapter
- 新建 `nexusphp adapter`

交付：

- 一个通用发布管线 + 至少一个新业务适配器

### Phase 5：实现新的项目编辑与发布工作流 `[已完成]`

目标：

- 做项目详情页
- 做目标站点配置页
- 做发布进度页
- 做结果记录与历史页

交付：

- 第一版可真实使用的核心功能

### Phase 6：安全与分发加固 `[进行中]`

目标：

- 把敏感信息迁到安全存储
- 补日志导出能力
- 验证 Windows 打包
- 验证 macOS 打包
- 如果需要对外分发，再补签名和公证

交付：

- 可分发的桌面构建版本

## 16. 实际推荐开发顺序

建议按这个顺序推进：

1. fork EasyPublish 到正式工作仓库
2. 先改包名、产品名、图标和品牌信息
3. 先拆 `main/index.ts`
4. 再搭新的应用壳和主路由
5. 然后定义 adapter 接口
6. 把你现有 Tauri 原型里的 NexusPHP 业务逻辑迁成第一个新 adapter
7. 再围绕它做项目管理和发布工作流
8. 最后再扩展高级功能和更多站点

## 17. 本文档已经锁定的结论

除非后续主动推翻，这些结论应视为当前基线：

- 平台范围只做 Windows 和 macOS
- 技术栈固定为 Electron + Vue + TypeScript
- EasyPublish 只作为起始代码，不作为最终架构
- 最终架构必须是 adapter 驱动
- 敏感信息不能继续明文作为最终方案
- UI 必须重建成明确的桌面工作台风格
- 主进程大文件必须在大规模扩展前先拆分

## 18. 暂时保留的待定项

这些问题先不在本阶段强行拍板：

- 最终产品名
- 是否保留部分 EasyPublish 原站点兼容能力
- 是否第一版就保留浏览器登录型站点
- 是否第一版就上项目模板系统
- 是否第一版就启用自动更新

## 19. 下一份建议文档

在你确认这份规划后，下一份最有价值的文档应该是：

- `docs/implementation-backlog.md`

那份文档要继续向下细化成：

- 里程碑
- 文件级任务拆分
- 每阶段验收标准
- 实际改造顺序
