# 单集 / 合集电影双流程改造方案

## 1. 背景

当前项目的发布工作流，本质上仍以“一个项目对应一份完整发布物”为中心，流程顺序固定为：

1. 编辑项目
2. 检查输出
3. 发布种子
4. 发布主站
5. 完成结果

这套流程天然更适合：

- 合集
- 剧场版
- 电影
- 一次性准备完整发布稿的项目

但对于以下场景不够友好：

- 单集发布
- 同时发布多部剧的单集
- 高频重复发布
- 需要快速判断“哪些站点还没发”的场景

现有问题主要不在“能不能发”，而在“工作流抽象不对”。

当前新建项目把“我要发什么”和“我怎么生成内容”混在了一起：

- `quick`
- `file`
- `template`

这三个字段更接近“内容来源 / 生成方式”，而不是“媒体类型”。

用户实际思考顺序通常是：

1. 我现在发的是单集，还是合集 / 电影
2. 如果是合集 / 电影，我是快速发、从文件导入，还是从模板生成

因此，项目创建入口和项目模型需要拆层。

## 2. 改造目标

本次改造的核心目标：

1. 新建项目时，先选择媒体类型，再进入对应流程
2. 保留旧流程用于合集 / 电影，不破坏现有稳定能力
3. 为单集增加独立的新流程，不再复用旧的长表单
4. 在单集流程里记录“计划发布站点”，从根源解决漏发布问题
5. 让项目列表、发布页、完成页都能明确提示“还有哪些站点没发”

## 3. 目标产品结构

### 3.1 创建入口

新建项目时第一步只做一件事：

- 选择 `单集`
- 选择 `合集 / 电影`

然后再进入对应工作流：

- `单集` -> 新发布流程
- `合集 / 电影` -> 旧发布流程

### 3.2 双流程结构

#### 单集流程

建议固定为：

1. 编辑项目
2. 发布种子
3. 完成结果

特点：

- 无检查输出页
- 无主站发布页
- 强化目标站点管理
- 强化漏发提醒

#### 合集 / 电影流程

继续使用现有旧流程：

1. 编辑项目
2. 检查输出
3. 发布种子
4. 发布主站
5. 完成结果

并保留现有旧入口：

- 快速发布
- 从文件导入
- 从模板生成

## 4. 核心设计原则

### 4.1 媒体类型与内容来源分离

不要继续使用一个字段同时表达这两层信息。

建议拆成：

- `projectMode`
  - `episode`
  - `feature`

- `sourceKind`
  - `quick`
  - `file`
  - `template`
  - 仅在 `projectMode=feature` 时生效

### 4.2 两套流程共用底层，不共用表单

共用：

- 项目存储
- 工作目录
- 账号 / Cookie / 代理
- 发布执行
- 结果持久化
- 日志诊断
- 项目列表和历史记录体系

分开：

- 新建项目页
- 编辑表单
- 工作流步骤图
- 阶段跳转规则
- 校验规则
- 标题 / 简介生成逻辑
- 完成前提醒逻辑

### 4.3 防漏发靠“计划目标站点”，不是靠结果反推

这一点是本次改造的关键。

当前很多页面只能看到“已经发布了什么”，看不到“本来应该发布什么”。

必须显式记录：

- 用户计划发到哪些站点

然后基于：

- `targetSites`
- `publishResults`

计算：

- 已发布站点
- 失败站点
- 未发布站点

## 5. 当前系统现状与问题拆解

### 5.1 现有创建模型问题

当前项目创建输入主要围绕 `sourceKind`：

- `quick`
- `file`
- `template`

问题：

1. 无法表达媒体类型
2. UI 入口不符合用户心智
3. 单集流程被迫挤在旧工作流里
4. 后续判断会大量出现“如果是单集则……”的散乱分支

### 5.2 现有阶段图问题

当前阶段图固定为：

- `edit`
- `review`
- `torrent_publish`
- `forum_publish`
- `completed`

问题：

1. 单集并不需要完整经过这些阶段
2. 为了兼容单集，只能在现有页面里硬跳过
3. 侧栏、完成页、项目列表都无法准确表达单集流程差异

### 5.3 现有漏发风险问题

当前“漏发布”的根源：

1. 项目没有“目标站点计划”
2. 完成页展示的是“已发生结果”，不是“目标完成情况”
3. 项目列表只看已记录链接，不看未完成站点
4. 发布页没有明确的“剩余目标站点”视角

## 6. 目标数据模型

### 6.1 `ProjectSourceKind`

目标状态：

- `quick`
- `file`
- `template`

不建议把 `episode` 继续作为长期 `sourceKind`。

如果当前实现里已经把 `episode` 临时塞进 `sourceKind`，建议在后续重构中回收到 `projectMode`。

