pub mod answer;
pub mod code;
pub mod commits;
pub mod git;
pub mod languages;
pub mod loaded;
pub mod lru;
pub mod packs;
pub mod params;
pub mod pulls;
pub mod questions;
pub mod routes;
pub mod s3;
pub mod settings;
pub mod telemetry;
pub mod view;
pub mod work;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use packs::{Fetcher, Packs};
use routes::Engine;
use settings::{Settings, Source};
use work::Work;

/// The engine ready to serve: its CPU pool and its packs opened as the settings say.
pub async fn engine(settings: &Settings) -> Result<Arc<Engine>, String> {
    let work = Arc::new(Work::new(settings.threads).map_err(|e| e.to_string())?);
    let fetcher = match &settings.source {
        Source::Dir(dir) => Fetcher::Dir(dir.clone()),
        Source::S3(s3) => Fetcher::S3(Arc::new(s3::S3Source::new(s3)?)),
    };
    let packs = Packs::open(
        fetcher,
        settings.pack_dir.clone(),
        settings.disk_bytes,
        settings.memory_bytes,
        work.clone(),
    )
    .await
    .map_err(|e| {
        format!(
            "could not open PACK_DIR {}: {e}",
            settings.pack_dir.display()
        )
    })?;
    Ok(Arc::new(Engine::new(
        packs,
        work,
        settings.token.clone(),
        routes::ANSWER_BYTES,
    )))
}

/// Where the engine service says which pack formats it reads, beside the packs, for a Builder that cannot reach it.
pub const FORMATS_KEY: &str = "engine/formats.json";

/// Writes beside the packs (to R2, or into the folder packs are read from) the pack formats this engine service reads and its version, so a Builder writes only packs it reads.
pub fn announce_formats(source: &Source) -> Result<(), String> {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let body = serde_json::to_vec(&serde_json::json!({
        "pack_formats": commitscape_report::pack::FORMATS_READ,
        "version": env!("CARGO_PKG_VERSION"),
        "at": at,
    }))
    .map_err(|e| e.to_string())?;
    match source {
        Source::Dir(dir) => {
            let path = dir.join(FORMATS_KEY);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(path, body).map_err(|e| e.to_string())
        }
        Source::S3(s3) => s3::S3Source::new(s3)?.put(FORMATS_KEY, &body, "application/json"),
    }
}

async fn stopped() {
    let interrupt = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    {
        let terminate = async {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut s) => {
                    s.recv().await;
                }
                Err(_) => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            () = interrupt => {}
            () = terminate => {}
        }
    }
    #[cfg(not(unix))]
    interrupt.await;
}

/// Serves the engine on `PORT` until SIGTERM or Ctrl-C, then finishes the requests under way.
pub async fn serve(settings: Settings) -> Result<(), String> {
    let engine = engine(&settings).await?;
    let address = SocketAddr::from(([0, 0, 0, 0], settings.port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|e| format!("could not listen on {address}: {e}"))?;
    tracing::info!(%address, threads = engine.work.threads(), "engine listening");
    let source = settings.source.clone();
    tokio::task::spawn_blocking(move || match announce_formats(&source) {
        Ok(()) => tracing::info!(key = FORMATS_KEY, "pack formats announced"),
        Err(why) => tracing::warn!(
            %why,
            key = FORMATS_KEY,
            "could not write the pack formats this engine service reads: Builders that cannot ask it write format 3"
        ),
    });
    let app = routes::router(engine.clone());
    let served = axum::serve(listener, app)
        .with_graceful_shutdown(stopped())
        .await
        .map_err(|e| e.to_string());
    engine.work.close();
    tracing::info!("engine stopped");
    served
}
