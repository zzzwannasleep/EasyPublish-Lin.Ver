# Nexus Publish

`Nexus Publish` 是一个基于 `Electron + Vue 3 + TypeScript` 的桌面发布工作台，面向 PT / NexusPHP 发布场景。

这个仓库来自对 `EasyPublish` 的二次改造，当前重点已经从“单次发布脚本”转向“以项目为中心的桌面工作流”。

## 当前定位

- 本地创建、管理、继续编辑发布项目
- 支持单集项目，以及合集 / 电影类项目
- 使用 Markdown 编写正文模板，并在发布时自动转换为 HTML / BBCode
- 管理站点账号、Cookie / Token、代理和日志
- 通过新的 adapter 链路处理 NexusPHP 站点元数据、校验和发布
- 保留部分旧发布链路的兼容入口，便于逐步迁移

## 当前能力

- 项目列表、项目详情、阶段化工作流页面
- 剧集项目工作台与发布配置管理
- 多站点账号管理，支持自定义 NexusPHP / UNIT3D 站点录入
- 发布历史持久化，可回看成功链接和失败记录
- 正文模板统一改为 Markdown 编辑，并自动派生 HTML / BBCode
- GitHub Actions 可构建 Windows / macOS / Linux 安装包并发布到 Releases

## 技术栈

- Electron
- Vue 3
- TypeScript
- electron-vite
- electron-builder
- lowdb

## 开发环境

建议使用：

- Node.js 20
- npm 10+
- Windows 或 macOS

首次安装依赖：

```powershell
npm install
```

启动开发环境：

```powershell
npm run dev
```

## 构建

通用构建：

```powershell
npm run build
```

平台构建：

```powershell
npm run build:win
npm run build:mac
npm run build:linux
```

说明：

- `npm run build` 会先执行 TypeScript 类型检查，再执行 Electron 构建。
- `npm run build:win` 会输出 Windows 安装包和更新元数据。
- `npm run build:mac` 需要在 macOS 主机上运行。
- `npm run build:linux` 当前脚本会构建 Linux ARM64 的 `deb` 包。

## GitHub Release 工作流

仓库内置了 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

它支持两种触发方式：

1. 推送版本标签，例如 `v0.1.0`
2. 在 GitHub Actions 中手动运行 `Release`

工作流会：

- 按发布版本重写 `package.json` 版本号
- 分别在 Windows / macOS / Linux runner 上打包
- 汇总安装包、压缩包、更新元数据
- 自动创建或更新 GitHub Release
- 将构建产物直接上传到 Release Assets

发布说明默认读取仓库根目录的 `NEW.md`。

## 目录结构

```text
src/
  main/        主进程服务、存储、站点适配器、IPC 注册
  preload/     渲染层桥接与类型定义
  renderer/    桌面端 UI、页面与功能模块
  shared/      项目、站点、发布相关共享类型
docs/          重构规划、实现计划与工作流文档
build/         打包资源与构建脚本
scripts/       辅助脚本
```

## 重要文档

- [docs/easypublish-redesign-plan.md](docs/easypublish-redesign-plan.md)
- [docs/implementation-backlog.md](docs/implementation-backlog.md)
- [docs/episode-feature-workflow-plan.md](docs/episode-feature-workflow-plan.md)
- [QUICKSTART.md](QUICKSTART.md)
- [GUIDE.md](GUIDE.md)

## 仓库状态

- 当前主线是 Electron 桌面版
- 旧的 Tauri / Rust 原型不再作为当前主工作区
- 项目仍在持续重构中，部分旧链路仍处于兼容阶段

## 致谢

- 原项目：<https://github.com/vcb-s/EasyPublish>
