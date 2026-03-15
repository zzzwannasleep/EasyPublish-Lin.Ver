# 剧集项目 / 合集电影双流程改造方案

## 1. 背景

当前系统虽然已经引入了 `projectMode='episode' | 'feature'`，但现有实现本质上仍然是：

- 一个项目对应一份 `config.json`
- 一份 `config.json` 对应一个标题
- 一个标题对应一个种子
- 一个种子对应一组发布结果

这套结构适合：

- 合集
- 剧场版
- 电影
- 一次性准备完整发布稿的项目

但它不适合下面这种更常见的连载工作流：

- 一个项目代表一部剧
- 这部剧下面有很多集
- 每一集又有多个版本
- 每个版本可能有不同的清晰度、字幕、目标站点和发布进度

例如：

- `Project`: 《某动画 第二季》
- `Episode`: `01`
- `Variant A`: `1080p / 简中`
- `Variant B`: `2160p / 双语`

如果继续把“单集模式”理解成“一个项目就是一集”，后续会持续遇到这些问题：

1. 同一部剧无法集中管理
2. 同一集多个版本会互相覆盖
3. 发布进度只能按“当前这一条”看，不能按“整部剧”看
4. 很难做“继承上一集”“补发缺失版本”“按剧分组”这类高频需求

因此，这条线不应该只停留在“给单集加个表单”，而应该把模型改成真正的“剧项目工作台”。

## 2. 结论

核心结论只有两条：

1. `feature` 模式继续保留“一个项目 = 一个可发布成品”的现有模型
2. `episode` 模式应升级为“一个项目 = 一部剧”，真正可发布的最小单位改为“某一集的某个版本”

也就是说，用户看到的模型应该是：

- `剧项目`
- `集`
- `版本`

而不是：

- `单集项目`

为了控制改造成本，建议短期内保留内部字段值 `projectMode='episode'`，但用户可见文案从“单集模式”逐步改成“剧集模式”或“连载模式”。

## 3. 设计原则

### 3.1 先区分“容器”和“可发布单元”

在剧集模式下：

- `Project` 是容器
- `Variant` 才是可发布单元

这两个角色不能再混在一个结构里。

### 3.2 先做层级拆分，再做效率功能

如果底层还是“一项目一配置一发布结果”，那么下面这些功能都会越做越乱：

- 继承上一集
- 一键复制版本规格
- 同剧按集管理
- 批量补发
- 统计哪些版本还没发

所以必须先拆模型，再做增强功能。

### 3.3 默认值放上层，执行状态放下层

建议字段归属如下：

- `Project`：剧名、季度、默认发布站点、默认分类、默认发布规格、标题模板、简介模板
- `Episode`：集号、分集标题、分集备注、播出日期
- `Variant`：种子、标题、清晰度、字幕语言、编码、目标站点覆盖、发布阶段、发布结果

不要把所有字段都堆在同一张表单里。

### 3.4 防漏发必须以 `Variant.targetSites` 为准

发布结果只能说明“已经发了什么”，不能说明“本来应该发什么”。

因此：

- 计划发布站点必须持久化
- 应该挂在 `Variant` 上，而不是只挂在剧项目上

原因很简单：

- 同一部剧的 `1080p / 简中` 和 `2160p / 双语` 目标站点可能不同
- 同一集不同版本的补发进度也可能不同

### 3.5 尽量复用现有发布器，不强行重写底层能力

当前发布流程、内容生成、站点适配，本质上都更接近“发布某个版本”。

因此最稳的方案不是推翻它们，而是：

- 在上层新增剧项目和集的管理层
- 在下层继续复用现有“单条发布配置”的执行链路

换句话说，现有 `episode` 编辑器更像未来的“版本编辑器”，而不是“剧项目编辑器”。

## 4. 目标产品结构

### 4.1 创建入口

新建项目第一步只做模式选择：

- `剧集模式`
- `合集 / 电影模式`

选择后分流：

- `剧集模式` -> 创建剧项目壳
- `合集 / 电影模式` -> 继续走现有 `quick / file / template`

这里不应该再让用户在第一步面对：

- `quick`
- `file`
- `template`

因为这三个概念描述的是“生成方式”，不是“我要发布什么”。

### 4.2 剧集模式总流程

推荐结构：

1. 创建剧项目
2. 进入剧项目主页
3. 新增或选择某一集
4. 在该集下新增一个或多个版本
5. 打开某个版本进入编辑 / 生成 / 发布
6. 在剧项目主页查看整体进度

### 4.3 合集 / 电影模式总流程

继续保留当前结构：