### 6.2 新增 `ProjectMode`

建议新增：

```ts
type ProjectMode = 'episode' | 'feature'
```

含义：

- `episode`: 单集发布项目
- `feature`: 合集 / 电影项目

### 6.3 `CreateProjectInput`

目标结构：

```ts
interface CreateProjectInput {
  name: string
  workingDirectory: string
  projectMode: ProjectMode
  sourceKind?: 'quick' | 'file' | 'template'
}
```

约束：

- `projectMode='episode'` 时，`sourceKind` 可为空
- `projectMode='feature'` 时，`sourceKind` 必填

### 6.4 `PublishProject`

目标新增字段：

```ts
interface PublishProject {
  projectMode: 'episode' | 'feature'
  sourceKind?: 'quick' | 'file' | 'template'
  targetSites: SiteId[]
}
```

说明：

- `targetSites` 必须持久化
- `targetSites` 优先来自项目配置
- 不能再只从 `publishResults` 反推

### 6.5 `Config.Task`

旧任务记录需要兼容：

```ts
type Task = {
  ...
  mode?: 'episode' | 'feature'
  type?: 'quick' | 'file' | 'template'
}
```

兼容规则：

- 历史数据无 `mode` 时默认视为 `feature`
- 历史数据无 `targetSites` 时允许为空

### 6.6 `Config.PublishConfig`

建议统一增加：

```ts
interface PublishConfig {
  title: string
  torrentPath: string
  torrentName: string
  category_bangumi: string
  category_nyaa: string
  targetSites?: SiteId[]
  content: Content_file | Content_template | Content_episode
}
```

### 6.7 `Content_episode`

建议专门为单集模式定义独立内容结构：

```ts
interface Content_episode {
  seriesTitleCN: string
  seriesTitleEN: string
  seriesTitleJP: string
  seasonLabel?: string
  episodeLabel: string
  episodeTitle?: string
  releaseTeam: string
  sourceType: string
  resolution: string
  videoCodec: string
  audioCodec: string
  summary: string
  targetSites: SiteId[]
}
```

注意：

- 单集不要复用模板模式下的大量字段
- 单集内容结构必须短、小、稳定

## 7. 页面与交互改造

### 7.1 新建项目入口

#### 目标交互

点击“新建项目”后，先出现一个模式选择弹窗：

- 单集
- 合集 / 电影

要求：

1. 两个选项只讲清适用场景
2. 不出现内部术语如 `quick`、`template`
3. 选择后进入对应创建页
4. 允许返回重选

#### 文案建议

- 单集：适合高频、连续、重复性强的单集发布
- 合集 / 电影：适合完整稿件、模板生成、主站联动和一次性成片发布

### 7.2 单集创建页

应包含：

- 项目名
- 工作目录
- 基础标题信息
- 集数 / 分集标题
- 发布规格
- 目标站点
- 种子文件
- 简介 / 备注
- 标题预览

不应包含：

- 模板模式的复杂成员字段
- 长篇双语简介模板
- 对比图导入
- 主站预填写
- MediaInfo 预填写

### 7.3 合集 / 电影创建页

保留旧创建逻辑：

- 快速发布
- 从文件导入
- 从模板生成

但它们应该出现在“合集 / 电影”模式下，而不是和“单集”混在同一层。

### 7.4 项目详情步骤条

#### 单集项目步骤条

- 编辑项目
- 发布种子
- 完成结果

#### 合集 / 电影项目步骤条

- 编辑项目
- 检查输出
- 发布种子
- 发布主站
- 完成结果

要求：

1. 同一个 `ProjectWorkflowView` 动态渲染步骤
2. 路由图可继续复用现有结构
3. 但 UI 展示和跳转规则必须按 `projectMode` 决定

### 7.5 单集编辑器

建议独立组件，不要硬塞到旧 `Edit.vue` 里。

组件职责：

- 维护单集字段
- 生成标题建议
- 记录目标站点
- 保存 `config.json`
- 生成可直接供旧发布器使用的简介文件

建议文件：

- `src/renderer/src/components/EpisodeEdit.vue`

### 7.6 旧编辑器

旧 `Edit.vue` 继续只服务合集 / 电影。

要求：

1. 尽量不改原行为
2. 尽量不插入单集判断
3. 通过外层壳做模式分流

### 7.7 发布页

#### 单集项目

重点能力：

- 目标站点数量
- 已发布数量
- 待发布数量
- 发布剩余目标站点
- 完成前二次确认

#### 合集 / 电影项目

保留当前旧行为

### 7.8 完成页

完成页要明确区分：

- 已发布
- 失败
- 未完成目标站点

要求：

