//! The web app's built files, embedded by `build.rs`, and what to serve
//! when there are none.

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// Served in place of the app when `apps/local/dist` was not built.
const NOT_BUILT: &str = "<!doctype html><meta charset=utf-8><title>commitscape</title>\
<body style=\"font-family:system-ui;max-width:40em;margin:4em auto;line-height:1.5\">\
<h1>The browser interface was not built</h1>\
<p>This commitscape was compiled without its web app. Build it with \
<code>pnpm install &amp;&amp; pnpm build</code> at the repository's root, then \
<code>cargo build --release</code> again, or use the terminal interface: \
<code>commitscape --tui</code>.</p>";

/// A file by the path it is served at, and its content type. Any other
/// path that is not the API gets the app's page, which routes itself.
pub(crate) fn file(path: &str) -> (&'static [u8], &'static str) {
    let found = FILES.iter().find(|(p, _)| *p == path);
    match found {
        Some((p, bytes)) => (bytes, mime(p)),
        None => match FILES.iter().find(|(p, _)| *p == "/index.html") {
            Some((_, bytes)) => (bytes, "text/html; charset=utf-8"),
            None => (NOT_BUILT.as_bytes(), "text/html; charset=utf-8"),
        },
    }
}

/// Whether the app was built into this binary.
pub fn built() -> bool {
    FILES.iter().any(|(p, _)| *p == "/index.html")
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}
