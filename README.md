# X DSH Desktop

X DSH Desktop 是独立开发的 DeepSeek Harness Windows 桌面载体。它使用绝对路径启动应用内 Node.js 24 和固定的官方 Harness runtime closure，在原生窗口中加载本地 Web UI，并提供托盘、服务重启、更新、数据目录与持久日志入口。本项目不代表 DeepSeek 官方背书，内嵌 Harness 仍按其 MIT 许可证分发。

## 当前能力

- 启动时探测 `127.0.0.1:3080`：确认是 Harness 时直接挂接；其他程序占用时自动选择 `3081-3180` 的可用端口。
- 应用内服务固定使用 `dsh web --no-open`，启动桌面窗口时不会再额外打开系统浏览器。
- 默认使用 `%USERPROFILE%\.dsh`，也尊重显式 `DSH_HOME`，因此与浏览器版共享设置和会话数据。
- 只终止本应用启动的 Harness 子进程；挂接的外部实例永远不会被桌面应用停止。
- 启动页显示实时日志，完整日志写入 Electron `userData/logs/desktop.log`。
- 系统托盘提供显示窗口、浏览器打开、重启/重连、数据目录、日志目录和退出。
- 使用独立设计的 X 形图标作为窗口、任务栏、托盘、快捷方式和 EXE 图标，不使用官方 DeepSeek 品牌图形作为桌面产品身份。
- 默认窗口为 1120 x 690 的桌面工作尺寸；“视图 → 聊天文字大小”提供缩小、恢复默认与放大，支持 `Ctrl+-`、`Ctrl+0`、`Ctrl+=`，并记住选择。
- 启动页采用居中品牌启动视图：实时状态、细进度线和服务地址默认简洁展示；启动日志收纳在可展开抽屉，失败时自动展开并提供重新启动。
- 在“帮助 → 检查官方 Harness 更新”中比较 npm `@deepseek-ai/dsh` 的 `latest` 与 `next`；只有列入桌面兼容矩阵并完成 Windows 启动验证的版本才允许激活。安装包内置 Node.js 与 pnpm，在隔离 runtime 槽位安装完整生产闭包，校验 npm integrity 后重启，失败自动回滚。升级前会事务式隔离 profile 中未声明且会遮蔽新 runtime 的旧官方包；成功后提交迁移，失败或中断则原样恢复。GitHub Release runtime archive 作为备用来源。
- 安装版每天后台检查 `xiangdecai/deepseek-harness-desktop` 的 GitHub Releases，只提示、不自动下载；用户确认后在独立非模态更新窗口显示下载、安装、完成或失败状态，聊天窗口不再反复跳转或闪烁。Portable 版明确提示手动替换，不尝试自更新。
- “插件 → 插件中心”提供已安装项、类别、版本、兼容性、来源及权限查看；运行时升级前会备份 DSH_HOME 的插件清单、profile 配置和 Cordis patch，并诊断重复 loader、空入口与 BOM。
- 文件交付与打开行为由官方 Harness 前端和 Host capability 提供；桌面壳不再复制或覆盖官方交付文件插件。升级后会仅清理旧版桌面壳自己生成的交付文件插件与 Cordis 补丁，保留其他插件和用户配置。
- Harness 原生图片附件为默认路径。仅当用户显式开启“纯文本模型：粘贴图片生成 OCR 证据”时，桌面端才拦截图片并调用 Windows OCR；配置可选视觉模型后可补充语义 JSON，再把 `xiangong.vision-evidence.v1` 证据插入输入框。

## 开发运行

```powershell
npm.cmd install
npm.cmd run prepare:icon
npm.cmd run prepare:node
npm.cmd run prepare:harness
npm.cmd test
npm.cmd start
```

`prepare:harness` 默认用随项目固定的 pnpm 安装精确版本 `@deepseek-ai/dsh@0.1.7-rc.1`，不依赖系统 Node 或 pnpm。0.1.7-rc.1 已完成 Windows CLI 启动、认证跳转和本地 UI 烟测；交付文件交互使用官方实现，不再叠加桌面壳补丁。注意：[上游已知问题](https://github.com/deepseek-ai/deepseek-harness/discussions/7635)指出，安装到 profile 的插件可能因子进程找不到 peer 依赖而影响工具调用和语音；该问题及 workaround 尚未在本桌面壳的 Windows 插件场景中验证。`DHD_HARNESS_VERSION` 仅供维护者验证兼容矩阵候选版本；未经验证的版本不得发布。

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

- `X-DSH-Desktop-Setup-0.3.1-x64.exe`
- `X-DSH-Desktop-Portable-0.3.1-x64.exe`

0.3.1 Windows x64 构建实测：安装器 295.84 MiB，便携版 295.62 MiB，内含官方 Harness `0.1.7-rc.1`。已完成隔离 runtime 下的 Windows 本地认证及 HTTP/UI 烟测；首次展开后固定 runtime 位于 Electron `userData/runtime/`，升级版本使用独立目录，不读取系统 Node 或 `dsh`。

分发物必须保留根目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`，以及 `resources/licenses/` 中的 DeepSeek Harness、Node.js 和 Electron 许可证文件。

升级安装会覆盖桌面程序文件，但不会删除或重置 `%USERPROFILE%\\.dsh`、Electron `userData`、会话密钥、插件配置、记忆和 runtime 更新槽位。卸载也不会主动清理这些用户数据；如需彻底清除，必须由用户手动删除对应数据目录。

本项目是独立桌面产品，不替换项工AI的生产 AgentRuntime，也不改变 A3。

## 桌面应用更新发布

安装版通过 Electron 的 NSIS 更新通道读取本仓库 GitHub Release。发布者在已准备 runtime 的 Windows 环境中设置 `GH_TOKEN`，然后运行：

```powershell
npm.cmd test
npm.cmd run pack:win -- --publish always
```

Release 必须同时上传 Setup `.exe`、`latest.yml` 与对应 `.blockmap`，以便已有安装版下载并校验更新。应用更新失败会保留现有版本和全部用户数据；Portable 版没有后台更新能力。

## 官方 Harness 更新

桌面应用不直接覆盖安装目录，也不会重建或删除 `%USERPROFILE%\\.dsh`。更新流程为：

1. 从 npm registry 比较 `@deepseek-ai/dsh` 的 `dist-tags.latest` 与 `dist-tags.next`，并读取所选版本的 tarball integrity。
2. 先检查 `src/runtime-compatibility.cjs`；没有通过桌面兼容验证的未来版本只提示，不下载、不激活。
3. 下载官方 npm tarball，使用内置 Node/pnpm 在隔离目录安装生产依赖（不执行依赖脚本）。
4. 解压或安装到 Electron `userData/runtime/harness-<version>`，验证 `lib/bin.js` 与 Web 前端后写入 pending 槽位。
5. 停止应用内 Harness，隔离 profile 中会遮蔽新 runtime 的未声明旧官方包，然后启动 pending runtime。
6. 启动成功后将 pending 提升为 active 并提交 profile 迁移；失败或异常中断则恢复旧包、删除新槽位并启动旧 runtime。

若 npm registry 暂时不可用，应用才检查官方 GitHub Release。Release 必须提供名称包含 `harness` 与 `runtime`（或 `win` / `windows`）的 `.tar.gz`、`.tgz` 或 `.zip` 资产，并带 `sha256:<64 hex>` digest。不会从网页源码或未经校验的压缩包更新。
