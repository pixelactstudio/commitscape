//! Who may use the server (ADR-0010): a random token in every first URL,
//! kept in a cookie after that, and a `Host` header this server answers to,
//! which stops a web page on another site reaching it by DNS rebinding.

use std::net::SocketAddr;

/// A secret the server was started with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    /// Sixteen random bytes, as hex.
    pub fn random() -> std::io::Result<Token> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(Token(bytes.iter().map(|b| format!("{b:02x}")).collect()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What the server checks every request against.
#[derive(Debug, Clone)]
pub struct Guard {
    pub token: Token,
    /// `Host` values it answers to: the address it listens on, `localhost`
    /// and, when it listens beyond this machine, the machine's name.
    pub hosts: Vec<String>,
    /// The cookie that carries the token, named for the port so two servers
    /// on one machine do not overwrite each other's.
    pub cookie: String,
}

impl Guard {
    pub fn new(token: Token, addr: SocketAddr, machine: Option<&str>) -> Guard {
        let port = addr.port();
        let mut hosts = vec![
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
            format!("[::1]:{port}"),
            addr.to_string(),
        ];
        if !addr.ip().is_loopback() {
            if let Some(name) = machine {
                hosts.push(format!("{name}:{port}"));
                hosts.push(format!("{name}.local:{port}"));
            }
        }
        hosts.sort();
        hosts.dedup();
        Guard {
            token,
            hosts,
            cookie: format!("commitscape-{port}"),
        }
    }

    pub fn host_allowed(&self, host: Option<&str>) -> bool {
        host.is_some_and(|h| self.hosts.iter().any(|a| a.eq_ignore_ascii_case(h)))
    }

    /// Whether a request carries the token: in its cookie, or in its URL's
    /// `token=`.
    pub fn authorised(&self, cookie: Option<&str>, query: Option<&str>) -> bool {
        let t = self.token.as_str();
        let in_cookie = cookie.is_some_and(|c| {
            c.split(';')
                .filter_map(|kv| kv.trim().split_once('='))
                .any(|(k, v)| k == self.cookie && v == t)
        });
        in_cookie || token_in(query).is_some_and(|q| q == t)
    }

    /// The `Set-Cookie` value that keeps the token.
    pub fn set_cookie(&self) -> String {
        format!(
            "{}={}; HttpOnly; SameSite=Strict; Path=/",
            self.cookie,
            self.token.as_str()
        )
    }
}

/// The `token=` of a query string.
pub(crate) fn token_in(query: Option<&str>) -> Option<&str> {
    query?
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == "token")
        .map(|(_, v)| v)
}
