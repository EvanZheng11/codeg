use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use url::Url;

pub const FINDER_DIRECTORY_OPENED_EVENT: &str = "finder://directory-opened";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenedPathError {
    InvalidUrl,
    UnsupportedScheme,
    NonLocalFile,
    InvalidFilePath,
    NotDirectory,
    UnreadablePath,
}

pub fn parse_opened_url(raw: &str) -> Result<PathBuf, OpenedPathError> {
    let url = Url::parse(raw).map_err(|_| OpenedPathError::InvalidUrl)?;
    if url.scheme() != "file" {
        return Err(OpenedPathError::UnsupportedScheme);
    }
    if url
        .host_str()
        .is_some_and(|host| !host.is_empty() && !host.eq_ignore_ascii_case("localhost"))
    {
        return Err(OpenedPathError::NonLocalFile);
    }

    let path = url
        .to_file_path()
        .map_err(|_| OpenedPathError::InvalidFilePath)?;
    let path = std::fs::canonicalize(path).map_err(|_| OpenedPathError::UnreadablePath)?;
    if !path.is_dir() {
        return Err(OpenedPathError::NotDirectory);
    }
    Ok(path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueResult {
    Queued,
    Ready,
    Duplicate,
}

#[derive(Debug, Default)]
struct QueueState {
    frontend_ready: bool,
    pending: Vec<PathBuf>,
}

#[derive(Debug, Default)]
pub struct OpenedPathQueue {
    state: Mutex<QueueState>,
}

impl OpenedPathQueue {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(QueueState::default()),
        }
    }

    pub fn push(&self, path: PathBuf) -> EnqueueResult {
        let Ok(mut state) = self.state.lock() else {
            tracing::error!("Finder 目录事件队列锁已损坏，丢弃路径");
            return EnqueueResult::Duplicate;
        };
        if state.frontend_ready {
            return EnqueueResult::Ready;
        }
        if state.pending.iter().any(|pending| pending == &path) {
            return EnqueueResult::Duplicate;
        }
        state.pending.push(path);
        EnqueueResult::Queued
    }

    pub fn drain(&self) -> Vec<PathBuf> {
        let Ok(mut state) = self.state.lock() else {
            tracing::error!("Finder 目录事件队列锁已损坏，无法取出暂存路径");
            return Vec::new();
        };
        state.frontend_ready = true;
        std::mem::take(&mut state.pending)
    }

    pub fn mark_frontend_ready(&self) -> Vec<PathBuf> {
        self.drain()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct FinderDirectoryOpened {
    pub path: String,
}

pub fn event_for_path(path: &Path) -> FinderDirectoryOpened {
    FinderDirectoryOpened {
        // JSON 事件必须是 UTF-8；解析阶段仍保留非 UTF-8 PathBuf，交给前端
        // 时使用稳定的 lossy 表示，避免因为路径编码导致整个事件丢失。
        path: path.to_string_lossy().into_owned(),
    }
}

pub fn deduplicate_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

static OPENED_PATH_QUEUE: OnceLock<OpenedPathQueue> = OnceLock::new();

pub fn global_queue() -> &'static OpenedPathQueue {
    OPENED_PATH_QUEUE.get_or_init(OpenedPathQueue::new)
}

#[cfg(feature = "tauri-runtime")]
pub fn handle_opened_urls(app: &tauri::AppHandle, urls: &[Url]) {
    let paths = urls
        .iter()
        .filter_map(|url| match parse_opened_url(url.as_str()) {
            Ok(path) => Some(path),
            Err(error) => {
                tracing::warn!("Finder 目录事件忽略 URL {}：{:?}", url, error);
                None
            }
        });

    for path in deduplicate_paths(paths) {
        match global_queue().push(path.clone()) {
            EnqueueResult::Queued => {
                tracing::info!("Finder 目录事件已暂存：{}", path.display());
            }
            EnqueueResult::Ready => {
                emit_directory_opened(app, &path);
            }
            EnqueueResult::Duplicate => {
                tracing::info!("Finder 目录事件已去重：{}", path.display());
            }
        }
    }
}

#[cfg(feature = "tauri-runtime")]
fn emit_directory_opened(app: &tauri::AppHandle, path: &Path) {
    let emitter = crate::web::event_bridge::EventEmitter::Tauri(app.clone());
    crate::web::event_bridge::emit_event(
        &emitter,
        FINDER_DIRECTORY_OPENED_EVENT,
        event_for_path(path),
    );
    tracing::info!("Finder 目录事件已广播：{}", path.display());
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub fn take_pending_finder_directories() -> Vec<FinderDirectoryOpened> {
    global_queue()
        .drain()
        .iter()
        .map(|path| event_for_path(path.as_path()))
        .collect()
}
