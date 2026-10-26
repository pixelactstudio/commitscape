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
    let app = routes::router(engine.clone());
    let served = axum::serve(listener, app)
        .with_graceful_shutdown(stopped())
        .await
        .map_err(|e| e.to_string());
    engine.work.close();
    tracing::info!("engine stopped");
    served
}
