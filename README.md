# DeepSeek Harness Desktop

DeepSeek Harness Desktop 是官方 DeepSeek Harness Web UI 的 Windows 原生桌面载体。它使用绝对路径启动应用内 Node.js 24 和固定的官方 Harness runtime closure，在原生窗口中加载本地 UI，并提供托盘、服务重启、数据目录与持久日志入口。

## 当前能力

- 启动时探测 `127.0.0.1:3080`：确认是 Harness 时直接挂接；其他程序占用时自动选择 `3081-3180` 的可用端口。
- 默认使用 `%USERPROFILE%\.dsh`，也尊重显式 `DSH_HOME`，因此与浏览器版共享设置和会话数据。
- 只终止本应用启动的 Harness 子进程；挂接的外部实例永远不会被桌面应用停止。
- 启动页显示实时日志，完整日志写入 Electron `userData/logs/desktop.log`。
- 系统托盘提供显示窗口、浏览器打开、重启/重连、数据目录、日志目录和退出。
- 使用官方 Harness 源码 `apps/web/public/favicon.svg` 的 DeepSeek 鱼形轮廓作为窗口、任务栏、托盘、快捷方式和 EXE 图标，并内置透明底多尺寸 Windows ICO。
- 启动页采用居中品牌启动视图：实时状态、细进度线和服务地址默认简洁展示；启动日志收纳在可展开抽屉，失败时自动展开并提供重新启动。
- 在“帮助 → 检查官方 Harness 更新”中优先检查 npm `@deepseek-ai/dsh` 的 `latest` 版本；安装包内置 Node.js 与 npm，在隔离 runtime 槽位执行 `npm install --omit=dev --ignore-scripts`，校验 npm integrity 后重启，失败自动回滚。GitHub Release runtime archive 作为备用来源。
- 视觉证据模式拦截粘贴图片，调用 Windows OCR 获取文字和像素坐标；配置可选视觉模型后补充语义 JSON，再把 `xiangong.vision-evidence.v1` 证据插入输入框。

## 开发运行

```powershell
npm.cmd install
npm.cmd run prepare:icon
npm.cmd run prepare:node
$env:DHD_SKIP_HARNESS_BUILD='1'
npm.cmd run prepare:harness
npm.cmd test
npm.cmd start
```

`prepare:harness` 默认读取相邻 `.h0/deepseek-harness-master/deepseek-harness-master`；可通过 `DEEPSEEK_HARNESS_SOURCE` 指向另一份官方源码。正式打包前不要设置 `DHD_SKIP_HARNESS_BUILD`。

## 可选视觉模型

Windows OCR 始终在本机运行。需要图像语义时，配置一个兼容 OpenAI `chat/completions` 图片输入的视觉模型：

```powershell
$env:DHD_VISION_BASE_URL='https://provider.example/v1'
$env:DHD_VISION_API_KEY='...'
$env:DHD_VISION_MODEL='vision-model-id'
```

未配置视觉模型时，证据会明确标记为 `heuristic-only`，不会把 OCR 文本推断冒充成真实视觉理解。

## 打包

```powershell
npm.cmd run prepare:runtime
npm.cmd test
npm.cmd run pack:win
```

安装器和便携版输出到 `dist/`：

- `DeepSeek-Harness-Desktop-Setup-0.1.1-x64.exe`
- `DeepSeek-Harness-Desktop-Portable-0.1.1-x64.exe`

2026-08-16 当前测试机实测：安装器 172.3 MB，便携版 172.1 MB；54.4 MB 的 Harness closure 首次展开耗时 21.75 秒，干净首次启动至 UI 可访问共约 51.7 秒，runtime 与测试数据均已初始化后的热启动约 2.94 秒。首次展开后固定 runtime 位于 Electron `userData/runtime/`，升级版本使用独立目录，不读取系统 Node 或 `dsh`。

分发物必须保留根目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`，以及 `resources/licenses/` 中的 DeepSeek Harness、Node.js 和 Electron 许可证文件。

升级安装会覆盖桌面程序文件，但不会删除或重置 `%USERPROFILE%\\.dsh`、Electron `userData`、会话密钥、插件配置、记忆和 runtime 更新槽位。卸载也不会主动清理这些用户数据；如需彻底清除，必须由用户手动删除对应数据目录。

本项目是独立桌面产品，不替换项工AI的生产 AgentRuntime，也不改变 A3。

## 官方 Harness 更新

桌面应用不直接覆盖安装目录，也不会重建或删除 `%USERPROFILE%\\.dsh`。更新流程为：

1. 从 npm registry 检查 `@deepseek-ai/dsh` 的 `dist-tags.latest` 和 tarball integrity。
2. 下载官方 npm tarball，使用内置 Node/npm 在隔离目录安装生产依赖（不执行依赖脚本）。
3. 解压或安装到 Electron `userData/runtime/harness-<version>`，验证 `lib/bin.js` 与 Web 前端后写入 pending 槽位。
4. 停止并重启应用内 Harness；启动成功后将 pending 提升为 active，失败则删除新槽位并恢复旧 runtime。

若 npm registry 暂时不可用，应用才检查官方 GitHub Release。Release 必须提供名称包含 `harness` 与 `runtime`（或 `win` / `windows`）的 `.tar.gz`、`.tgz` 或 `.zip` 资产，并带 `sha256:<64 hex>` digest。不会从网页源码或未经校验的压缩包更新。
