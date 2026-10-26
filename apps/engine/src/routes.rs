use std::fmt::Write as _;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sentry::SentryFutureExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tracing::Instrument;

use crate::answer;
use crate::loaded::LoadedPack;
use crate::lru::SizedLru;
use crate::packs::{PackFailure, Packs};
use crate::params::{self, Params};
use crate::questions::{self, Question};
use crate::work::{Work, WorkError};
use commitscape_report::universe;

pub const ANSWER_BYTES: u64 = 128 * 1024 * 1024;

pub struct Engine {
    pub packs: Packs,
    pub work: Arc<Work>,
    token: String,
    answers: Mutex<SizedLru<String, Bytes>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    BadRequest(String),
    Unauthorized,
    NoAnswer,
    Pack(PackFailure),
    Work(WorkError),
}

impl From<PackFailure> for Failure {
    fn from(e: PackFailure) -> Self {
        Failure::Pack(e)
    }
}

impl From<WorkError> for Failure {
    fn from(e: WorkError) -> Self {
        Failure::Work(e)
    }
}

impl From<JsonRejection> for Failure {
    fn from(e: JsonRejection) -> Self {
        Failure::BadRequest(e.body_text())
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            Failure::BadRequest(why) => (StatusCode::BAD_REQUEST, why),
            Failure::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            Failure::NoAnswer => (StatusCode::NOT_FOUND, "no such answer".to_string()),
            Failure::Pack(PackFailure::Missing) => {
                (StatusCode::NOT_FOUND, "no such pack".to_string())
            }
            Failure::Pack(PackFailure::BadKey) => {
                (StatusCode::BAD_REQUEST, "not a pack key".to_string())
            }
            Failure::Work(WorkError::Closed) => (
                StatusCode::SERVICE_UNAVAILABLE,
                WorkError::Closed.to_string(),
            ),
            Failure::Pack(e) => {
                tracing::error!(error = %e, "pack failed");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
            Failure::Work(e) => {
                tracing::error!(error = %e, "work failed");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        };
        (status, Json(json!({ "error": error }))).into_response()
    }
}

fn json_bytes(bytes: Bytes) -> Response {
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        bytes,
    )
        .into_response()
}

fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Engine {
    /// The engine's state: its packs, its CPU pool, the token requests must carry, and the answers it worked out, kept by pack and question.
    pub fn new(packs: Packs, work: Arc<Work>, token: String, answer_bytes: u64) -> Engine {
        Engine {
            packs,
            work,
            token,
            answers: Mutex::new(SizedLru::new(answer_bytes)),
        }
    }

    /// A pack decoded, loaded in a task of its own, so a request that stops waiting for it does not stop the load the next one needs.
    async fn pack(self: &Arc<Self>, key: &str) -> Result<Arc<LoadedPack>, PackFailure> {
        let engine = self.clone();
        let key = key.to_string();
        let load = async move { engine.packs.get(&key).await };
        tokio::spawn(load.in_current_span().bind_hub(sentry::Hub::current()))
            .await
            .map_err(|e| PackFailure::Fetch(e.to_string()))?
    }

    fn kept(&self, key: &str) -> Option<Bytes> {
        self.answers.lock().ok()?.get(&key.to_string())
    }

    fn keep(&self, key: String, bytes: Bytes) {
        if let Ok(mut answers) = self.answers.lock() {
            let size = (key.len() + bytes.len()) as u64;
            answers.insert(key, bytes, size);
        }
    }

    /// Works out an answer's JSON once on the CPU pool and keeps it under `key`; None when there is no such answer.
    async fn made(
        self: &Arc<Self>,
        key: String,
        held: Arc<LoadedPack>,
        make: impl FnOnce(&LoadedPack) -> Option<Vec<u8>> + Send + 'static,
    ) -> Result<Option<Bytes>, WorkError> {
        let engine = self.clone();
        self.work
            .run(move || {
                if let Some(hit) = engine.kept(&key) {
                    return Some(hit);
                }
                let bytes = Bytes::from(make(&held)?);
                engine.keep(key, bytes.clone());
                Some(bytes)
            })
            .await
    }

    /// One question's answer from a pack, kept by pack and question, worked out on the CPU pool the first time.
    async fn asked<Q: Question>(
        self: &Arc<Self>,
        pack: &str,
        question: Q,
    ) -> Result<Bytes, Failure> {
        if let Some(why) = question.refused() {
            return Err(Failure::BadRequest(why));
        }
        let body = serde_json::to_vec(&question).map_err(|e| Failure::BadRequest(e.to_string()))?;
        let mut key = format!("{pack}\n{}\n", Q::PATH);
        for b in Sha256::digest(&body) {
            let _ = write!(key, "{b:02x}");
        }
        if let Some(hit) = self.kept(&key) {
            return Ok(hit);
        }
        let held = self.pack(pack).await?;
        self.made(key, held, move |held| question.answer(held).ok())
            .await?
            .ok_or(Failure::NoAnswer)
    }

    async fn answer(
        self: &Arc<Self>,
        pack: &str,
        path: String,
        params: &Params,
    ) -> Result<Option<Bytes>, Failure> {
        let asked = params::asked(params);
        let key = format!("{pack}\n{}", params::key(&path, &asked));
        if let Some(hit) = self.kept(&key) {
            return Ok(Some(hit));
        }
        let mut uncut = asked.clone();
        let top = uncut.remove("top").and_then(|_| params::top_of(&asked));
        let whole_key = format!("{pack}\n{}", params::key(&path, &uncut));
        let whole = match self.kept(&whole_key) {
            Some(hit) => Some(hit),
            None => {
                let held = self.pack(pack).await?;
                let (at, ask) = (path.clone(), uncut);
                self.made(whole_key, held, move |held| {
                    serde_json::to_vec(&answer::whole(held, &at, &ask)?).ok()
                })
                .await?
            }
        };
        let Some(whole) = whole else {
            return Ok(None);
        };
        if top.is_none() || !params::cuts(&path) {
            if asked.contains_key("top") {
                self.keep(key, whole.clone());
            }
            return Ok(Some(whole));
        }
        let cut = self
            .work
            .run(move || {
                let value: serde_json::Value = serde_json::from_slice(&whole).ok()?;
                serde_json::to_vec(&params::limited(&path, top, value))
                    .ok()
                    .map(Bytes::from)
            })
            .await?;
        if let Some(bytes) = &cut {
            self.keep(key, bytes.clone());
        }
        Ok(cut)
    }
}

