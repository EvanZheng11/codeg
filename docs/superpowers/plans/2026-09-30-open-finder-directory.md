# Finder 打开目录实现计划

依据已批准设计，按以下 5 个任务实现。除测试和必要的测试夹具外，不扩展行为范围。

## 任务 1：macOS Tauri `RunEvent::Opened`、`file://` 解析与事件队列

- **Exact paths**
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/macos/opened_paths.rs`
  - `src-tauri/src/macos/mod.rs`
  - `src-tauri/src/macos/opened_paths_test.rs`
- **接口**
  - `parse_opened_url(url: &str) -> Result<PathBuf, OpenedPathError>`：仅接受本地 `file://` URL，正确处理 URL 解码、非 UTF-8 路径和目录路径。
  - `OpenedPathQueue::push(path: PathBuf)`、`OpenedPathQueue::drain() -> Vec<PathBuf>`：在应用初始化完成前暂存路径，并保证按接收顺序取出。
  - Tauri `RunEvent::Opened { urls }` 处理器：逐个解析 URL，解析成功后入队，失败时记录结构化错误日志。
  - 应用初始化完成后调用 `drain()`，将待处理目录交给工作区打开流程。
- **TDD 命令**
  - `cd src-tauri && cargo test opened_paths`
  - `cd src-tauri && cargo test --features test-utils opened_paths`
- **Commit**
  - `feat: handle macos finder opened events`

## 任务 2：Bundle 文件关联

- **Exact paths**
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Info.plist`
  - `src-tauri/src/macos/opened_paths.rs`
  - `src-tauri/tests/macos_bundle_file_association.rs`
- **接口**
  - Bundle 配置声明目录关联的 Finder 打开入口，并将打开的 URL 交给 `RunEvent::Opened`。
  - `is_supported_opened_path(path: &Path) -> bool`：只允许设计规定的目录类型，拒绝不支持的文件和协议。
  - Bundle 测试读取生成配置，断言关联声明存在且与 `file://` 处理器的支持范围一致。
- **TDD 命令**
  - `cd src-tauri && cargo test --test macos_bundle_file_association`
  - `pnpm exec tauri build --debug --bundles app`
- **Commit**
  - `feat: register finder directory file association`

## 任务 3：工作区幂等与默认智能体新会话

- **Exact paths**
  - `src-tauri/src/commands/workspaces.rs`
  - `src-tauri/src/models/workspace.rs`
  - `src-tauri/src/commands/sessions.rs`
  - `src/lib/api.ts`
  - `src/components/workspace/open-directory.tsx`
  - `src-tauri/tests/open_directory_workspace.rs`
- **接口**
  - `open_directory_core(path: &Path, state: &AppState) -> Result<WorkspaceOpenResult, AppError>`：规范化目录路径，以规范化路径查找现有工作区；已存在时复用并聚焦，不重复创建。
  - `create_default_agent_session(workspace_id: WorkspaceId, state: &AppState) -> Result<Session, AppError>`：仅在新工作区创建时调用，使用默认智能体创建一个新会话。
  - `OpenDirectoryResult`：返回 `workspace_id`、`created` 和 `session_id`，供 Tauri/Web 两种入口共用。
  - 前端 `openDirectory(path: string)`：调用统一 transport 接口并导航到返回的工作区。
- **TDD 命令**
  - `cd src-tauri && cargo test --test open_directory_workspace`
  - `pnpm exec vitest run src/lib/api.test.ts src/components/workspace/open-directory.test.tsx`
- **Commit**
  - `feat: open finder directories idempotently`

## 任务 4：去重与错误日志

- **Exact paths**
  - `src-tauri/src/macos/opened_paths.rs`
  - `src-tauri/src/commands/workspaces.rs`
  - `src-tauri/src/logging.rs`
  - `src-tauri/tests/open_directory_dedup.rs`
- **接口**
  - `deduplicate_opened_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf>`：在一次事件批次内按规范化路径去重并保留首次出现顺序。
  - `OpenDirectoryError`：区分 URL 解析失败、路径不存在、路径非目录、工作区打开失败和默认会话创建失败。
  - `log_open_directory_error(error: &OpenDirectoryError, path: Option<&Path>)`：记录错误类型、路径和请求来源；路径不可解析时不得伪造路径。
  - 重复事件只允许一次工作区打开和一次默认会话创建；失败项记录错误后继续处理同批次其他目录。
- **TDD 命令**
  - `cd src-tauri && cargo test --test open_directory_dedup`
  - `cd src-tauri && cargo test --features test-utils`
- **Commit**
  - `fix: deduplicate finder open errors`

## 任务 5：Rust、前端与真机测试

- **Exact paths**
  - `src-tauri/tests/open_directory_integration.rs`
  - `src-tauri/src/macos/opened_paths_test.rs`
  - `src/components/workspace/open-directory.test.tsx`
  - `src/lib/api.test.ts`
  - `docs/superpowers/plans/2026-09-30-open-finder-directory.md`
- **接口**
  - Rust 集成测试覆盖：冷启动事件队列、已初始化应用直接处理、URL 解码、重复目录、无效路径和默认会话创建。
  - 前端测试覆盖：请求成功导航、重复响应不重复创建、后端错误展示中文错误状态。
  - macOS 真机验收：Finder 双击关联目录、应用冷启动、应用已运行时打开、连续选择相同目录、无效路径日志和默认智能体新会话。
  - 验收日志保留事件来源、规范化路径、工作区复用/创建结果和错误分类，不输出访问令牌或其他敏感信息。
- **TDD 命令**
  - `cd src-tauri && cargo test --features test-utils`
  - `pnpm test -- --runInBand`
  - `pnpm lint .`
  - `pnpm build`
  - `cd src-tauri && cargo clippy --all-targets --features test-utils -- -D warnings`
  - `cd src-tauri && cargo check --no-default-features --bin codeg-server`
  - macOS 真机：`pnpm exec tauri dev`，再由 Finder 打开已关联目录并核对应用日志。
- **Commit**
  - `test: cover finder directory opening`

