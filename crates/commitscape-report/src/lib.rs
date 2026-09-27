pub mod api;
pub mod filter;
pub mod report;
pub mod wrapped_card;

use std::collections::HashMap;
use std::sync::Arc;

use commitscape_core::{AuthorId, Index};
use commitscape_forge::history::History;
use commitscape_metrics::{Analysis, Options, Span, Window};

pub use filter::Filter;

pub type DrawCard = Arc<dyn Fn(&Index, Span, i64) -> String + Send + Sync>;

struct Asked {
    window: Window,
    label: String,
    filter: Filter,
}

fn asked(p: &HashMap<String, String>, span: Span, anchor: i64) -> Asked {
    let span = p
        .get("window")
        .and_then(|w| Span::from_label(w))
        .unwrap_or(span);
    let mut window = span.window(anchor);
    let mut label = span.label().to_string();
    let from = p.get("from").and_then(|v| v.parse::<i64>().ok());
    let to = p.get("to").and_then(|v| v.parse::<i64>().ok());
    if from.is_some() || to.is_some() {
        window = Window {
            from,
            to: to.unwrap_or(anchor),
        };
        label = "range".to_string();
    }
    Asked {
        window,
        label,
        filter: Filter {
            person: p.get("person").and_then(|v| v.parse().ok()).map(AuthorId),
            folder: p.get("folder").filter(|f| !f.is_empty()).cloned(),
        },
    }
}

pub(crate) struct Snapshot {
    pub index: Arc<Index>,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub releases: Vec<(String, i64)>,
    pub lines_counted: bool,
    pub history: Option<Arc<History>>,
    pub colours: Arc<HashMap<AuthorId, u8>>,
    pub logins: Arc<HashMap<String, AuthorId>>,
    pub commit_link: Option<String>,
    pub emails: bool,
}

pub(crate) fn screen(
    snap: &Snapshot,
    path: &str,
    p: &HashMap<String, String>,
) -> Result<Vec<u8>, (u16, String)> {
    if path == "/api/commits" {
        let login_of = api::login_of(&snap.logins);
        let cx = api::Context {
            window: "all",
            colours: &snap.colours,
            releases: &snap.releases,
            lines_counted: snap.lines_counted,
            history: snap.history.as_deref(),
            logins: &snap.logins,
            login_of: &login_of,
            emails: snap.emails,
        };
        let list = api::CommitList::of(&snap.index, &cx, snap.commit_link.as_deref(), snap.emails);
        return serde_json::to_vec(&list).map_err(|e| (500, e.to_string()));
    }
    let asked = asked(p, snap.span, snap.anchor);
    let filtered;
    let index: &Index = if asked.filter.is_empty() {
        &snap.index
    } else if snap.index.loaded_from.is_some() {
        return Err((
            409,
            "Filters wait for the rest of history, which is being read now.".to_string(),
        ));
    } else {
        filtered = asked
            .filter
            .apply(&snap.index, snap.options.max_changeset_size);
        &filtered
    };
    let a = Analysis::new(index, asked.window, snap.options).map_err(|_| {
        (
            409,
            "That window needs history that is still being read.".to_string(),
        )
    })?;
    let login_of = api::login_of(&snap.logins);
    let cx = api::Context {
        window: &asked.label,
        colours: &snap.colours,
        releases: &snap.releases,
        lines_counted: snap.lines_counted,
        history: snap.history.as_deref(),
        logins: &snap.logins,
        login_of: &login_of,
        emails: snap.emails,
    };
    let missing = || (404, "No such person, folder or file.".to_string());
    let body = match path {
        "/api/overview" => serde_json::to_vec(&api::Overview::of(&a, &cx)),
        "/api/activity" => serde_json::to_vec(&api::Activity::of(&a, &cx)),
        "/api/people" => serde_json::to_vec(&api::People::of(&a, &cx)),
        "/api/risk" => serde_json::to_vec(&api::Risk::of(&a, &cx)),
        "/api/person" => {
            let id = p.get("id").and_then(|v| v.parse().ok()).map(AuthorId);
            let person = id
                .and_then(|id| api::Person::of(&a, &cx, id))
                .ok_or_else(missing)?;
            serde_json::to_vec(&person)
        }
        "/api/map" => {
            let at = p.get("path").map(String::as_str).unwrap_or("");
            let level = api::MapLevel::of(&a, &cx, at).ok_or_else(missing)?;
            serde_json::to_vec(&level)
        }
        "/api/file" => {
            let at = p.get("path").map(String::as_str).unwrap_or("");
            let file = api::File::of(&a, &cx, at).ok_or_else(missing)?;
            serde_json::to_vec(&file)
        }
        _ => return Err((404, "No such API.".to_string())),
    };
    body.map_err(|e| (500, e.to_string()))
}