#[derive(Deserialize)]
struct AnswerBody {
    pack: String,
    path: String,
    #[serde(default)]
    params: Params,
}

#[derive(Deserialize)]
struct PackBody {
    pack: String,
}

#[derive(Deserialize, Serialize)]
struct Asked<Q> {
    pack: String,
    #[serde(flatten)]
    question: Q,
}

#[derive(Deserialize)]
struct WarmBody {
    pack: String,
    #[serde(default)]
    keys: Vec<String>,
}

async fn healthz(State(engine): State<Arc<Engine>>) -> Response {
    let held = engine.packs.held();
    Json(json!({
        "ok": true,
        "packs": { "memory": held.memory_packs, "memory_bytes": held.memory_bytes, "disk": held.disk_packs, "disk_bytes": held.disk_bytes },
        "fetches": held.fetches,
        "decodes": held.decodes,
        "threads": engine.work.threads(),
    }))
    .into_response()
}

async fn answer(
    State(engine): State<Arc<Engine>>,
    body: Result<Json<AnswerBody>, JsonRejection>,
) -> Result<Response, Failure> {
    let Json(body) = body?;
    let made = engine.answer(&body.pack, body.path, &body.params).await?;
    made.map(json_bytes).ok_or(Failure::NoAnswer)
}

async fn universe_rows(
    State(engine): State<Arc<Engine>>,
    body: Result<Json<PackBody>, JsonRejection>,
) -> Result<Response, Failure> {
    let Json(body) = body?;
    let key = format!("{}\n/v1/universe/rows", body.pack);
    if let Some(hit) = engine.kept(&key) {
        return Ok(json_bytes(hit));
    }
    let held = engine.pack(&body.pack).await?;
    let made = engine
        .made(key, held, |held| {
            serde_json::to_vec(&universe::rows(&held.pack)).ok()
        })
        .await?;
    made.map(json_bytes).ok_or(Failure::NoAnswer)
}

async fn warm(
    State(engine): State<Arc<Engine>>,
    body: Result<Json<WarmBody>, JsonRejection>,
) -> Result<Response, Failure> {
    let Json(body) = body?;
    engine.pack(&body.pack).await?;
    let mut made = 0u32;
    for key in &body.keys {
        let (path, query) = key.split_once('?').unwrap_or((key.as_str(), ""));
        if engine
            .answer(&body.pack, path.to_string(), &params::from_query(query))
            .await?
            .is_some()
        {
            made += 1;
        }
    }
    Ok(Json(json!({ "made": made })).into_response())
}

async fn asked<Q: Question>(
    State(engine): State<Arc<Engine>>,
    body: Result<Json<Asked<Q>>, JsonRejection>,
) -> Result<Response, Failure> {
    let Json(body) = body?;
    engine
        .asked(&body.pack, body.question)
        .await
        .map(json_bytes)
}

async fn no_such_endpoint() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "no such endpoint" })),
    )
        .into_response()
}

async fn authorized(State(engine): State<Arc<Engine>>, req: Request, next: Next) -> Response {
    let given = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if !given.is_some_and(|t| same(t.as_bytes(), engine.token.as_bytes())) {
        return Failure::Unauthorized.into_response();
    }
    next.run(req).await
}

/// Every endpoint: `GET /healthz` open, everything under `/v1` behind the bearer token, each request traced.
pub fn router(engine: Arc<Engine>) -> Router {
    let v1 = Router::new()
        .route("/v1/answer", post(answer))
        .route("/v1/universe/rows", post(universe_rows))
        .route("/v1/warm", post(warm))
        .route(questions::Tree::PATH, post(asked::<questions::Tree>))
        .route(questions::Log::PATH, post(asked::<questions::Log>))
        .route(
            questions::Coupling::PATH,
            post(asked::<questions::Coupling>),
        )
        .route(
            questions::PathHistory::PATH,
            post(asked::<questions::PathHistory>),
        )
        .route(
            questions::FolderLast::PATH,
            post(asked::<questions::FolderLast>),
        )
        .route(questions::Story::PATH, post(asked::<questions::Story>))
        .route(questions::CodeLog::PATH, post(asked::<questions::CodeLog>))
        .route(questions::Under::PATH, post(asked::<questions::Under>))
        .route(questions::Insight::PATH, post(asked::<questions::Insight>));
    let v1 = v1.route_layer(middleware::from_fn_with_state(engine.clone(), authorized));
    Router::new()
        .route("/healthz", get(healthz))
        .merge(v1)
        .fallback(no_such_endpoint)
        .layer(middleware::from_fn(crate::telemetry::traced))
        .with_state(engine)
}