1. 如果仍有未发布目标站点，显示醒目警告
2. 返回按钮能回到发布页继续补发
3. 不要让用户误以为“进入完成页就代表全部完成”

### 7.9 项目列表

新增展示维度：

- 项目模式
- 待发布站点数量
- 是否存在未完成目标站点

建议：

1. 单集项目显示 `待发布 N`
2. 支持按 `单集 / 合集电影` 筛选
3. 支持按“存在未完成站点”筛选

## 8. 文件级改造清单

下面按模块列出建议的改造点。

### 8.1 共享类型层

文件：

- `src/shared/types/project.ts`
- `src/config.d.ts`
- `src/message.d.ts`

任务：

1. 新增 `ProjectMode`
2. 调整 `CreateProjectInput`
3. 调整 `PublishProject`
4. 给 `Config.Task` 增加 `mode`
5. 给 `Config.PublishConfig` 增加 `targetSites`
6. 新增 `Content_episode`
7. 保证旧数据兼容读取

### 8.2 项目服务层

文件：

- `src/main/services/project-service.ts`

任务：

1. 创建项目时写入 `projectMode`
2. `feature` 模式下继续处理 `sourceKind`
3. `episode` 模式初始化单集专属默认配置
4. 创建逻辑不要依赖旧 `sourceKind` 推断媒体类型

### 8.3 项目存储层

文件：

- `src/main/storage/project-store.ts`

任务：

1. 读取 `projectMode`
2. 读取配置中的 `targetSites`
3. 构造项目对象时优先使用持久化的目标站点
4. 旧项目缺失配置时按兼容逻辑补默认值
5. 项目统计增加 `byMode`

### 8.4 内容生成层

文件：

- `src/main/services/content-service.ts`

任务：

1. 增加 `createWithEpisode`
2. 为单集模式生成简化版 `html / md / bbcode`
3. 不复用长模板生成器
4. 保证输出仍兼容旧 BT 发布器读取方式

### 8.5 创建页桥接与展示层

文件：

- `src/renderer/src/services/bridge/project.ts`
- `src/renderer/src/components/CreateTask.vue`
- 建议新增：
  - `src/renderer/src/components/ProjectModeSelectDialog.vue`
  - `src/renderer/src/components/FeatureCreateForm.vue`
  - `src/renderer/src/components/EpisodeCreateForm.vue`

任务：

1. 创建页先弹 `projectMode` 选择
2. `feature` 模式里再选择 `quick / file / template`
3. `episode` 模式进入独立创建表单

### 8.6 项目编辑层

文件：

- `src/renderer/src/features/project-editor/ProjectEditorStage.vue`
- `src/renderer/src/components/Edit.vue`
- `src/renderer/src/components/EpisodeEdit.vue`

任务：

1. 根据 `projectMode` 渲染不同编辑器
2. 保证项目上下文未加载前不误渲染旧编辑器
3. 旧编辑器仅服务 `feature`
4. 单集编辑器仅服务 `episode`

### 8.7 工作流壳层

文件：

- `src/renderer/src/views/project-detail/ProjectWorkflowView.vue`
- `src/renderer/src/router/index.ts`
- `src/renderer/src/features/project-detail/project-context.ts`

任务：

1. 步骤条按 `projectMode` 动态生成
2. 单集项目隐藏不需要的步骤
3. “继续”逻辑按 `projectMode` 跳转

### 8.8 发布页

文件：

- `src/renderer/src/features/publish-panel/TorrentPublishStage.vue`
- `src/renderer/src/components/BTPublish.vue`
- `src/renderer/src/features/publish-panel/NexusProjectPublishPanel.vue`

任务：

1. 单集项目默认不展示与当前场景无关的复杂面板
2. 增加目标站点完成度统计
3. 增加“发布剩余目标站点”按钮
4. 完成前检测未发布目标站点
5. 单集项目禁用无意义的下一阶段跳转

### 8.9 完成页

文件：

- `src/renderer/src/features/publish-panel/PublishCompletionStage.vue`
- `src/renderer/src/features/publish-panel/ProjectPublishHistoryPanel.vue`

任务：

1. 显示未完成目标站点
2. 高亮风险状态
3. 提供返回发布页补发入口

### 8.10 项目列表与总览

文件：

- `src/renderer/src/components/TaskList.vue`
- `src/renderer/src/views/dashboard/DashboardView.vue`
- `src/renderer/src/services/project/presentation.ts`

任务：

1. 增加项目模式标签
2. 增加待发布数量
3. 总览页增加模式统计
4. 最近项目优先暴露未完成单集项目

### 8.11 文案与说明

文件：

