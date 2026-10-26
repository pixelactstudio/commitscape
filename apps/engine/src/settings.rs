use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct S3 {
    pub endpoint: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub path_style: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    Dir(PathBuf),
    S3(S3),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Sentry {
    pub dsn: String,
    pub environment: String,
    pub traces_sample_rate: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    pub port: u16,
    pub token: String,
    pub source: Source,
    pub pack_dir: PathBuf,
    pub disk_bytes: u64,
    pub memory_bytes: u64,
    pub threads: usize,
    pub sentry: Option<Sentry>,
}

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

const MB: f64 = 1024.0 * 1024.0;

fn number<T: std::str::FromStr>(
    get: &impl Fn(&str) -> Option<String>,
    name: &str,
    default: T,
) -> Result<T, String> {
    match get(name).filter(|v| !v.trim().is_empty()) {
        Some(v) => v
            .trim()
            .parse()
            .map_err(|_| format!("{name} must be a number, not {v:?}")),
        None => Ok(default),
    }
}

fn size(
    get: &impl Fn(&str) -> Option<String>,
    name: &str,
    default: f64,
    unit: f64,
) -> Result<u64, String> {
    let n: f64 = number(get, name, default)?;
    if !n.is_finite() || n < 0.0 {
        return Err(format!("{name} must be a size of zero or more"));
    }
    Ok((n * unit) as u64)
}

fn flag(get: &impl Fn(&str) -> Option<String>, name: &str) -> Result<bool, String> {
    match get(name).map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") => Ok(false),
        Some("true" | "1" | "yes" | "on" | "y" | "enabled") => Ok(true),
        Some("false" | "0" | "no" | "off" | "n" | "disabled") => Ok(false),
        Some(v) => Err(format!("{name} must be true or false, not {v:?}")),
    }
}

fn required(get: &impl Fn(&str) -> Option<String>, name: &str) -> Result<String, String> {
    get(name)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

/// How many threads CPU work gets: `COMMITSCAPE_THREADS` when set, never more than the machine has or 16.
pub fn threads(asked: Option<usize>) -> usize {
    let cores = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    asked.unwrap_or(cores).min(cores).clamp(1, 16)
}

impl Settings {
    /// Reads the settings from the environment.
    pub fn from_env() -> Result<Settings, String> {
        Settings::from_vars(|name| std::env::var(name).ok())
    }

    /// Reads the settings from any source of named values.
    pub fn from_vars(get: impl Fn(&str) -> Option<String>) -> Result<Settings, String> {
        let source = match get("PACK_SOURCE").filter(|v| !v.trim().is_empty()) {
            Some(v) => match v.strip_prefix("dir:") {
                Some(dir) if !dir.is_empty() => Source::Dir(PathBuf::from(dir)),
                _ if v == "s3" => s3(&get)?,
                _ => return Err(format!("PACK_SOURCE must be s3 or dir:<path>, not {v:?}")),
            },
            None => s3(&get)?,
        };
        let asked_threads: Option<usize> =
            match get("COMMITSCAPE_THREADS").filter(|v| !v.trim().is_empty()) {
                Some(v) => Some(
                    v.trim()
                        .parse()
                        .map_err(|_| format!("COMMITSCAPE_THREADS must be a number, not {v:?}"))?,
                ),
                None => None,
            };
        let sentry = match get("SENTRY_DSN").filter(|v| !v.trim().is_empty()) {
            Some(dsn) => Some(Sentry {
                dsn,
                environment: get("SENTRY_ENVIRONMENT")
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or_else(|| "production".to_string()),
                traces_sample_rate: number(&get, "SENTRY_TRACES_SAMPLE_RATE", 1.0)?,
            }),
            None => None,
        };
        Ok(Settings {
            port: number(&get, "PORT", 4100)?,
            token: required(&get, "ENGINE_TOKEN")?,
            source,
            pack_dir: PathBuf::from(
                get("PACK_DIR")
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or_else(|| "/data/packs".to_string()),
            ),
            disk_bytes: size(&get, "PACK_DISK_GB", 10.0, GB)?,
            memory_bytes: size(&get, "PACK_MEMORY_MB", 512.0, MB)?,
            threads: threads(asked_threads),
            sentry,
        })
    }
}

fn s3(get: &impl Fn(&str) -> Option<String>) -> Result<Source, String> {
    Ok(Source::S3(S3 {
        endpoint: required(get, "S3_ENDPOINT")?,
        bucket: required(get, "S3_BUCKET")?,
        access_key_id: required(get, "S3_ACCESS_KEY_ID")?,
        secret_access_key: required(get, "S3_SECRET_ACCESS_KEY")?,
        region: get("S3_REGION")
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "auto".to_string()),
        path_style: flag(get, "S3_FORCE_PATH_STYLE")?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn settings(pairs: &[(&str, &str)]) -> Result<Settings, String> {
        let vars: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Settings::from_vars(|name| vars.get(name).cloned())
    }

    #[test]
    fn a_local_folder_needs_only_a_token() {
        let s = settings(&[("ENGINE_TOKEN", "t"), ("PACK_SOURCE", "dir:/tmp/packs")]).unwrap();
        assert_eq!(s.source, Source::Dir(PathBuf::from("/tmp/packs")));
        assert_eq!(s.port, 4100);
        assert_eq!(s.pack_dir, PathBuf::from("/data/packs"));
        assert_eq!(s.disk_bytes, 10 * 1024 * 1024 * 1024);
        assert_eq!(s.memory_bytes, 512 * 1024 * 1024);
        assert!(s.threads >= 1 && s.threads <= 16);
        assert_eq!(s.sentry, None);
    }

    #[test]
    fn r2_is_read_with_its_s3_settings() {
        let s = settings(&[
            ("ENGINE_TOKEN", "t"),
            ("S3_ENDPOINT", "http://localhost:9100"),
            ("S3_BUCKET", "b"),
            ("S3_ACCESS_KEY_ID", "k"),
            ("S3_SECRET_ACCESS_KEY", "s"),
            ("S3_FORCE_PATH_STYLE", "true"),
            ("PACK_DISK_GB", "0.5"),
            ("PACK_MEMORY_MB", "64"),
            ("COMMITSCAPE_THREADS", "1"),
            ("PORT", "4200"),
            ("SENTRY_DSN", "https://key@example.invalid/1"),
        ])
        .unwrap();
        assert_eq!(
            s.source,
            Source::S3(S3 {
                endpoint: "http://localhost:9100".into(),
                bucket: "b".into(),
                access_key_id: "k".into(),
                secret_access_key: "s".into(),
                region: "auto".into(),
                path_style: true,
            })
        );
        assert_eq!(
            (s.disk_bytes, s.memory_bytes),
            (512 * 1024 * 1024, 64 * 1024 * 1024)
        );
        assert_eq!((s.threads, s.port), (1, 4200));
        assert_eq!(s.sentry.map(|s| s.environment), Some("production".into()));
    }

    #[test]
    fn what_is_missing_or_wrong_is_named() {
        assert_eq!(
            settings(&[("PACK_SOURCE", "dir:/x")]),
            Err("ENGINE_TOKEN is required".into())
        );
        assert_eq!(
            settings(&[("ENGINE_TOKEN", "t")]),
            Err("S3_ENDPOINT is required".into())
        );
        assert!(settings(&[("ENGINE_TOKEN", "t"), ("PACK_SOURCE", "ftp:x")]).is_err());
        assert!(settings(&[
            ("ENGINE_TOKEN", "t"),
            ("PACK_SOURCE", "dir:/x"),
            ("PACK_MEMORY_MB", "lots")
        ])
        .is_err());
    }
}