1. 创建项目
2. 编辑项目
3. 检查输出
4. 发布种子
5. 发布主站
6. 完成结果

## 5. 数据模型建议

### 5.1 命名建议

用户视角：

- `Project` = 项目
- `Episode` = 集
- `Variant` = 版本

实现视角建议逐步演进为：

- `Project`: 顶层项目
- `PublishUnit`: 真正可发布单元

其中：

- `feature` 项目有且只有一个 `PublishUnit`
- `episode` 项目有很多 `PublishUnit`，每个 `PublishUnit` 对应“某一集的某一版本”

如果短期不想一次性引入 `PublishUnit` 命名，也至少要在文档和代码层明确：

- 当前 `PublishProject` 更像“发布单元摘要”
- 未来不能继续把它当成“剧项目”本身

### 5.2 顶层项目

```ts
type ProjectMode = 'episode' | 'feature'

interface ProjectSummary {
  id: number
  name: string
  projectMode: ProjectMode
  workingDirectory: string
  status: 'draft' | 'publishing' | 'published'
  createdAt: string
  updatedAt: string
}
```

剧集项目建议扩展为：

```ts
interface SeriesProject extends ProjectSummary {
  projectMode: 'episode'
  series: {
    titleCN?: string
    titleEN: string
    titleJP?: string
    seasonLabel?: string
    releaseTeam?: string
  }
  defaults: {
    targetSites: SiteId[]
    categoryBangumi?: string
    categoryNyaa?: string
    sourceType?: string
    videoCodec?: string
    audioCodec?: string
    summaryTemplate?: string
    variantPresets: VariantPreset[]
  }
  stats: {
    episodeCount: number
    variantCount: number
    pendingVariantCount: number
    publishedVariantCount: number
  }
}
```

合集 / 电影项目可以继续接近当前模型：

```ts
interface FeatureProject extends ProjectSummary {
  projectMode: 'feature'
  sourceKind: 'quick' | 'file' | 'template'
}
```

### 5.3 集模型

```ts
interface ProjectEpisode {
  id: number
  projectId: number
  episodeLabel: string
  episodeTitle?: string
  sortIndex: number
  airDate?: string
  note?: string
  stats: {
    variantCount: number
    pendingVariantCount: number
    publishedVariantCount: number
  }
  createdAt: string
  updatedAt: string
}
```

字段归属说明：

- `episodeLabel`：`01`、`02`、`SP1`、`01-02`
- `episodeTitle`：分集标题
- `sortIndex`：用于稳定排序，不依赖字符串比较

### 5.4 版本模型

```ts
interface EpisodeVariant {
  id: number
  projectId: number
  episodeId: number
  name: string
  path: string
  title: string
  stage: 'edit' | 'torrent_publish' | 'completed'
  status: 'draft' | 'publishing' | 'published'
  targetSites: SiteId[]
  publishResults: PublishResult[]
  spec: {
    sourceType: string
    resolution: string
    videoCodec: string
    audioCodec: string
    subtitleProfile: string
    variantLabel?: string
  }
  torrentPath: string
  createdAt: string
  updatedAt: string
}
```

这里有两个关键点：

1. `resolution` 和 `subtitleProfile` 必须拆字段，不能只拼在标题里
2. `targetSites` 必须在版本层可覆盖

字幕建议不要只用一个自由字符串，但也不要一开始就过度枚举死：

```ts
type SubtitleProfile =
  | 'chs'
  | 'cht'
  | 'eng'
  | 'chs-eng'
  | 'cht-eng'
  | 'bilingual'
  | 'custom'
```

如果用户的圈内命名是：

- `简`
- `繁`
- `英`
- `双语`

完全可以在 UI 上用这些文案，底层再映射到稳定值。

### 5.5 版本预设

为了支持“同一部剧高频重复发不同版本”，建议增加版本预设：

```ts
interface VariantPreset {
  id: string
  name: string
  sourceType: string
  resolution: string
  videoCodec: string
  audioCodec: string
  subtitleProfile: string
  targetSites: SiteId[]
}
```

例如：

- `1080p / 简中`
- `2160p / 双语`

新增一集时可以直接从预设生成多个版本草稿，而不是每次重复填写。

### 5.6 当前 `config.json` 的定位

当前 `Config.PublishConfig` 仍然有价值，但未来它应该只代表“一个版本的发布配置”，而不是整个剧项目。

因此建议：

- `feature` 项目：项目根目录直接保留当前 `config.json`
- `episode` 项目：每个版本目录各自拥有一份 `config.json`

也就是说，在剧集模式下：

