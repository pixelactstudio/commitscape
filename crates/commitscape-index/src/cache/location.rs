//! Where caches live by default: the platform's user cache directory, never
//! inside the repository being read.

use std::path::PathBuf;

/// `COMMITSCAPE_CACHE_DIR` if set, otherwise the platform's cache directory
/// followed by `commitscape`: `$XDG_CACHE_HOME` or `~/.cache` on Linux,
/// `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows. `None` if none
/// of those can be determined, which disables caching.
pub fn default_cache_root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("COMMITSCAPE_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }
    platform_cache_dir().map(|d| d.join("commitscape"))
}

#[cfg(target_os = "macos")]
fn platform_cache_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Caches"))
}

#[cfg(windows)]
fn platform_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_cache_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CACHE_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
}
