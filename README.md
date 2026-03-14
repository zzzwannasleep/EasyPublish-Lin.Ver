# Nexus Publish

`Nexus Publish` 是一个基于 Electron + Vue 3 + TypeScript 的桌面发布工作台，面向 PT / NexusPHP 发布流程。这个仓库仍然沿用 `EasyPublish-Lin.Ver` 的历史仓库名，但当前桌面应用、构建产物和后续重构方向都已经切换到 `Nexus Publish`。

## 当前定位

项目已经不再是单纯的“自动发布脚本”，而是在把旧 EasyPublish 工作流逐步收口为一个以“项目”为中心的桌面应用：

- 本地创建、管理和继续编辑发布项目
- 区分 `单集` 与 `合集 / 电影` 两套创建与发布流程
- 记录目标站点、发布结果、失败记录和缺失站点
- 管理 PT 站点账号、Cookie / Token、代理与诊断日志
- 用新的 adapter 链路处理 NexusPHP 站点元数据拉取、校验和种子发布
- 保留 Bangumi、Mikan、MioBT、Nyaa、主站发布等旧链路的兼容入口

## 当前已落地的能力

- 新的项目工作台、项目列表、项目详情和阶段路由
- 单集项目专用创建表单与编辑器
- 合集 / 电影项目保留 `quick`、`file`、`template` 三种内容来源
- PT 站点账号管理，支持录入自定义 NexusPHP / UNIT3D 站点
- NexusPHP adapter：站点元数据、分类 / 标签 / 子分类、发布校验、发布请求、原始响应诊断
- 发布历史持久化，可回看成功链接与失败记录
- 敏感字段开始走安全存储兼容迁移

说明：

- `NexusPHP` 是当前已经接入的新适配器主链路。
- `UNIT3D` 目前以站点录入和后续扩展占位为主，还不是完整对等能力。
- 旧发布流程仍然存在，因此当前状态更准确地说是“新项目工作台 + 兼容旧发布引擎”的混合阶段。

## 技术结构

- `src/main`：主进程服务、存储、站点适配器、IPC 注册
- `src/preload`：渲染层桥接与类型契约
- `src/renderer`：桌面 UI、视图、功能模块和本地化文案
- `src/shared`：项目、站点、发布相关共享类型
- `docs`：重构规划、实现 backlog 和单双流工作流方案

## 开发

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run build
npm run build:win
npm run build:mac
npm run build:linux
```

说明：

- `npm run build` 会先执行类型检查，再构建 Electron 应用。
- `npm run build:mac` 必须在 macOS 主机上运行；在 Windows 上调用会被 `electron-builder` 平台限制拦住。
- 当前仓库已经保留 Linux 构建脚本，但产品规划文档仍以 Windows / macOS 为主要桌面分发目标。

## 关键文档

- `docs/easypublish-redesign-plan.md`：整体产品定位与重构约束
- `docs/implementation-backlog.md`：当前实现状态、阶段拆分和验收记录
- `docs/episode-feature-workflow-plan.md`：单集 / 合集双工作流设计

## 仓库状态

- Electron 应用已经在仓库根目录运行和打包
- 旧的 Tauri / Rust 原型不再作为当前主工作区的一部分
