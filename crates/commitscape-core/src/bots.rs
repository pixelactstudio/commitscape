//! Automation accounts, recognised the same way wherever people are counted:
//! a commit's author (`commitscape-index`) and an issue's first answer
//! (`commitscape-forge`), so a bot's reply is never the project answering.

/// Automation accounts that carry no `[bot]` suffix, by name, login or
/// address, lowercased.
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

/// Whether a GitHub login or a git name is an automation account's by its
/// shape: a `[bot]` or `-bot` suffix, or one of [`AUTOMATION`].
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
