use std::process::ExitCode;
use std::time::Duration;

use commitscape_engine::settings::Settings;

fn healthy() -> ExitCode {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok())
        .unwrap_or(4100);
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .new_agent();
    match agent
        .get(&format!("http://127.0.0.1:{port}/healthz"))
        .call()
    {
        Ok(r) if r.status().is_success() => ExitCode::SUCCESS,
        _ => ExitCode::FAILURE,
    }
}

fn main() -> ExitCode {
    commitscape_map::release_large_blocks();
    if std::env::args().nth(1).as_deref() == Some("health") {
        return healthy();
    }
    let settings = match Settings::from_env() {
        Ok(s) => s,
        Err(why) => {
            eprintln!("commitscape-engine: {why}");
            return ExitCode::from(2);
        }
    };
    let guard = commitscape_engine::telemetry::init(settings.sentry.as_ref());
    let io_threads = settings.threads.clamp(2, 4);
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(io_threads)
        .max_blocking_threads(16)
        .thread_name("engine-io")
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("commitscape-engine: could not start: {e}");
            return ExitCode::FAILURE;
        }
    };
    let served = runtime.block_on(commitscape_engine::serve(settings));
    drop(runtime);
    drop(guard);
    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("commitscape-engine: {why}");
            ExitCode::FAILURE
        }
    }
}
