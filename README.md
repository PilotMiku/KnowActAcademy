<div align="center">

<img src="dist/assets/brand/icon-light.png" width="80" alt="知行学习图标">

# 知行学习

**行是知之始，知是行之成。**

章节练习 · 智能备考 · 间隔复习 · 学习资料

[进入网站](https://pilotmiku.github.io/KnowActAcademy/)

</div>

## 网站介绍

知行学习是基于 NEUMathe 修改与适配的在线学习网站，汇集高等数学、线性代数题库与习概、编程等学习资料，将练习、备考、复习和阅读整合在一起。

内置 **8,425 道题目**，覆盖 **17 个章节、182 个小节**，提供题目、答案与解析。部分转写仍待校对，相关内容已标注。打开即学，无需登录；学习记录自动保存在浏览器，也可通过完整备份或自建服务同步进度。

![知行学习网站预览：学习概览、每日目标、复习安排与章节入口](docs/images/preview.png)

## 功能

| 功能 | 介绍 |
| --- | --- |
| 📚 章节练习 | 按科目、章节、题型和关键词筛选，支持顺序、随机、未做题与未掌握题练习。 |
| 🎯 智能备考 | 测评后按薄弱项加权抽题，持续跟踪掌握进度与成绩趋势。 |
| 🔁 间隔复习 | 根据作答表现安排复习，集中查看到期题目与后续计划。 |
| 📝 模拟考试 | 自选科目与章节组卷，限时作答，生成成绩、逐题用时与章节分析。 |
| ⭐ 错题与笔记 | 自动整理错题，收藏重点题目，记录错因、个人笔记与拿不准的题。 |
| 📖 学习资料 | 分类阅读与全文搜索，支持收藏、已读、主动回忆和阅读位置恢复。 |
| 📊 学习统计 | 查看每日目标、有效作答、章节完成度和正确率，随时接续上次学习。 |
| 🎨 阅读体验 | 适配桌面与手机，支持浅色 / 深色主题、字号调整、专注布局和题图放大。 |

## 本地开发与验证

可使用与 CI 相同的 Python 3.12、Node.js 22。首次运行：

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
npm run build
npm run dev
```

打开 `http://127.0.0.1:4188`。普通构建使用已登记题库，不需要 OCR 模型或历史数学原件。

提交前执行：

```sh
npm run check:bank
npm test
npm run test:python
npm run build
npm run verify
npm run test:browser
```

单独验证加载、5 万条作答增量保存、压缩同步和报告懒加载：

```sh
node scripts/run_browser_tests.mjs optimization-browser
```

测试报告及截图保存在忽略提交的 `artifacts/`。PR 会执行构建与完整检查，通过后才可由主分支工作流部署；PR 本身不部署。

## 学习数据与题目质量

缺损题及明确标记答案未核实的题目可查阅、收藏和记笔记，但不计有效完成、正确率、掌握度或复习日程，也不进入新考试和备考组。已有历史记录保留。

完整备份使用 `zhixing.backup.v2`，将每题原始记录和标准化差异分别编码，避免重复保存题干与解析；保留来源及自定义字段，支持恢复旧版完整备份。轻量进度备份只包含学习记录，恢复时要求相同版本的内置题库；自定义题库使用完整备份。两种文件的恢复上限均为 50 MiB，导出时检查文件大小。

作答记录在 IndexedDB 内按条追加，与会话元数据在同一版本检查事务内提交。数据库升级到版本 2，旧数据首次打开时自动迁移；升级会关闭旧版本标签页的连接，防止旧代码覆盖新日志。恢复备份或清空记录时原子替换作答日志。应用内的作答记录视为不可变数据；修改历史时须替换 `state.attempts` 数组，以便持久化和统计索引重建。读取完整持久化快照使用 `storage.mjs` 的 `readSavedData()` / `readSavedState()`。

插图在构建时按小节和题目顺序重打包，原图字节和题库引用不变。小索引兼容旧备份中的插图地址；报告滚动到相应位置时才加载图片包。可选资料和同步配置独立加载，网络请求超时不再无限阻塞练习。

## 项目结构

```text
知行学习/
├── dist/             # 前端源码、样式、图标与题库数据
├── question-bank/    # 网站仍在使用的学习资料
├── question-bank-markdown/ # 全量文字与 LaTeX 分章稿、逐题压缩包
├── data/             # 资料目录、题图索引与提取记录
├── scripts/          # 资料索引、静态构建与资源校验
├── backend/          # 可选的学习进度同步服务
├── tests/            # 核心逻辑与浏览器测试
├── docs/             # 项目文档与预览图
├── .github/          # GitHub Pages 构建与部署配置
├── _site/            # 构建生成的静态网站（不入库）
└── server.py         # 本地预览服务
```

## 题库文档与原件

[查看 Markdown 题库](question-bank-markdown/) · [下载全部逐题 Markdown](question-bank-markdown/逐题Markdown.zip)

137 份数学 PDF 和 182 份图片型补充 HTML 已从当前分支移除，共约 276 MiB。原件保留在[转换后的历史提交](https://github.com/PilotMiku/KnowActAcademy/tree/276c33298d98f896b31daf7d73607977bffd666a/question-bank)，题目的来源链接固定指向该提交；SHA-256 与文件清单见 [归档登记](data/archived-math-sources.json)。网站需要的公式、图形以及学习资料继续保留，普通构建不需要下载历史原件。

继续校对或重跑 OCR 时，可将原件恢复到被 Git 忽略的本地缓存：

```sh
git fetch origin 276c33298d98f896b31daf7d73607977bffd666a
python scripts/source_archives.py --restore-local
```