- `project.json` 描述剧项目
- `episode.json` 描述某一集
- `config.json` 描述某个版本

### 5.7 建议的目录结构

```text
Series Project Root/
  project.json
  episodes/
    E01/
      episode.json
      variants/
        1080p-chs/
          config.json
          bangumi.html
          nyaa.md
          acgrip.bbcode
          xxx.torrent
        2160p-bilingual/
          config.json
          bangumi.html
          nyaa.md
          acgrip.bbcode
          xxx.torrent
    E02/
      episode.json
      variants/
        ...
```

这个结构的优点：

1. 版本目录可以继续复用现有生成和发布逻辑
2. 人工查看文件时也容易理解
3. 后续做导入、复制、批量操作都更自然

## 6. 字段归属建议

为了避免未来表单爆炸，建议从一开始就把字段分清：

### 6.1 放在剧项目上的字段

- 剧名中英日
- 季 / 篇章名称
- 默认发布组
- 默认 Bangumi / Nyaa 分类
- 默认目标站点
- 默认简介模板
- 默认版本预设

### 6.2 放在集上的字段

- 集号
- 分集标题
- 分集备注
- 播出日期

### 6.3 放在版本上的字段

- 清晰度
- 字幕语言
- 视频编码
- 音频编码
- 源类型
- 种子文件
- 发布标题
- 版本简介补充
- 版本目标站点
- 发布结果

一句话概括：

- “这一整部剧共享的东西”放项目上
- “这一集共享的东西”放集上
- “这一版独有的东西”放版本上

## 7. UI 与交互建议

### 7.1 新建项目页

第一步：

- `剧集模式`
- `合集 / 电影模式`

第二步分流：

- 剧集模式：只创建剧项目壳，录入剧信息和默认预设
- 合集 / 电影模式：继续现有 `quick / file / template`

### 7.2 剧项目主页

剧项目主页应该成为剧集模式的主工作台，而不是一上来就进入当前的版本编辑表单。

建议包含：

- 剧信息卡片
- 版本预设管理
- 集列表
- 最近待发布版本
- 发布统计
- “新增一集”
- “从上一集复制”

### 7.3 集详情页

进入某一集后，重点应该是“版本列表”，而不是直接开始填发布内容。

建议包含：

- 当前集基础信息
- 版本列表
- 每个版本的发布状态
- 每个版本的目标站点完成度
- “新增版本”
- “从预设生成版本”

### 7.4 版本编辑器

当前 `EpisodeEdit.vue` 建议逐步下沉为“版本编辑器”：

- 录入标题
- 录入种子
- 调整版本规格
- 选择目标站点
- 生成 `html / md / bbcode`
- 进入 BT 发布页

也就是说，它未来更适合改名为：

- `EpisodeVariantEdit.vue`

而不应该承担整个剧项目的管理职责。

### 7.5 发布页

发布页仍然围绕“当前版本”工作，但需要补两个层次的提示：

1. 当前版本还差哪些站点没发
2. 当前剧项目还有哪些集 / 版本没完成

第 1 层是主视角，第 2 层是辅助视角。

### 7.6 完成页

完成页不能再默认表达“整部剧都完成”，它只能表达：

- 这个版本完成了什么
- 还差哪些目标站点

如果需要展示整部剧进度，应该回到剧项目主页看。

### 7.7 项目列表

项目列表在剧集模式下应展示聚合信息，而不是只展示一个版本的链接：

- 剧项目名
- 集数
- 版本数
- 未完成版本数
- 最近更新
- 快速进入最近未完成版本

## 8. 与当前代码的对应关系

下面这部分是为了让后续实现不走偏。

### 8.1 当前实现的真实约束

当前这些结构本质上都还是“单条发布配置”：

- `src/shared/types/project.ts` 的 `PublishProject`
- `src/config.d.ts` 的 `Content_episode`
- `src/main/services/project-service.ts` 创建的 `config.json`
- `src/renderer/src/components/EpisodeEdit.vue`
- `src/main/services/content-service.ts` 的 `createWithEpisode`

它们都只适合代表“一个可发布版本”。

因此，不建议继续扩展它们去兼容“剧项目 + 多集 + 多版本”的所有信息。

### 8.2 推荐的重构边界

建议把当前模型拆成两层：

1. 顶层 `Project`
2. 发布单元 `Variant`

过渡期可以这样理解：

- 当前 `feature` 项目的 `Project` 和 `Variant` 是 1:1
- 当前 `episode` 项目在未来会变成：
  - 一个剧项目
  - 一个集
  - 一个版本

### 8.3 旧 `episode` 数据的迁移映射

