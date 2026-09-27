#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Code,
    Dependencies,
    Test,
    Docs,
    Ci,
}

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

pub fn role_of(path: &[u8]) -> Role {
    let (dirs, name) = match path.iter().rposition(|&b| b == b'/') {
        Some(i) => (
            path.get(..i).unwrap_or_default(),
            path.get(i + 1..).unwrap_or_default(),
        ),
        None => (&[][..], path),
    };
    let is = |a: &[u8], b: &str| a.eq_ignore_ascii_case(b.as_bytes());
    let starts =
        |a: &[u8], b: &str| a.len() >= b.len() && is(a.get(..b.len()).unwrap_or_default(), b);
    let ends = |a: &[u8], b: &str| {
        a.len() >= b.len() && is(a.get(a.len() - b.len()..).unwrap_or_default(), b)
    };
    let contains = |a: &[u8], b: &str| a.windows(b.len().max(1)).any(|w| is(w, b));
    if DEPENDENCY_FILES.iter().any(|f| is(name, f))
        || starts(name, "requirements") && ends(name, ".txt")
    {
        return Role::Dependencies;
    }
    let in_dir = |names: &[&str]| {
        dirs.split(|&b| b == b'/')
            .any(|d| names.iter().any(|n| is(d, n)))
    };
    if starts(path, ".github/workflows/")
        || starts(path, ".circleci/")
        || starts(path, ".buildkite/")
        || [
            ".gitlab-ci.yml",
            ".travis.yml",
            "azure-pipelines.yml",
            "jenkinsfile",
        ]
        .iter()
        .any(|f| is(name, f))
    {
        return Role::Ci;
    }
    if in_dir(&[
        "test",
        "tests",
        "__tests__",
        "spec",
        "specs",
        "e2e",
        "testdata",
    ]) || contains(name, ".test.")
        || contains(name, ".spec.")
        || contains(name, "_test.")
        || starts(name, "test_")
    {
        return Role::Test;
    }
    if in_dir(&["docs", "doc", "documentation"])
        || [".md", ".mdx", ".rst", ".adoc", ".txt"]
            .iter()
            .any(|e| ends(name, e))
    {
        return Role::Docs;
    }
    Role::Code
}

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
