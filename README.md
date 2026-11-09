# 整理网盘文件

## 1. 这个 Skill 是干嘛的

把杂乱的夸克网盘相册整理成清楚的文件夹，并用一个 HTML 网站展示规划、确认和整理过程。

Agent 会先读取你指定的文件夹，分析真实照片、视频和其他素材，提出分类方案。旅行素材可以按「地点 → 照片 / 视频 → 主题」整理；其他相册会根据实际内容规划，不固定城市、数量，也不要求一定有视频。

网站会先让你确认整理思路和目录，再把真实素材封面组成一个密集的照片星球，逐渐飞入两侧最末级文件夹。预览结束后，点击「正式确认以上归类，开始整理网盘」，Agent 才会真正操作网盘，并把实际结果显示在页面上。

![真实素材从照片星球归入两侧文件夹的整理预览](docs/organizer-preview.png)

*上图为一次旅行素材的整理预览。使用时，照片、分类目录和数量都会来自你自己的素材。动画结束不等于网盘已整理完成。*

## 2. 如何使用这个 Skill

### 第一步：安装

需要 Node.js 20+，以及支持本地 Skill 和命令执行的 Agent。你可以直接告诉 Codex：

> 请安装这个 Skill：https://github.com/panggungunvibe/organize-cloud-drive-files

也可以[下载 Skill 安装包](https://github.com/panggungunvibe/organize-cloud-drive-files/releases/latest)，解压后将 `organize-cloud-drive-files` 文件夹放入 Agent 的全局 Skills 目录，再重新载入 Skills。

### 第二步：连接夸克，告诉它要整理哪个文件夹

安装后，直接说：

> 使用 $organize-cloud-drive-files，帮我整理夸克网盘里的「我的旅行相册」。先让我确认分类方案，再真正整理。

Skill 会先检查[夸克网盘官方 Skill](https://pdds.quark.cn/download/stfile/eekkigineefiegmgo/quarkclouddrive-1.0.25.zip)是否已安装并连接账号；未连接时，引导你完成授权。没有指定文件夹时，它会先询问你。

### 第三步：在网页确认方案，开始整理

1. 查看真实素材统计，确认整理思路。
2. 查看最终目录，确认每类素材的去处。
3. 观看照片星球向两侧文件夹归档的预览动画。
4. 动画结束后，点击「正式确认以上归类，开始整理网盘」。
5. 等待 Agent 执行，查看网页回写的真实结果及网盘结果入口。

支持当前对话通知的 Codex 环境会直接把网页确认发送给 Agent；其他环境会提供可复制的指令，按页面提示发回当前 Agent 即可。

移动或复制以最终确认的方案为准，默认保留原文件名。重播动画不会重复执行整理。

---

MIT License · 配合夸克网盘官方 Skill 使用的独立工作流。
