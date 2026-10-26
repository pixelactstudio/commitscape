use std::sync::Arc;
use std::time::Instant;

use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use sentry::protocol::SpanStatus;
use sentry::SentryFutureExt;
use tracing::Instrument;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use crate::settings::Sentry;

/// Logs to stderr, filtered by `RUST_LOG` (info by default), and when a DSN is given sends errors and spans to Sentry; the guard sends what is left when dropped.
pub fn init(sentry: Option<&Sentry>) -> Option<sentry::ClientInitGuard> {
    let guard = sentry.map(|s| {
        sentry::init(
            sentry::ClientOptions::new()
                .dsn(&s.dsn)
                .environment(s.environment.clone())
                .maybe_release(sentry::release_name!())
                .traces_sample_rate(s.traces_sample_rate)
                .send_default_pii(false),
        )
    });
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(
            guard
                .as_ref()
                .map(|_| sentry::integrations::tracing::layer()),
        )
        .try_init();
    guard
}

fn status_of(code: StatusCode) -> SpanStatus {
    match code.as_u16() {
        200..=399 => SpanStatus::Ok,
        400 => SpanStatus::InvalidArgument,
        401 => SpanStatus::Unauthenticated,
        403 => SpanStatus::PermissionDenied,
        404 => SpanStatus::NotFound,
        429 => SpanStatus::ResourceExhausted,
        501 => SpanStatus::Unimplemented,
        503 => SpanStatus::Unavailable,
        500..=599 => SpanStatus::InternalError,
        _ => SpanStatus::UnknownError,
    }
}

/// Runs each request but health checks in its own Sentry transaction, continuing the trace its `sentry-trace` and `baggage` headers carry, and logs how it went.
pub async fn traced(req: Request, next: Next) -> Response {
    if req.uri().path() == "/healthz" {
        return next.run(req).await;
    }
    let started = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let name = format!("{method} {path}");
    let context = sentry::TransactionContext::continue_from_headers(
        &name,
        "http.server",
        req.headers()
            .iter()
            .filter_map(|(k, v)| Some((k.as_str(), v.to_str().ok()?))),
    );
    let transaction = sentry::start_transaction(context);
    let hub = Arc::new(sentry::Hub::new_from_top(sentry::Hub::current()));
    hub.configure_scope(|scope| scope.set_span(Some(transaction.clone().into())));
    let span = sentry::Hub::run(
        hub.clone(),
        || tracing::info_span!("request", method = %method, path = %path),
    );
    let response = next.run(req).instrument(span.clone()).bind_hub(hub).await;
    let status = response.status();
    transaction.set_status(status_of(status));
    transaction.set_data("http.response.status_code", status.as_u16().into());
    transaction.finish();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    tracing::info!(parent: &span, status = status.as_u16(), ms, "answered");
    response
}
