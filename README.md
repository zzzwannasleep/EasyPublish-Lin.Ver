# EasyPublish-Lin.Ver

一个更顺手的 PT 资源发布桌面工具，面向日常整理、识别、编辑与发布流程，尽量把重复操作收拢到同一个工作台里。

> 本项目为二次开发版本，当前仍在持续完善中。  
> 如果你在使用过程中遇到问题，欢迎前往 Issue 区反馈。

## 目录

- [功能亮点](#功能亮点)
- [页面预览](#页面预览)
- [使用教程](#使用教程)
- [Todo](#todo)
- [致谢](#致谢)

## 功能亮点

- 统一管理站点账号与登录状态
- 创建项目后集中维护标题、正文、站点字段与发布信息
- 支持导入 `.torrent` 后自动识别基础信息
- 支持通过 Bangumi 搜索并回写剧集信息
- 提供发布前预览与检查流程，减少手动遗漏
- 已发布项目可在列表中直接查看与继续维护
- 引入 OKP 的标题识别思路，提升常见命名场景下的处理效率

## 页面预览

### 总览页

<p align="center">
  <a href="https://github.com/user-attachments/assets/9d1bdfdb-7c26-418d-a7a7-e050cee87925">
    <img src="https://github.com/user-attachments/assets/9d1bdfdb-7c26-418d-a7a7-e050cee87925" alt="总览页预览" width="720" />
  </a>
</p>

启动软件后首先进入总览页，这里会展示最近项目，并提供到各个功能页面的快速入口。

### 新建项目

<p align="center">
  <a href="https://github.com/user-attachments/assets/e4aff6ac-8f3d-486e-8f43-6a824bcee8d6">
    <img src="https://github.com/user-attachments/assets/e4aff6ac-8f3d-486e-8f43-6a824bcee8d6" alt="新建项目页面预览" width="720" />
  </a>
</p>

可以选择 `剧集模式` 或 `合集 / 电影模式`。两者流程基本一致，主要用于区分不同发布场景。

### 项目列表

<p align="center">
  <a href="https://github.com/user-attachments/assets/c5eff2b9-4117-4b9d-9d2d-c876d57f51e0">
    <img src="https://github.com/user-attachments/assets/c5eff2b9-4117-4b9d-9d2d-c876d57f51e0" alt="项目列表页面预览" width="720" />
  </a>
</p>

项目列表中可以查看正在制作和已经发布的内容，方便统一管理发布记录。

### 站点账号与配置

<p align="center">
  <a href="https://github.com/user-attachments/assets/25e0ff4b-bdc3-4ed5-a981-0e1032173620">
    <img src="https://github.com/user-attachments/assets/25e0ff4b-bdc3-4ed5-a981-0e1032173620" alt="站点账号与配置页面预览" width="360" />
  </a>
</p>

在这里管理需要发布的站点账号、导入配置，并进行登录检查。日志诊断页和使用说明页也可以辅助排查常见问题。

## 使用教程

> 提示：教程截图也已改为缩略图，阅读时更紧凑，需要细看时直接点击图片即可。

以下以 [Anibt](https://anibt.net/) 为例演示完整流程，其它站点可以按相同思路操作。

### 1. 登录站点并获取 API 密钥

打开站点账号页，填写你要发布的站点信息并准备登录。

<p align="center">
  <a href="https://github.com/user-attachments/assets/741426c8-147b-42f1-b8b9-97b2d0e7317c">
    <img src="https://github.com/user-attachments/assets/741426c8-147b-42f1-b8b9-97b2d0e7317c" alt="站点账号页" width="280" />
  </a>
</p>

进入 [字幕组仪表盘](https://anibt.net/groups)。

<p align="center">
  <a href="https://github.com/user-attachments/assets/1ac3cdd4-2c6a-4d31-998d-0c29a86b5a3f">
    <img src="https://github.com/user-attachments/assets/1ac3cdd4-2c6a-4d31-998d-0c29a86b5a3f" alt="字幕组仪表盘" width="720" />
  </a>
</p>

点击 `API 密钥`，创建新的密钥并完成保存。

<p align="center">
  <a href="https://github.com/user-attachments/assets/4eb98088-9e03-4d4b-90ed-246043e15193">
    <img src="https://github.com/user-attachments/assets/4eb98088-9e03-4d4b-90ed-246043e15193" alt="API 密钥入口" width="480" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/user-attachments/assets/6ac4c461-4b2c-4e30-afa8-88bdce6e80ef">
    <img src="https://github.com/user-attachments/assets/6ac4c461-4b2c-4e30-afa8-88bdce6e80ef" alt="API 密钥创建页面" width="300" />
  </a>
</p>

复制密钥后回到软件，粘贴并点击 `检查/登录`。右上角显示已登录即可说明配置成功。

<p align="center">
  <a href="https://github.com/user-attachments/assets/7ffcf7af-99b0-4874-b49d-d115e8174ce1">
    <img src="https://github.com/user-attachments/assets/7ffcf7af-99b0-4874-b49d-d115e8174ce1" alt="检查登录结果" width="720" />
  </a>
</p>

### 2. 新建项目

这里以转载上传拨雪寻春字幕组的《铃芽之旅》为例，演示通用流程。先点击新建项目，再选择 `剧集模式`。

<p align="center">
  <a href="https://github.com/user-attachments/assets/d14c7065-fb3e-4b29-bd7d-937d5587218b">
    <img src="https://github.com/user-attachments/assets/d14c7065-fb3e-4b29-bd7d-937d5587218b" alt="选择新建项目模式" width="720" />
  </a>
</p>

项目名称填写 `铃芽之旅`，然后点击 `创建项目`。

<p align="center">
  <a href="https://github.com/user-attachments/assets/73791478-26ba-4174-9387-3764ccc8f9f4">
    <img src="https://github.com/user-attachments/assets/73791478-26ba-4174-9387-3764ccc8f9f4" alt="填写项目名称" width="720" />
  </a>
</p>

### 3. 配置标题识别规则

进入编辑项目页后，先处理标题识别。本项目引入了 OKP 内核的识别方案，输入类似 `<标签>` 的内容即可辅助项目自动识别。

<p align="center">
  <a href="https://github.com/user-attachments/assets/44593428-1945-4f3c-8d66-e573f9008fbf">
    <img src="https://github.com/user-attachments/assets/44593428-1945-4f3c-8d66-e573f9008fbf" alt="标题识别规则页面" width="640" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/user-attachments/assets/218d7add-7299-404b-8c81-d25c00bcdcee">
    <img src="https://github.com/user-attachments/assets/218d7add-7299-404b-8c81-d25c00bcdcee" alt="标签输入示例" width="560" />
  </a>
</p>

如果你已经有规范命名的种子文件，可以直接利用这些文件名完成匹配；即使命名不完全统一，也可以通过映射方式整理规则。

<p align="center">
  <a href="https://github.com/user-attachments/assets/9f4508d3-8086-47df-83cc-1b6853ab5f29">
    <img src="https://github.com/user-attachments/assets/9f4508d3-8086-47df-83cc-1b6853ab5f29" alt="文件名匹配规则" width="720" />
  </a>
</p>

将种子文件名复制到 `文件名匹配` 中，再把对应标签填入规则即可。

注意：标签可以留空。留空代表跳过该项，错误填写反而可能导致识别失败。

<p align="center">
  <a href="https://github.com/user-attachments/assets/be1ed812-9aef-473b-9234-4411c3e4db8d">
    <img src="https://github.com/user-attachments/assets/be1ed812-9aef-473b-9234-4411c3e4db8d" alt="保存匹配方案" width="720" />
  </a>
</p>

完成后点击左下角的 `保存匹配方案`。

### 4. 导入种子并自动识别

点击 `导入 .torrent 自动识别`，选择种子文件后，页面顶部会弹出导入提示。

<p align="center">
  <a href="https://github.com/user-attachments/assets/aa5df2f9-d836-4209-bd08-5c26bdacc4c6">
    <img src="https://github.com/user-attachments/assets/aa5df2f9-d836-4209-bd08-5c26bdacc4c6" alt="导入提示" width="420" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/user-attachments/assets/dbb0eafc-cf1f-494d-8e35-abbdee1ba841">
    <img src="https://github.com/user-attachments/assets/dbb0eafc-cf1f-494d-8e35-abbdee1ba841" alt="导入种子后的识别结果" width="720" />
  </a>
</p>

识别成功后，可以看到相关信息已经被正确填入。

### 5. 选择站点并补全番剧信息

点击 `选择站点`，这里只会展示已经成功登录且账号有效的站点。

<p align="center">
  <a href="https://github.com/user-attachments/assets/d146017d-e30a-4531-877d-aeca09787c0e">
    <img src="https://github.com/user-attachments/assets/d146017d-e30a-4531-877d-aeca09787c0e" alt="选择站点" width="720" />
  </a>
</p>

将剧集名称填写到 `Bangumi ID 搜索` 中，选择对应条目。

<p align="center">
  <a href="https://github.com/user-attachments/assets/6f6e89df-e1f8-40c9-8b59-d1e19c001a5f">
    <img src="https://github.com/user-attachments/assets/6f6e89df-e1f8-40c9-8b59-d1e19c001a5f" alt="Bangumi ID 搜索" width="720" />
  </a>
</p>

选中后，信息会自动回写到站点字段中。

<p align="center">
  <a href="https://github.com/user-attachments/assets/2b38e103-9939-4c57-b16b-8e7a3812fab2">
    <img src="https://github.com/user-attachments/assets/2b38e103-9939-4c57-b16b-8e7a3812fab2" alt="信息回写提示" width="400" />
  </a>
</p>

### 6. 编辑正文并发布

继续向下滚动到正文编辑区域。当前更偏向一次发布一个作品的多个版本，适合集中整理和统一发布。

<p align="center">
  <a href="https://github.com/user-attachments/assets/d42c76f7-c3c9-4557-9e93-2f124275d71f">
    <img src="https://github.com/user-attachments/assets/d42c76f7-c3c9-4557-9e93-2f124275d71f" alt="正文编辑区域" width="720" />
  </a>
</p>

点击预览先检查内容，确认无误后返回上方检查区域。程序会再做一次校验，校验通过后即可发布。

<p align="center">
  <a href="https://github.com/user-attachments/assets/ec064c49-7332-40fd-8c4e-a9de6eee6656">
    <img src="https://github.com/user-attachments/assets/ec064c49-7332-40fd-8c4e-a9de6eee6656" alt="发布前检查" width="720" />
  </a>
</p>

发布成功后，可以回到 [字幕组后台](https://anibt.net/groups) 查看结果。

<p align="center">
  <a href="https://github.com/user-attachments/assets/8eb2c4d9-0677-4b5a-b73f-ffdd0e52c56a">
    <img src="https://github.com/user-attachments/assets/8eb2c4d9-0677-4b5a-b73f-ffdd0e52c56a" alt="发布结果" width="720" />
  </a>
</p>

可以看到资源已经成功发布。

## Todo

- 支持从项目列表中直接打开已发布链接并继续维护
- 优化正文编辑流程，支持更灵活的单版本编辑体验
- 深度优化 UI 样式，提升整体视觉表现与使用体验

## 致谢

本项目在开发过程中参考并受益于以下开源项目：

- [EasyPublish](https://github.com/vcb-s/EasyPublish)：基于 VCB 发布流程和规范的自动化发布项目
- [OKP](https://github.com/AmusementClub/OKP)：One-Key-Publish，一键发布 Torrent 到常见 BT 站

同时感谢 [ChatGPT](https://chatgpt.com) 在本项目开发过程中的大力支持。
