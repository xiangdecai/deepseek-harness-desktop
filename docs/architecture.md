# X DSH Desktop architecture

The application has three processes: Electron owns the native window and tray, bundled `node.exe` owns the official `dsh web` process, and the Chromium renderer loads the unmodified official Web UI from loopback. The desktop process does not reimplement Harness sessions, providers, tools, or the Cordis composition.

`DSH_HOME` remains user-owned. The default is `%USERPROFILE%\.dsh`; an explicit environment value wins. Port 3080 is attached only when its HTML contains the exact official `DeepSeek Harness` title. An unrelated listener causes a private service to start on the next free loopback port. Managed launches always pass `--no-open`, and no LAN bind is allowed.

The service manager holds the only process handle it may terminate. An attached external Harness is read-only from the lifecycle perspective. Managed shutdown first sends `SIGTERM` and, after a bounded wait, invokes Windows `taskkill` only for the recorded child PID and its tree.

Native Harness attachments are the default image path. Vision evidence is an opt-in desktop-side adapter for text-only models: Windows Media OCR supplies text and word bounding boxes, and an optional OpenAI-compatible vision endpoint may add image semantics. The result is a versioned JSON object inserted as text.

The packaged application resolves Node and dsh from `process.resourcesPath`; development-only overrides are ignored in packaged builds. This prevents a `dsh` or `node` on `PATH` from changing the runtime.

The fixed Harness closure is shipped as `harness-runtime.tar.gz` and extracted once into Electron `userData/runtime/harness-<version>`. The extracted marker, CLI entry, Web frontend, and pinned Harness version are validated before launch. A different pinned version receives a separate directory, while a corrupt or incomplete extraction fails before the service starts.

Official runtime updates first query the npm registry for `@deepseek-ai/dsh` and compare `latest` with `next`. A machine-readable compatibility matrix blocks activation of unqualified future versions. The bundled Node.js/pnpm installs a verified, qualified tarball with production dependencies and ignored lifecycle scripts into a new runtime slot. The updater validates the CLI entry and Web frontend, then records a pending selection. The desktop service restarts against that slot; only a successful readiness check promotes it to active. If npm is unavailable, a qualified GitHub Release runtime archive with a SHA-256 digest is accepted as fallback. HTML scraping and unsigned source archives are never used. `DSH_HOME` and Harness session data are never part of the update transaction.

Desktop application downloads are shown in a separate non-modal update window. Progress events never navigate the main Harness window, and update failures remain inspectable without blocking the menu or model settings.
