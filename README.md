# 知行学习

**网站名称：知行学习。题库名称：知行学习题库。**

基于 Local-NEUMathe 独立复制、修改、适配的学习网站，保留章节筛选、顺序练习、随机 25 题、自动判分、原题解析、错题本、收藏、模拟考试、统计和习概知识点阅读的主要交互。

欢迎大家进行有关源代码的交流。

前端可以单独部署到 GitHub Pages；学习数据默认保存在浏览器，可选连接自有服务器上的 SQLite 进度同步服务。交付源码不包含任何线上账号或服务器密钥。

## 题库保持原样

| 内容 | 数量 |
| --- | ---: |
| 高等数学 | 3,010 道 |
| 线性代数 | 491 道 |
| 数学章节 / 小节 | 12 / 132 |
| 原始数学 PDF | 132 份 |
| 习概笔记 / 阅读小节 | 20 / 126 |
| 习概原始 PDF / Markdown | 16 / 15 份 |
| 静态原题图片 | 20,999 张 |

`question-bank/`、`data/` 和 `dist/data/` 从原项目逐字节复制；不改题干、答案、解析、题号、资料原文和题库版本。7 道原题缺少解析，继续如实标注。现有答案与原文件标记一致，迁移没有重新编写或重新验算原题答案。

构建时使用原项目相同的 PDF 区域、2.5 倍渲染比例、答案标记遮盖方式及无损 WebP 编码。只在浏览器显示时将旧 `/api/question-image/` 地址映射为相对的静态资源地址，题库 JSON 不改写。原始 PDF 和 Markdown 下载也包含在静态站点中。

## 本地预览

已交付的 `_site/` 是完整的静态网站，可直接预览：

```sh
cd "/Users/david/知行学习"
python3 server.py
```

打开 <http://127.0.0.1:4188/>。不要双击 `index.html`；浏览器需要 HTTP 环境加载模块和题库文件。预览服务仅监听本机，`Ctrl+C` 停止。

首次从源码构建，使用 Python 3.10+（推荐 3.12）：

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/build_static.py
python scripts/verify_site.py
python server.py
```

Windows 激活虚拟环境使用 `.venv\Scripts\activate`。后续构建会复用 `.cache/` 中的题图；更改前端源码或 `dist/config.json` 后重新构建。输出约 261 MiB，不需要运行原项目的 PDF 服务。若更新 PDF、裁切索引或依赖版本，应清除 `.cache/` 后重新构建。

## GitHub Pages 部署

本次交付仅在本地完成，**没有上传 GitHub，也没有修改原仓库的部署配置**。

1. 将本目录的**全部源码内容**复制到一个独立新仓库的根目录，包括 `.github/` 隐藏目录、`.gitignore`、`dist/`、`data/`、`question-bank/`、`scripts/`、`tests/`、`backend/` 和依赖清单。不要把整个项目文件夹再嵌套一层后上传，否则内置工作流不在仓库根目录。
2. 使用 `main` 作为部署分支；如果使用其他分支，调整 `.github/workflows/pages.yml`。
3. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 推送源码后工作流会自动验证原始资料、构建题图、检查全部资源、执行浏览器回归，再发布 `_site/`。也可在 Actions 中手动运行。
5. 部署完成后使用 Actions 返回的 Pages 地址访问。根域名、自定义域名和 `https://用户名.github.io/仓库名/` 均支持，无需修改资源前缀；站内使用 `#/` 路由，刷新题目或笔记页面可继续访问。

不提交 `_site/`、`.cache/`、虚拟环境或个人学习备份；这些文件已忽略。发布产物只包含静态前端、题图和原始学习资料，不含后端源码、数据库或密钥。工作流按 [GitHub 官方 Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 配置。

## 可选：部署自己的服务器

无需配置后端也能完成全部刷题操作。服务器用于同一学习者在不同设备之间主动上传、恢复学习进度；**不承担题图渲染**，服务器故障不影响静态题库的正常使用。

后端部署、域名、个人同步密钥与数据库备份说明见 [后端部署说明](backend/README.md)。前端可设置 `dist/config.json` 的公开 `apiBase` 为你的 HTTPS API 地址，再重新构建；也可以在网站“题库管理 → 连接同步服务器”中手动输入地址。前端配置中只能填写服务器地址，不能填写密钥。

连接不会自动改动本机或服务器进度。上传明确替换服务器进度，恢复明确替换本机进度，恢复前自动下载本机完整备份。服务端保留最近 10 次旧版本，并用版本号拒绝过期设备覆盖新记录。暂不自动合并两台设备同时学习的记录。密钥只在当前页面内存中保留，刷新后重新连接。

同步包括作答、错题、收藏、已交卷考试、练习位置、知识点已读和收藏。正在进行的考试须先完成再同步。两端内置题库版本必须一致；自定义题库使用原有完整备份导出和恢复。

## 原项目进度迁移

在原 Local-NEUMathe 中导出完整备份，再在知行学习“题库管理 → 恢复学习数据”导入。保留兼容的备份格式和题目 ID，新网站使用独立的 IndexedDB 数据库，不会修改原项目的浏览器记录。

浏览器数据按域名和仓库路径隔离。更换浏览器、域名、仓库名或清理浏览器数据前，请导出完整备份；也可先主动上传服务器进度。JSON 备份不包含原 PDF，原题图由部署的完整静态站点提供。

本目录是独立项目，建议与 Local-NEUMathe 并排保存。旧项目的索引器会递归扫描子目录 PDF；如果把本项目嵌套放在旧项目中，重建旧项目索引前应先将本目录移出，避免副本被识别为未登记资料。

## 源码与测试

| 路径 | 用途 |
| --- | --- |
| `dist/` | 可编辑的完整前端源码、KaTeX、本地题库数据 |
| `question-bank/`、`data/` | 原资料及原有索引，保持原样 |
| `scripts/build_static.py` | 校验资料并生成完整 `_site/` |
| `scripts/verify_site.py` | 检查每一个图片引用、原始资料和发布内容 |
| `dist/assets.mjs` | 相对路径适配、独立浏览器存储名 |
| `dist/sync.mjs`、`backend/` | 可选的前端同步客户端及 SQLite 服务 |
| `.github/workflows/pages.yml` | GitHub Pages 构建、验证和部署 |
| `docs/REVIEW.md` | 迁移后的代码复审及验证记录 |

```sh
# Node.js 20+，推荐 22
npm ci
npm test
python -m unittest discover -s tests -p 'test_*.py'
python scripts/verify_site.py

# 本机没有 Chrome 时需要安装 Playwright Chromium
npx playwright install chromium
npm run test:browser

# 比对原项目源码和题库是否保持原样（只读检查）
python scripts/verify_original.py /原项目/Local-NEUMathe
```

浏览器测试自动启动、关闭隔离的本机静态服务和临时数据库后端，同时验证根目录和 `/test-repo/` 部署，不读写日常浏览器数据。只检查核心逻辑和后端时无需启动浏览器。更新题库时沿用复制的索引脚本，随后重新构建；不要手工编辑生成的题目或答案。
