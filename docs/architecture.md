# DeepSeek Harness Desktop architecture

The application has three processes: Electron owns the native window and tray, bundled `node.exe` owns the official `dsh web` process, and the Chromium renderer loads the unmodified official Web UI from loopback. The desktop process does not reimplement Harness sessions, providers, tools, or the Cordis composition.

`DSH_HOME` remains user-owned. The default is `%USERPROFILE%\.dsh`; an explicit environment value wins. Port 3080 is attached only when its HTML contains the exact official `DeepSeek Harness` title. An unrelated listener causes a private service to start on the next free loopback port. No LAN bind is allowed.

The service manager holds the only process handle it may terminate. An attached external Harness is read-only from the lifecycle perspective. Managed shutdown first sends `SIGTERM` and, after a bounded wait, invokes Windows `taskkill` only for the recorded child PID and its tree.

Vision evidence is a desktop-side adapter. Windows Media OCR supplies text and word bounding boxes. An optional OpenAI-compatible vision endpoint may add image semantics. The result is a versioned JSON object inserted as text, so a text-only chat model receives explicit evidence rather than an unsupported image object.

The packaged application resolves Node and dsh from `process.resourcesPath`; development-only overrides are ignored in packaged builds. This prevents a `dsh` or `node` on `PATH` from changing the runtime.

The fixed Harness closure is shipped as `harness-runtime.tar.gz` and extracted once into Electron `userData/runtime/harness-<version>`. The extracted marker, CLI entry, Web frontend, and pinned Harness version are validated before launch. A different pinned version receives a separate directory, while a corrupt or incomplete extraction fails before the service starts.

Official runtime updates use the GitHub Releases API, not HTML scraping. The updater accepts only a Windows runtime archive with a GitHub SHA-256 digest, downloads it into a new runtime slot, validates the CLI entry and Web frontend, and records a pending selection. The desktop service restarts against that slot; only a successful readiness check promotes it to active. A failed restart removes the pending slot and restores the previous runtime. `DSH_HOME` and Harness session data are never part of the update transaction.
