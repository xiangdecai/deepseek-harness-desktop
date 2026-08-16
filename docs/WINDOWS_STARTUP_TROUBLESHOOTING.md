# Windows 启动排障

## 看到 `loadLayeredEnv` 后立即退出

如果启动页显示“启动没有完成”，日志尾部包含 `loadLayeredEnv`，并且路径指向：

```text
C:\Users\<用户名>\.env
```

优先检查这个项目环境文件，而不是重新安装桌面应用或删除 Harness 会话。

官方 `dsh-app-boot` 会拒绝从项目 `.env` 读取启动阶段专用变量。常见冲突项包括：

- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_SEARCH_BASE_URL`
- `DSH_*`
- `NODE_OPTIONS`、`NODE_PATH`
- `PATH`、`HOME`、`USERPROFILE`、`SHELL`
- `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`
- `SSL_CERT_FILE`、`SSL_CERT_DIR`

处理方式：

1. 关闭 DeepSeek Harness Desktop。
2. 打开日志中提示的 `.env` 文件。
3. 删除或注释冲突行；需要保留的值请改为 Windows 用户环境变量或系统环境变量。
4. 重新启动桌面应用。

新版桌面应用会在拉起 Harness 前主动扫描项目 `.env`，并直接显示冲突文件路径和变量名，避免只看到 `loadLayeredEnv` 的深层堆栈。

## 不要清理这些数据

升级或排查启动问题时，不要删除以下目录：

- `%USERPROFILE%\.dsh`：Harness 会话、密钥、插件和记忆。
- `%APPDATA%\deepseek-harness-desktop`：桌面应用日志、运行时槽位和升级状态。

只有在用户明确要求“全新重置”时，才应手动备份后清理这些目录。

## 多台电脑安装

每台电脑都有自己的用户环境和项目目录。另一台电脑出现同样日志时，应在那台电脑上检查对应的 `%USERPROFILE%\<项目>\.env`；本机的 `.dsh` 数据不会修复另一台电脑的环境变量问题。
