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

/// Lockfiles, which a tool writes: every change to one is a regeneration.
pub fn is_lockfile(path: &[u8]) -> bool {
    let path = String::from_utf8_lossy(path).to_ascii_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    name.ends_with(".lock")
        || name.ends_with(".lockb")
        || name.ends_with("-lock.json")
        || name.ends_with("-lock.yaml")
        || name.ends_with(".lockfile")
        || matches!(
            name,
            "npm-shrinkwrap.json" | "go.sum" | "go.work.sum" | "package.resolved"
        )
}

/// Whether a path looks like something a tool wrote, judged from the path
/// alone: for files no longer at HEAD, whose contents were never
/// classified. Build output, vendored trees, minified files, source maps and
/// files that say they are generated.
pub fn looks_generated(path: &[u8]) -> bool {
    let path = String::from_utf8_lossy(path).to_ascii_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    let dirs = path.split('/').take(path.matches('/').count());
    let in_dir = dirs.into_iter().any(|d| {
        matches!(
            d,
            "node_modules" | "vendor" | "third_party" | "dist" | ".next" | "__snapshots__"
        )
    });
    in_dir
        || name.contains(".min.")
        || name.ends_with(".map")
        || name.contains(".generated.")
        || name.contains(".gen.")
        || name.ends_with(".snap")
        || name.ends_with(".pb.go")
}
