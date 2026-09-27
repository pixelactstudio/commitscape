pub const AUTOMATION: &[&str] = &[
    "action@github.com",
    "allcontributors",
    "ansibot",
    "bors",
    "codecov",
    "dependabot",
    "dependabot-preview",
    "elasticsearchmachine",
    "github-actions",
    "greenkeeper",
    "imgbot",
    "mergify",
    "pre-commit-ci",
    "renovate",
    "snyk-bot",
];

pub fn is_bot_name(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    name.ends_with("[bot]") || name.ends_with("-bot") || AUTOMATION.contains(&name.as_str())
}

#[cfg(test)]
mod tests {
    use super::is_bot_name;

    #[test]
    fn bots_by_their_names() {
        for bot in [
            "dependabot[bot]",
            "facebook-github-bot",
            "react-native-bot",
            "ElasticsearchMachine",
            "bors",
        ] {
            assert!(is_bot_name(bot), "{bot}");
        }
        for person in ["alice", "robot", "talbot", "abbott", "Bot Builder"] {
            assert!(!is_bot_name(person), "{person}");
        }
    }
}
