use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use commitscape_core::AuthorId;
use commitscape_metrics::{Analysis, Coupling};
use commitscape_report::api;
use commitscape_report::pack::{read_pack, Pack, PackError};

use crate::lru::SizedLru;
use crate::view::View;

const WINDOWS_KEPT: u64 = 8;

const UNDER_KEPT: u64 = 16;

type WindowKey = (Option<i64>, i64);

type Kept<T> = Mutex<SizedLru<WindowKey, Arc<T>>>;

fn kept_or_made<T>(kept: &Kept<T>, a: &Analysis<'_>, make: impl FnOnce() -> T) -> Arc<T> {
    let window = a.window();
    let key = (window.from, window.to);
    if let Some(hit) = kept.lock().ok().and_then(|mut k| k.get(&key)) {
        return hit;
    }
    let made = Arc::new(make());
    if let Ok(mut k) = kept.lock() {
        k.insert(key, made.clone(), 1);
    }
    made
}

pub struct LoadedPack {
    pub key: String,
    pub pack: Pack,
    pub bytes: u64,
    pub screens: HashMap<String, axum::body::Bytes>,
    colours: HashMap<AuthorId, u8>,
    login_of: HashMap<AuthorId, String>,
    windows: Kept<api::Shared>,
    couplings: Kept<Coupling>,
    view: OnceLock<View>,
    unders: Mutex<SizedLru<String, Arc<Vec<u32>>>>,
}

impl LoadedPack {
    /// Decodes a pack's bytes and readies what every answer from it shares.
    pub fn decode(key: &str, bytes: &[u8]) -> Result<LoadedPack, PackError> {
        let pack = read_pack(bytes)?;
        Ok(LoadedPack::of(key, pack))
    }

    /// Readies what every answer from a pack shares.
    pub fn of(key: &str, pack: Pack) -> LoadedPack {
        let colours = pack
            .colours
            .iter()
            .map(|&(id, colour)| (AuthorId(id), colour))
            .collect();
        let login_of = pack
            .logins
            .iter()
            .map(|(id, login)| (AuthorId(*id), login.clone()))
            .collect();
        LoadedPack {
            key: key.to_string(),
            bytes: pack.heap_bytes() as u64,
            screens: HashMap::new(),
            pack,
            colours,
            login_of,
            windows: Mutex::new(SizedLru::new(WINDOWS_KEPT)),
            couplings: Mutex::new(SizedLru::new(WINDOWS_KEPT)),
            view: OnceLock::new(),
            unders: Mutex::new(SizedLru::new(UNDER_KEPT)),
        }
    }

    /// What the Site's view of the Stored Index held beside its columns, worked out the first time an answer needs it.
    pub fn view(&self) -> &View {
        self.view.get_or_init(|| View::of(&self.pack))
    }

    /// The commits under a path, newest first, worked out once and kept for the few paths most asked.
    pub fn under(&self, path: &str) -> Arc<Vec<u32>> {
        let key = path.to_string();
        if let Some(hit) = self.unders.lock().ok().and_then(|mut u| u.get(&key)) {
            return hit;
        }
        let made = Arc::new(self.view().commits_under(&self.pack.index, path));
        if let Ok(mut u) = self.unders.lock() {
            u.insert(key, made.clone(), 1);
        }
        made
    }

    /// A person as the screens show them: name, colour and GitHub login, never an email address.
    pub fn person(&self, id: AuthorId) -> api::PersonRef {
        api::PersonRef {
            id: id.0,
            name: self
                .pack
                .index
                .authors
                .get(id)
                .map(|a| a.name.to_string())
                .unwrap_or_default(),
            colour: self.colours.get(&id).copied(),
            login: self.login_of.get(&id).cloned(),
        }
    }

    /// The context the Report's screens are drawn in for one Window: lines shown once the Mainline's are counted, as the Site shows them, and no email address.
    pub fn context<'a>(&'a self, label: &'a str) -> api::Context<'a> {
        api::Context {
            window: label,
            colours: &self.colours,
            releases: &self.pack.releases,
            lines_counted: self.pack.lines_mainline,
            login_of: &self.login_of,
            emails: false,
        }
    }

    /// One Window's contributors, ownership, contributions and code map, worked out once and kept for the few Windows most asked.
    pub fn shared(&self, a: &Analysis<'_>) -> Arc<api::Shared> {
        kept_or_made(&self.windows, a, || api::Shared::of(a))
    }

    /// One Window's Change Coupling, worked out once and kept for the few Windows most asked.
    pub fn coupling(&self, a: &Analysis<'_>) -> Arc<Coupling> {
        kept_or_made(&self.couplings, a, || a.coupling())
    }
}
