use super::*;

fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |k| {
        pairs
            .iter()
            .find(|(name, _)| *name == k)
            .map(|(_, v)| v.to_string())
    }
}

#[test]
fn counts_are_on_unless_turned_off_or_the_environment_asks_not_to_be_tracked() {
    assert!(enabled(env(&[])));
    assert!(enabled(env(&[("COMMITSCAPE_TELEMETRY", "1")])));
    assert!(enabled(env(&[("DO_NOT_TRACK", "0")])));
    for off in ["0", "false", "OFF", " no "] {
        assert!(!enabled(env(&[("COMMITSCAPE_TELEMETRY", off)])), "{off}");
    }
    for asked in ["1", "true", "YES"] {
        assert!(!enabled(env(&[("DO_NOT_TRACK", asked)])), "{asked}");
    }
}

#[test]
fn an_install_keeps_one_random_id_and_ignores_a_file_that_is_not_one() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("nested").join("telemetry-id");
    assert_eq!(read_id(&path), None);
    let id = new_id(&path).expect("an id is written");
    assert_eq!(id.len(), 32);
    assert_eq!(read_id(&path).as_deref(), Some(id.as_str()));
    std::fs::write(&path, "alice@example.com").expect("written");
    assert_eq!(read_id(&path), None);
}

#[test]
fn a_run_sends_the_command_the_platform_and_how_it_went_and_nothing_else() {
    let run = Run {
        command: "share",
        started: Instant::now(),
        id: "0123456789abcdef0123456789abcdef".into(),
        first: true,
    };
    let sent = payload(&run, false, 12.345, true, false);
    let keys: Vec<&str> = sent
        .as_object()
        .expect("an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "arch", "ci", "command", "first", "id", "os", "outcome", "seconds", "terminal",
            "version"
        ]
    );
    assert_eq!(sent.get("command"), Some(&serde_json::json!("share")));
    assert_eq!(sent.get("outcome"), Some(&serde_json::json!("error")));
    assert_eq!(sent.get("seconds"), Some(&serde_json::json!(12.3)));
    assert_eq!(
        sent.get("version"),
        Some(&serde_json::json!(env!("CARGO_PKG_VERSION")))
    );
}

#[test]
fn the_notice_says_how_to_turn_counts_off() {
    let said = notice("https://app.commitscape.com");
    assert!(said.contains("COMMITSCAPE_TELEMETRY=0"));
    assert!(said.contains("https://app.commitscape.com/privacy#command"));
}
