# 剧项目工作台后续清单

## 1. 文档定位

这份文档用于承接当前剧项目工作台的实现进度和后续任务拆分。

它主要回答四个问题：

1. 当前第一轮已经完成了什么
2. 还有哪些关键能力没有落地
3. 这些未完成项应该按什么顺序推进
4. 每一项大致对应哪些文件

配套参考文档：

- [episode-feature-workflow-plan.md](./episode-feature-workflow-plan.md)
- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md)
- [series-publish-profile-wireframes.md](./series-publish-profile-wireframes.md)

---

## 2. 当前已完成

### 2.1 页面结构与主心智

- [x] 剧集模式已经从“直接进单条草稿”改成“先进入剧项目工作台”
- [x] 页面主结构已经改成：
  - 顶部摘要区
  - 横向发布配置卡片带
  - 中部发布配置编辑区
  - 右侧当前集执行区
- [x] 用户可见主文案已经从“模板 / 矩阵”切到“发布配置”
- [x] 新增一集后，已经有三选一轻引导：
  - 套用默认配置
  - 从上一集继承
  - 从空白开始

### 2.2 数据与桥接

- [x] `SeriesProjectWorkspace` 已支持 `publishProfiles`
- [x] 读取工作区时已兼容旧 `variantTemplates`
- [x] 已新增保存 / 删除发布配置接口
- [x] IPC / preload / renderer bridge 已接通新接口
- [x] 版本已记录以下关联摘要：
  - `publishProfileId`
  - `publishProfileName`
  - `targetSites`
  - `title`

### 2.3 当前实现文件

- [x] UI 主体已落到 [SeriesProjectWorkspace.vue](../src/renderer/src/features/project-editor/SeriesProjectWorkspace.vue)
- [x] 文案已补到：
  - [zh-CN/workflow.ts](../src/renderer/src/locales/messages/zh-CN/workflow.ts)
  - [en-US/workflow.ts](../src/renderer/src/locales/messages/en-US/workflow.ts)
- [x] 数据层已落到：
  - [src/shared/types/project.ts](../src/shared/types/project.ts)
  - [src/main/services/project-service.ts](../src/main/services/project-service.ts)

### 2.4 已验证

- [x] `npm run build` 已通过

---

## 3. P1：先把发布配置做成稳定对象

这一阶段是后续所有功能的前提。

目标不是继续堆 UI，而是先把“发布配置”从界面概念变成真正稳定的持久化对象。

### 3.1 版本快照

- [x] 在版本层新增完整的 `publishProfileSnapshot`
- [x] 快照应冻结创建版本时使用的发布配置内容
- [x] 不能只依赖 `publishProfileId` 回查当前最新配置

建议字段至少包括：

- [x] 配置名称
- [x] 默认清晰度组合
- [x] 默认字幕组合
- [x] 默认目标站点
- [x] 标题模板
- [x] 站点稿模板
- [x] 后续补充的站点默认字段

原因：

- [x] 历史版本必须可追溯
- [x] 项目级配置后续修改时，历史版本不能漂移

对应参考：

- [episode-feature-workflow-plan.md](./episode-feature-workflow-plan.md) 中 `16.3 配置与版本的关系`
- [episode-feature-workflow-plan.md](./episode-feature-workflow-plan.md) 中 `16.4 为什么要有快照`

大致改动位置：

- [src/shared/types/project.ts](../src/shared/types/project.ts)
- [src/main/services/project-service.ts](../src/main/services/project-service.ts)

### 3.2 版本创建链路写入快照

- [x] 单个创建版本时写入 `publishProfileSnapshot`
- [x] 批量创建版本时写入 `publishProfileSnapshot`
- [x] 从上一集继承版本时保留或复制 `publishProfileSnapshot`
- [x] 读取工作区时回填快照数据

### 3.3 发布配置对象继续收口

- [x] 明确发布配置对象的最终字段边界
- [x] 继续保留旧 `variantTemplates` 兼容读取
- [x] 逐步弱化旧命名在实现层的存在感

---

## 4. P2：补齐发布配置编辑区

这一阶段对应 UI 规格里的中部发布配置编辑区。

当前第一轮只完成了：

- 基础信息
- 标题模板
- 共享站点稿模板
- 默认站点选择
- 站点字段占位区

还没有真正做到“按站点、按能力、按字段类型”编辑。

### 4.1 站点稿模板按站点展开

- [x] 把共享站点稿模板改成按站点卡片展示
- [x] 每个站点卡片至少支持：
  - [x] 是否启用
  - [x] 是否沿用全局标题
  - [x] 标题覆盖模板
  - [x] 正文模板
  - [x] 站点说明
- [x] 未启用站点保持折叠或弱化态

对应参考：

- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md) 中 `8.4 站点稿模板编辑`

当前实现位置：

- [SeriesProjectWorkspace.vue](../src/renderer/src/features/project-editor/SeriesProjectWorkspace.vue)

### 4.2 站点默认字段区真正可编辑

- [x] 只显示已勾选站点
- [x] 且只显示当前可发布的站点
- [x] 按字段类型渲染：
  - [x] 必填
  - [x] 选填
  - [x] 只读
  - [x] 来自项目默认值
- [x] 缺少必填默认字段时展示警示
- [x] 允许暂存，但应用到当前集时需二次提示

对应参考：

- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md) 中 `8.6 站点默认字段区`

### 4.3 标题预设继续增强

- [x] 继续保留实时预览
- [x] 缺少变量值时显示占位态，不直接报错
- [x] 预览和保存校验分开

### 4.4 保存栏继续增强

- [x] 当前已有 `保存 / 另存为 / 复制 / 应用 / 删除`
- [ ] 后续可继续补：
  - [ ] 更清晰的脏状态提示
  - [x] 保存失败时的区块级错误提示
  - [x] 配置切换前更明确的保存提示

---

## 5. P3：补齐右侧“当前集执行区”

当前右侧已经有：

- 集列表
- 当前集摘要
- 套用默认配置 / 套用当前配置 / 继承
- 手动新增版本
- 版本列表
- 打开编辑 / 检查 / 发布

但还没有把“当前集差异字段”真正独立出来。

### 5.1 当前集差异字段区

- [x] 新增独立卡片：`本集差异字段`
- [x] 第一轮建议至少包含：
  - [x] 集号
  - [x] 分集标题
  - [x] 资源路径 / 种子
  - [x] 当前集临时站点覆盖字段
- [x] 不重复展示项目级长期稳定配置

对应参考：

- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md) 中 `8.7 本集差异字段`

### 5.2 应用发布配置后的差异提示

- [x] 当某集已套用某配置时，明确显示：
  - [x] 哪些值来自发布配置
  - [x] 哪些值被本集覆盖
  - [x] 哪些值被当前版本覆盖

### 5.3 新建下一集的高频优化

- [x] 保留当前三选一引导
- [x] 后续可增加“一步新建并套用默认配置”
- [x] 后续可增加“最近一次推荐动作”

对应参考：

- [episode-feature-workflow-plan.md](./episode-feature-workflow-plan.md) 中 `17.4 Phase D`

---

## 6. P4：把版本列表补成真正的执行视图

当前版本卡片已经能显示：

- 版本名称
- 来源配置
- 标题预览
- 目标站点数量
- 更新时间
- 载入编辑
- 回写版本

但还没做到文档要求的执行态展示。

### 6.1 发布进度统计

- [x] 每个版本卡片显示：
  - [x] 已发布站点数
  - [x] 待补发站点数
  - [x] 失败站点数
- [x] 进度统计应优先基于：
  - [x] `variant.targetSites`
  - [x] 版本级发布结果

### 6.2 执行状态标签

- [x] 明确标出当前正在编辑的版本
- [x] 明确标出是否沿用了某个发布配置
- [x] 明确标出缺失站点或失败站点

### 6.3 低频动作收口

- [x] 当前保留：
  - [x] 载入编辑
  - [x] 回写版本
- [ ] 后续可考虑补：
  - [x] 删除版本
  - [x] 复制版本
  - [x] 仅补发缺失站点

对应参考：

- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md) 中 `8.8 版本列表`

---

## 7. P5：站点能力和账号状态接进来

这是“发布配置”真正有价值的关键阶段。

### 7.1 默认站点选择的三态

- [x] 可发布
- [x] 已配置但当前无权限
- [x] 未配置账号

展示要求：

- [x] 可发布：正常勾选
- [x] 无权限：显示但不可编辑，并说明原因
- [x] 未配置账号：显示引导去账号配置

对应参考：

- [series-publish-profile-ui-spec.md](./series-publish-profile-ui-spec.md) 中 `8.5 默认发布站点选择`

### 7.2 站点字段 schema 驱动

- [x] 站点适配器输出字段 schema
- [x] 前端按 schema 渲染字段
- [x] 尽量不在 UI 层继续硬编码站点分支

对应参考：

- [episode-feature-workflow-plan.md](./episode-feature-workflow-plan.md) 中 `17.3 Phase C`

### 7.3 区块级错误与禁用原因

- [x] 区块错误就地展示
- [x] 禁用项必须说明原因
- [x] 不再用单纯灰掉表达所有异常状态

---

## 8. P6：把旧编辑器真正下沉成版本编辑器

当前仍然是：

- 工作台承接“项目 / 集 / 版本”结构
- 但正文编辑主体还是复用旧 `EpisodeEdit.vue`

