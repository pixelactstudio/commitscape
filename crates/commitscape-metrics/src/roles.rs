//! What a file is for, judged from its path alone: dependency manifests and
//! lockfiles, tests, documentation and CI configuration. Everything else is
//! code.
//!
//! Paths, not contents, so a file deleted long ago still has a role, and no
//! blob is read (ADR-0004).

/// What a file is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Code,
    /// A dependency manifest or lockfile: `package.json`, `Cargo.lock`.
    Dependencies,
    Test,
    Docs,
    /// Build and CI configuration run by a service: `.github/workflows/`.
    Ci,
}

/// Dependency manifests and lockfiles, by file name.
const DEPENDENCY_FILES: &[&str] = &[
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "deno.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
    "go.work",
    "go.work.sum",
    "gemfile",
    "gemfile.lock",
    "pyproject.toml",
    "poetry.lock",
    "pipfile",
    "pipfile.lock",
    "uv.lock",
    "requirements.txt",
    "composer.json",
    "composer.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "gradle.lockfile",
    "mix.exs",
    "mix.lock",
    "pubspec.yaml",
    "pubspec.lock",
    "package.swift",
    "package.resolved",
    "podfile",
    "podfile.lock",
    "flake.lock",
];

/// The role of the file at `path`.
pub fn role_of(path: &[u8]) -> Role {
    let path = String::from_utf8_lossy(path).to_ascii_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    if DEPENDENCY_FILES.contains(&name)
        || name.starts_with("requirements") && name.ends_with(".txt")
    {
        return Role::Dependencies;
    }
    let dirs: Vec<&str> = path.split('/').collect();
    let in_dir = |names: &[&str]| {
        dirs.iter()
            .take(dirs.len().saturating_sub(1))
            .any(|d| names.contains(d))
    };
    if path.starts_with(".github/workflows/")
        || path.starts_with(".circleci/")
        || path.starts_with(".buildkite/")
        || name == ".gitlab-ci.yml"
        || name == ".travis.yml"
        || name == "azure-pipelines.yml"
        || name == "jenkinsfile"
    {
        return Role::Ci;
    }
    let stem = name.split('.').next().unwrap_or(name);
    if in_dir(&[
        "test",
        "tests",
        "__tests__",
        "spec",
        "specs",
        "e2e",
        "testdata",
    ]) || name.contains(".test.")
        || name.contains(".spec.")
        || name.contains("_test.")
        || stem.starts_with("test_")
    {
        return Role::Test;
    }
    let prose = [".md", ".mdx", ".rst", ".adoc", ".txt"]
        .iter()
        .any(|e| name.ends_with(e));
    if in_dir(&["docs", "doc", "documentation"]) || prose {
        return Role::Docs;
    }
    Role::Code
}