- `src/renderer/src/locales/messages/zh-CN/projects.ts`
- `src/renderer/src/locales/messages/zh-CN/workflow.ts`
- `src/renderer/src/locales/messages/zh-CN/navigation.ts`
- `src/renderer/src/locales/messages/en-US/*`
- `GUIDE.md`
- `QUICKSTART.md`

任务：

1. 统一文案
2. 清理用户可见的内部术语混乱
3. 增加单集模式说明

## 9. 推荐的分阶段实施方案

### Phase 1：模型拆分与兼容落地

目标：

- 建立 `projectMode`
- 保持旧项目可用

任务：

1. 类型层改造
2. 存储层兼容
3. 项目服务层改造
4. 旧项目默认映射为 `feature`

验收：

- 历史项目仍能打开
- 新项目可以写入 `projectMode`

### Phase 2：新建项目入口重做

目标：

- 先选媒体类型，再选具体流程

任务：

1. 增加模式选择弹窗
2. 创建页分流
3. `feature` 保留旧三种入口
4. `episode` 进入新单集表单

验收：

- 新建项目时，用户第一步一定看到 `单集 / 合集电影`

### Phase 3：单集编辑器与内容生成

目标：

- 单集有独立编辑器和独立内容结构

任务：

1. 完成 `EpisodeEdit.vue`
2. 完成 `Content_episode`
3. 完成 `createWithEpisode`
4. 保证输出兼容旧发布器

验收：

- 单集项目能完成内容生成并进入发布页

### Phase 4：单集发布防漏发闭环

目标：

- 单集流程真正具备防漏发能力

任务：

1. 持久化 `targetSites`
2. 发布页显示剩余目标站点
3. 完成页显示未完成站点
4. 项目列表显示待发布数量

验收：

- 少发一个站点时，发布页、完成页、项目列表都能看出来

### Phase 5：体验增强

目标：

- 提高单集高频发布效率

后续建议：

1. 从上一集继承
2. 批量创建单集项目
3. 按剧名分组
4. 按未完成站点批量补发

## 10. 验收标准

### 功能验收

1. 新建项目时必须先看到模式选择
2. 单集不能再进入旧长表单
3. 合集 / 电影仍能完整走旧流程
4. 单集项目可以完整发布到至少一个旧 BT 站点
5. 单集项目若遗漏目标站点，必须有明确提醒
6. 老项目仍能继续使用

### 交互验收

1. 用户无需理解 `quick / file / template` 就能先选对大类
2. 单集表单明显比旧表单更紧凑
3. 发布页能直接看到“还差哪些站点”
4. 完成页不再假装“全部完成”

### 技术验收

1. `npm run typecheck` 通过
2. `npm run build` 通过
3. 历史数据兼容读取
4. 无破坏性迁移要求

## 11. 风险与注意事项

### 11.1 最大风险：继续混用字段

如果仍然让 `sourceKind` 同时承担“媒体类型”和“流程类型”职责，后续代码会越来越难维护。

### 11.2 第二风险：只改前端，不改项目数据模型

如果只改表单，不记录 `targetSites`，漏发问题不会真正解决。

### 11.3 第三风险：把单集硬塞回旧编辑器

这样会导致：

1. 表单更臃肿
2. 判断更复杂
3. 单集体验无法真正变轻

### 11.4 第四风险：完成页仍只看成功链接

这样用户还是不知道“还有哪些目标站点没发”。

## 12. 推荐优先级

第一优先级：

1. `projectMode`
2. 模式选择弹窗
3. 单集独立编辑器
4. `targetSites` 持久化
5. 发布页未完成提示

第二优先级：

1. 项目列表模式筛选
2. 完成页强化提示
3. Dashboard 模式统计

第三优先级：

1. 上一集继承
2. 批量创建
3. 剧名分组与批量补发

## 13. 实施顺序建议

建议严格按下面顺序推进：

1. 拆模型
2. 做兼容
3. 重做创建入口
4. 落单集编辑器
5. 打通单集内容生成
6. 打通单集发布页
7. 打通完成页与项目列表提醒
8. 最后补文案和说明

不要反过来先做“批量创建单集”或“上一集继承”。

如果基础模型没拆干净，这些增强功能只会把问题放大。

## 14. 建议的后续开发任务单

可直接拆成以下任务：

1. `feat(project): introduce projectMode and compatibility mapping`
2. `feat(create): add mode selection dialog before project creation`
3. `feat(episode): add dedicated episode create/edit workflow`
4. `feat(content): add episode content generation pipeline`
5. `feat(publish): persist targetSites and compute missing targets`
6. `feat(ui): show missing publish targets in publish/completion/list views`
7. `docs(workflow): update quickstart and guide for episode/feature split`

---

这份文档的目标不是描述一次临时修补，而是明确：后续应该把“单集”和“合集 / 电影”变成两个清晰、长期可维护的工作流。