如果历史上已经创建了一批 `episode` 项目，迁移规则建议如下：

1. 创建一个新的剧项目
2. 从原 `config.json` 读取剧名、季信息
3. 自动创建一个 `Episode`
4. 自动创建一个 `Variant`
5. 原 `publishResults` 全部挂到该 `Variant`

这样历史数据不会丢，但新的抽象层也能建立起来。

如果短期内不做自动迁移，也至少要允许：

- 旧 `episode` 项目继续按旧方式打开
- 新建的剧集模式项目走新结构

## 9. 推荐的实施顺序

### Phase 1：先改术语和设计边界

目标：

- 用户视角从“单集模式”改成“剧集模式”
- 团队内部统一认知：真正可发布的是版本，不是剧项目

任务：

1. 更新文档
2. 更新创建页文案
3. 不急着改底层执行链

验收：

- 后续开发不再把 `episode` 误解为“一项目一集”

### Phase 2：建立剧项目 / 集 / 版本三层结构

目标：

- 新增剧项目壳
- 新增集与版本的存储结构

任务：

1. 新增顶层项目元数据
2. 新增集记录
3. 新增版本记录
4. 建立版本目录结构

验收：

- 一个剧项目下可以创建多集
- 一集下可以创建多个版本

### Phase 3：把当前单集编辑器下沉为版本编辑器

目标：

- 复用现有发布链

任务：

1. `EpisodeEdit.vue` 改造成版本编辑器
2. `Content_episode` 只服务版本级配置
3. `createWithEpisode` 只对版本目录生效

验收：

- 任意一个版本都能独立生成内容并进入发布页

### Phase 4：聚合展示与防漏发

目标：

- 让剧项目工作台真正有管理价值

任务：

1. 剧项目主页显示集 / 版本统计
2. 项目列表显示未完成版本数
3. 发布页显示当前版本剩余目标站点
4. 完成页禁止误导用户“整剧已完成”

验收：

- 一眼看出哪个剧、哪一集、哪个版本还没发完

### Phase 5：效率增强

目标：

- 让剧集模式真正适合高频日常使用

任务：

1. 从上一集复制
2. 按版本预设批量生成
3. 批量创建下一集
4. 批量补发缺失站点

## 10. 验收标准

### 功能验收

1. 新建剧集模式项目后，得到的是“剧项目工作台”，不是直接的一条单集发布记录
2. 一个剧项目下可以有多集
3. 一集下可以有多个版本
4. 每个版本有独立的标题、种子、目标站点、发布结果
5. 一个版本的发布失败不会污染其他版本状态
6. 合集 / 电影模式保持现有能力不回退

### 交互验收

1. 用户创建项目时先按“我要发剧还是发电影”来思考
2. 用户在剧项目页可以看到整体进度
3. 用户在集页可以快速新增多个版本
4. 用户在版本页可以继续沿用熟悉的发布流程

### 技术验收

1. 现有内容生成和站点发布逻辑尽量复用
2. 历史 `feature` 数据不需要破坏性迁移
3. 历史 `episode` 数据有兼容策略
4. 文件目录结构能支撑后续批量操作

## 11. 明确不建议的方案

### 11.1 不建议继续把“单集项目”往上堆功能

如果继续沿用当前“一项目一配置”的单集模型，再往上叠：

- 多集
- 多版本
- 聚合进度
- 继承复制

最终只会得到一个越来越难维护的巨型对象。

### 11.2 不建议把多个版本塞进同一份 `config.json`

这样会导致：

1. 发布状态不独立
2. 文件产物互相覆盖
3. 发布器无法复用

### 11.3 不建议让项目级 `targetSites` 直接代表最终发布计划

项目级默认值可以有，但最终完成度必须按版本计算。

否则：

- `1080p` 发四站
- `2160p` 只发一站

这种常见场景就会失真。

## 12. 推荐的后续任务单

可以按下面的任务拆分：

1. `docs(workflow): redefine episode mode as series project with episode/variant hierarchy`
2. `feat(create): rename episode mode to series mode in user-facing copy`
3. `feat(project): add series project metadata and dashboard shell`
4. `feat(episode): add episode list and per-episode variant management`
5. `refactor(editor): turn EpisodeEdit into a variant editor`
6. `refactor(content): scope Content_episode and createWithEpisode to variant config`
7. `feat(progress): aggregate pending variants and missing target sites at project level`

---

这份方案的重点不是“把单集表单再优化一点”，而是明确新的长期方向：

- `feature` 继续是一条成品发布流
- `episode` 升级为剧项目工作台
- 真正可发布的对象是“某一集的某一版本”
