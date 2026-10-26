const EXTENSIONS: &[(&str, &str)] = &[
    ("ts", "typescript"),
    ("mts", "typescript"),
    ("cts", "typescript"),
    ("tsx", "tsx"),
    ("js", "javascript"),
    ("mjs", "javascript"),
    ("cjs", "javascript"),
    ("jsx", "jsx"),
    ("json", "json"),
    ("jsonc", "jsonc"),
    ("json5", "json5"),
    ("md", "markdown"),
    ("mdx", "mdx"),
    ("rs", "rust"),
    ("py", "python"),
    ("pyi", "python"),
    ("go", "go"),
    ("java", "java"),
    ("kt", "kotlin"),
    ("kts", "kotlin"),
    ("swift", "swift"),
    ("c", "c"),
    ("h", "c"),
    ("cc", "cpp"),
    ("cpp", "cpp"),
    ("cxx", "cpp"),
    ("hpp", "cpp"),
    ("hh", "cpp"),
    ("cs", "csharp"),
    ("rb", "ruby"),
    ("php", "php"),
    ("sh", "bash"),
    ("bash", "bash"),
    ("zsh", "bash"),
    ("fish", "fish"),
    ("ps1", "powershell"),
    ("css", "css"),
    ("scss", "scss"),
    ("sass", "sass"),
    ("less", "less"),
    ("html", "html"),
    ("htm", "html"),
    ("vue", "vue"),
    ("svelte", "svelte"),
    ("astro", "astro"),
    ("yml", "yaml"),
    ("yaml", "yaml"),
    ("toml", "toml"),
    ("xml", "xml"),
    ("svg", "xml"),
    ("sql", "sql"),
    ("graphql", "graphql"),
    ("gql", "graphql"),
    ("proto", "proto"),
    ("dockerfile", "docker"),
    ("lua", "lua"),
    ("pl", "perl"),
    ("r", "r"),
    ("scala", "scala"),
    ("dart", "dart"),
    ("ex", "elixir"),
    ("exs", "elixir"),
    ("erl", "erlang"),
    ("hs", "haskell"),
    ("clj", "clojure"),
    ("ml", "ocaml"),
    ("nix", "nix"),
    ("zig", "zig"),
    ("tf", "hcl"),
    ("hcl", "hcl"),
    ("cmake", "cmake"),
    ("make", "make"),
    ("mk", "make"),
    ("ini", "ini"),
    ("cfg", "ini"),
    ("conf", "ini"),
    ("diff", "diff"),
    ("patch", "diff"),
    ("tex", "latex"),
    ("vim", "viml"),
    ("el", "emacs-lisp"),
    ("lisp", "lisp"),
    ("jl", "julia"),
    ("m", "objective-c"),
    ("mm", "objective-cpp"),
    ("sol", "solidity"),
    ("wasm", "wasm"),
    ("txt", "text"),
    ("csv", "csv"),
    ("lock", "text"),
];

const NAMES: &[(&str, &str)] = &[
    ("dockerfile", "docker"),
    ("makefile", "make"),
    ("gnumakefile", "make"),
    ("cmakelists", "cmake"),
    ("gemfile", "ruby"),
    ("rakefile", "ruby"),
    ("justfile", "make"),
    (".gitignore", "ini"),
    (".env", "ini"),
    (".editorconfig", "ini"),
    (".npmrc", "ini"),
    (".gitattributes", "ini"),
    ("cargo.lock", "toml"),
    ("go.mod", "go"),
    ("go.sum", "text"),
    ("license", "text"),
    ("readme", "markdown"),
    ("codeowners", "text"),
];

const BINARY: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff", "psd", "heic", "pdf",
    "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war", "woff", "woff2", "ttf",
    "otf", "eot", "mp3", "mp4", "mov", "avi", "mkv", "webm", "wav", "ogg", "flac", "m4a", "exe",
    "dll", "so", "dylib", "a", "o", "obj", "class", "pyc", "wasm", "bin", "dat", "db", "sqlite",
    "pack", "idx", "node", "iso", "dmg",
];

fn by_extension(ext: &str) -> Option<&'static str> {
    EXTENSIONS.iter().find(|(k, _)| *k == ext).map(|(_, v)| *v)
}

fn by_name(name: &str) -> Option<&'static str> {
    if name.is_empty() {
        return None;
    }
    NAMES.iter().find(|(k, _)| *k == name).map(|(_, v)| *v)
}

fn name_of(path: &str) -> &str {
    path.rfind('/')
        .map_or(path, |at| path.get(at + 1..).unwrap_or(""))
}

/// A file's extension as the Code window reads it: after the last dot of its name, lower case, none for a name that starts with its only dot.
pub fn extension_of(path: &str) -> String {
    let name = name_of(path);
    match name.rfind('.') {
        Some(dot) if dot > 0 => name.get(dot + 1..).unwrap_or("").to_lowercase(),
        _ => String::new(),
    }
}

/// The language a file is highlighted as, by its name or extension; "text" when none is known.
pub fn language_of(path: &str) -> &'static str {
    let name = name_of(path).to_lowercase();
    let stem = match name.rfind('.') {
        Some(dot) if dot + 1 < name.len() => name.get(..dot).unwrap_or(""),
        _ => name.as_str(),
    };
    by_name(&name)
        .or_else(|| by_name(stem))
        .or_else(|| by_extension(&extension_of(path)))
        .unwrap_or("text")
}

/// Whether a file's extension says it is not text.
pub fn is_binary_path(path: &str) -> bool {
    let ext = extension_of(path);
    !ext.is_empty() && BINARY.contains(&ext.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_come_from_the_name_then_the_extension() {
        assert_eq!(language_of("src/App.TSX"), "tsx");
        assert_eq!(language_of("Dockerfile"), "docker");
        assert_eq!(language_of("docs/Makefile.am"), "make");
        assert_eq!(language_of("Cargo.lock"), "toml");
        assert_eq!(language_of("yarn.lock"), "text");
        assert_eq!(language_of(".bashrc"), "text");
        assert_eq!(language_of("weird."), "text");
        assert_eq!(language_of("src/constructor.js"), "javascript");
        assert_eq!(language_of("__proto__"), "text");
    }

    #[test]
    fn binary_paths_go_by_extension() {
        assert!(is_binary_path("logo.PNG"));
        assert!(!is_binary_path("png"));
        assert!(!is_binary_path(".png"));
        assert!(!is_binary_path("a.svg"));
    }
}
