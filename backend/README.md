# 知行学习进度同步后端

这是可选的 Python WSGI + SQLite 服务。前端在 GitHub Pages 托管题库与全部题图，后端只保存学习进度，适用于个人或小规模使用。默认没有公开注册入口，由服务器管理员为每位学习者创建单独的同步密钥。

## Docker 部署

需要自有 Linux 服务器、Docker Compose 和一个指向该服务器的 API 域名。以下命令在本 `backend/` 目录执行。

```sh
cp .env.example .env
```

把 `.env` 中的来源改为实际网站**域名**，例如：

```dotenv
ZHIXING_ORIGINS=https://YOUR_NAME.github.io
```

来源不带仓库路径和结尾 `/`。多个来源使用逗号分隔，自定义域名也需要加入。生产环境要求 HTTPS；本机调试允许 `http://127.0.0.1:端口` 或 `http://localhost:端口`。

```sh
docker compose up -d --build
docker compose exec api python app.py --create-user learner-one
```

最后一条命令会输出该学习者的 43 字符随机密钥，仅显示一次。每人单独创建名称和密钥；数据库只保存密钥摘要，不保存原始密钥。密钥具有读取和替换该学习者进度的权限，应交给对应学习者保存，不要写入网页、GitHub 配置或日志。

API 只映射到服务器的 `127.0.0.1:8000`，通过现有 Nginx 或 Caddy 提供 HTTPS。`Caddyfile.example` 给出反向代理配置：替换为你的 API 域名，部署到宿主机 Caddy 配置中。若使用容器化反向代理，应接入同一个 Docker 网络后按服务名代理，不能直接使用代理容器内的 `127.0.0.1`。

服务器确认 `https://你的API域名/v1/health` 返回 `{"ok":true,"service":"zhixing-progress"}` 后，在网站“题库管理 → 连接同步服务器”输入 `https://你的API域名` 和个人密钥。生产域名和证书需要你提供并配置，本地交付没有执行这些线上操作。

撤销密钥并删除该用户服务器进度：

```sh
docker compose exec api python app.py --revoke-user learner-one
```

重建容器不会删除进度，数据保存在 Compose 的 `progress` 命名卷。`docker compose down -v` 会删除该卷，请勿在保留数据时使用。

## 同步行为

| 接口 | 作用 |
| --- | --- |
| `GET /v1/health` | 检查服务是否运行，不返回个人信息 |
| `GET /v1/progress` | 读取当前密钥对应的最新进度与版本 |
| `PUT /v1/progress` | 携带 `If-Match: 上次读取版本` 替换自己的进度 |
| `OPTIONS /v1/progress` | 仅允许已配置来源及所需请求头的跨域预检 |

进度接口使用 `Authorization: Bearer 个人密钥`。首次读取为 `version: 0, payload: null`。成功写入后版本递增。旧版本写入返回 409，要求重新连接后选择恢复或确认上传，不会自动重试覆盖。用户之间按密钥摘要隔离；来源检查之外，每次进度读写都要求有效密钥。

上传 JSON 使用 `zhixing.progress.v1`，包含题库版本与学习状态，最大 10 MiB。该服务不支持上传任意文件，也不提供 SQL、静态目录或题库修改接口。SQLite 写入使用事务，返回成功前完成提交。最近 10 次旧进度保存在 `history` 表中，便于管理员在误操作后导出恢复。

## 备份与恢复

管理员应定期备份数据库。SQLite 运行时存在 WAL 文件，不要只复制正在使用的 `.sqlite3` 主文件。可使用 Python 的在线备份 API，在容器内生成一致快照：

```sh
docker compose exec api python -c 'import sqlite3; src=sqlite3.connect("/data/zhixing.sqlite3"); dst=sqlite3.connect("/data/backup.sqlite3"); src.backup(dst); dst.close(); src.close()'
docker compose cp api:/data/backup.sqlite3 ./zhixing-backup.sqlite3
```

数据库备份含所有学习者的进度和鉴权摘要，应保存在私人备份位置。恢复时停止 API，把备份作为 `/data/zhixing.sqlite3` 恢复到卷内，清理停机状态下旧的 `-wal` 和 `-shm` 文件，确认所有者为 UID 10001，再启动服务。

误覆盖后，可在数据库副本中通过 `learners.name` 关联 `history.token_hash`，按 `history.version` 选取历史 `payload`，导出 JSON；先保留本机完整备份，再通过原设备恢复或由管理员以当前版本写回。不要直接修改运行中数据库的版本字段。

如果需要大量用户、公开注册、密码找回或自动多端合并，应另行扩展账号和合并逻辑。当前版本选择明确上传/恢复，优先避免无提示的数据覆盖。
