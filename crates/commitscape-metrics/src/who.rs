use std::collections::HashMap;

use commitscape_core::AuthorId;
use serde::Serialize;

use crate::analysis::{counts, Analysis};

const HALF_LIFE_DAYS: f64 = 180.0;
const STOPPED_DAYS: i64 = 90;
const DAY: i64 = 86_400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Expert {
    pub author: AuthorId,
    pub commits: u32,
    pub last_here: i64,
    pub last_seen: i64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Who {
    pub path: String,
    pub people: Vec<Expert>,
    pub instead: Option<AuthorId>,
}

impl Analysis<'_> {
    pub fn who(&self, path: &str) -> Option<Who> {
        let index = self.index();
        let window = self.window();
        let as_file = index.paths.get(path.as_bytes());
        let folder = match path.trim_end_matches('/') {
            "" => String::new(),
            p => format!("{p}/"),
        };
        let path = if as_file.is_some() {
            path.to_string()
        } else {
            folder
        };
        let touches = |file| match as_file {
            Some(f) => file == f,
            None => index
                .paths
                .path(file)
                .is_some_and(|p| p.starts_with(path.as_bytes())),
        };

        let mut here: HashMap<AuthorId, (f64, u32, i64)> = HashMap::new();
        let mut seen: HashMap<AuthorId, i64> = HashMap::new();
        let mut known = as_file.is_some();
        for c in self.window_commits() {
            let Some(person) = self.person_of(c) else {
                continue;
            };
            let last = seen.entry(person).or_insert(c.time);
            *last = (*last).max(c.time);
            if !counts(c, &self.options()) {
                continue;
            }
            if !index.changes_of(c).iter().any(|ch| touches(ch.file)) {
                continue;
            }
            known = true;
            let age_days = (window.to - c.time).max(0) as f64 / DAY as f64;
            let e = here.entry(person).or_insert((0.0, 0, c.time));
            e.0 += 0.5f64.powf(age_days / HALF_LIFE_DAYS);
            e.1 += 1;
            e.2 = e.2.max(c.time);
        }
        if !known && !index.head.iter().any(|h| touches(h.file)) {
            return None;
        }
        let mut ranked: Vec<(f64, Expert)> = here
            .into_iter()
            .map(|(author, (weight, commits, last_here))| {
                let last_seen = seen.get(&author).copied().unwrap_or(last_here);
                let active = window.to - last_seen <= STOPPED_DAYS * DAY;
                let e = Expert {
                    author,
                    commits,
                    last_here,
                    last_seen,
                    active,
                };
                (weight, e)
            })
            .collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.author.cmp(&b.1.author)));
        let people: Vec<Expert> = ranked.into_iter().map(|(_, e)| e).collect();
        let instead = match people.first() {
            Some(first) if !first.active => people.iter().find(|e| e.active).map(|e| e.author),
            _ => None,
        };
        Some(Who {
            path,
            people,
            instead,
        })
    }
}