这意味着当前仍是过渡态。

### 8.1 角色边界收口

- [x] `SeriesProjectWorkspace` 负责：
  - [x] 发布配置
  - [x] 当前集执行
  - [x] 版本选择与状态
- [x] 版本编辑器负责：
  - [x] 当前版本内容编辑
  - [x] 当前版本站点字段调整
  - [x] 当前版本生成与发布输入

### 8.2 编辑器下沉

- [x] 把 `EpisodeEdit.vue` 逐步明确成版本编辑器
- [x] 项目级默认值、发布配置默认值、当前集差异值、当前版本覆盖值要真正分层
- [x] 编辑器内能看出当前值来源

对应位置：

- [SeriesProjectWorkspace.vue](../src/renderer/src/features/project-editor/SeriesProjectWorkspace.vue)
- [EpisodeEdit.vue](../src/renderer/src/components/EpisodeEdit.vue)

---

## 9. 建议实现顺序

为了避免继续把过渡逻辑越堆越厚，建议按下面顺序推进。

### Step 1：先做 P1

先把发布配置快照做完整。

原因：

- 没有快照，后面所有“站点字段 / 站点稿 / 历史追溯”都会漂

### Step 2：再做 P2

把发布配置编辑区补完整。

原因：

- 先让“发布配置”真正能描述“这部剧平时怎么发”

### Step 3：再做 P3 + P4

补齐当前集差异区和版本执行状态。

原因：

- 这一步会把“配置区”和“执行区”真正分开

### Step 4：最后做 P5 + P6

把站点能力和版本编辑器彻底收口。

原因：

- 这部分动到的链路更多，放在前面结构稳定之后更稳

---

## 10. 可直接跟进的下一批任务单

### Task Group A：数据层

- [x] `feat(series): add publishProfileSnapshot to variant model`
- [x] `feat(series): persist publish profile snapshot on variant creation`
- [x] `feat(series): preserve publish profile snapshot during inherit`
- [x] `refactor(series): normalize publish profile read/write paths`

### Task Group B：配置编辑区

- [x] `feat(series-ui): split shared site draft into per-site cards`
- [x] `feat(series-ui): render editable site default fields for enabled sites`
- [x] `feat(series-ui): validate required site default fields before apply`
- [x] `feat(series-ui): source site field schema from site catalog adapters`
- [x] `feat(series-ui): surface project draft defaults as field source`

### Task Group C：执行区

- [x] `feat(series-ui): add episode difference card`
- [x] `feat(series-ui): show per-variant publish progress summary`
- [x] `feat(series-ui): support refill missing target sites by variant`

### Task Group D：编辑器下沉

- [x] `refactor(editor): clarify EpisodeEdit as variant editor`
- [x] `feat(editor): surface field source from project/profile/episode/variant`

---

## 11. 当前结论

现在这套实现已经完成了“第一轮主心智改造”：

- 用户先看到发布配置，而不是模板矩阵
- 页面清楚地区分了配置区和执行区
- 新建下一集后能立即选择配置入口

但它还没有完成“完整的发布配置系统”。

真正意义上的完成，至少还要补上：

- [x] 发布配置快照
- [x] 按站点配置站点稿模板
- [x] 按 schema 渲染站点默认字段
- [x] 当前集差异字段
- [x] 版本级发布进度统计
- [x] 编辑器彻底下沉为版本编辑器

---

## 12. 未完成项梳理（2026-03-15）

### 12.1 发布配置编辑区收尾

- [x] 继续把站点字段 schema 扩到真正的 `选填 / 只读` 字段，而不只是在 UI 上预留标签
- [x] 把 `nexusphp / unit3d` 等 PT 站点的字段 schema 下沉到 adapter 输出
- [x] 为字段区补上区块级错误和更明确的禁用原因提示

### 12.2 当前集执行区

- [x] 新增“本集差异字段”卡片，明确项目级 / 发布配置 / 本集差异的边界
- [x] 在版本卡片里展示已发布 / 待补发 / 失败统计
- [x] 支持按版本补发缺失目标站点

### 12.3 编辑器下沉

- [x] 继续弱化 `EpisodeEdit.vue` 的旧入口语义，明确当前是在编辑版本
- [x] 在编辑器里标出字段值来源：项目默认值 / 发布配置 / 本集覆盖 / 当前版本覆盖
- [x] 把版本编辑器和工作台之间的职责边界继续收口

### 12.4 数据层与读写路径

- [x] 继续收口发布配置读写路径，减少 `publishProfiles / variantTemplates` 双轨兼容残留
- [ ] 后续若把更多 PT 站点字段纳入发布配置，需要同步扩展版本创建时写回 `config.json` 的链路
