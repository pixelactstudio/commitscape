use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::Subscriber;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

/// Writes one JSON line to `path` for every span that finishes from now on: its name, when it started and ended in Unix milliseconds, and its fields.
pub fn record_to(path: Option<&Path>) -> anyhow::Result<()> {
    let Some(path) = path else {
        return Ok(());
    };
    let file = File::create(path)
        .map_err(|e| anyhow::anyhow!("could not write {}: {e}", path.display()))?;
    let subscriber = tracing_subscriber::registry().with(Events {
        out: Mutex::new(file),
    });
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|e| anyhow::anyhow!("could not record events: {e}"))
}

struct Events {
    out: Mutex<File>,
}

struct Timing {
    start_ms: u64,
    fields: Map<String, Value>,
}

struct Fields<'a>(&'a mut Map<String, Value>);

impl Visit for Fields<'_> {
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.0.insert(field.name().to_string(), Value::from(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0.insert(field.name().to_string(), Value::from(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name().to_string(), Value::from(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0.insert(field.name().to_string(), Value::from(value));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_string(), Value::from(value));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0
            .insert(field.name().to_string(), Value::from(format!("{value:?}")));
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl<S> Layer<S> for Events
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut fields = Map::new();
        attrs.record(&mut Fields(&mut fields));
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(Timing {
                start_ms: now_ms(),
                fields,
            });
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id) {
            if let Some(timing) = span.extensions_mut().get_mut::<Timing>() {
                values.record(&mut Fields(&mut timing.fields));
            }
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else {
            return;
        };
        let Some(timing) = span.extensions_mut().remove::<Timing>() else {
            return;
        };
        let event = serde_json::json!({
            "span": span.name(),
            "start_ms": timing.start_ms,
            "end_ms": now_ms(),
            "fields": timing.fields,
        });
        let mut line = event.to_string();
        line.push('\n');
        if let Ok(mut out) = self.out.lock() {
            let _ = out.write_all(line.as_bytes());
        }
    }
}
