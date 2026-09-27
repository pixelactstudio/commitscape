use std::collections::HashMap;

use serde::Serialize;

use crate::analysis::Analysis;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Language {
    pub name: &'static str,
    pub files: u32,
    pub lines: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Languages {
    pub languages: Vec<Language>,
    pub data_files: u32,
    pub data_lines: u64,
    pub other_files: u32,
    pub other_lines: u64,
}

impl Analysis<'_> {
    pub fn languages(&self) -> Languages {
        let index = self.index();
        let mut out = Languages {
            languages: Vec::new(),
            data_files: 0,
            data_lines: 0,
            other_files: 0,
            other_lines: 0,
        };
        let mut seen: HashMap<&[u8], Written> = HashMap::new();
        for h in self.code() {
            let lines = u64::from(h.loc);
            let name = index
                .paths
                .path_name(h.path)
                .map(file_name)
                .unwrap_or_default();
            let written = match by_name(name) {
                Some(written) => written,
                None => match extension(name) {
                    Some(e) => *seen.entry(e).or_insert_with(|| by_extension(e)),
                    None => Written::Unknown,
                },
            };
            match written {
                Written::Code(language) => {
                    match out.languages.iter_mut().find(|l| l.name == language) {
                        Some(l) => {
                            l.files += 1;
                            l.lines += lines;
                        }
                        None => out.languages.push(Language {
                            name: language,
                            files: 1,
                            lines,
                        }),
                    }
                }
                Written::Data => {
                    out.data_files += 1;
                    out.data_lines += lines;
                }
                Written::Unknown => {
                    out.other_files += 1;
                    out.other_lines += lines;
                }
            }
        }
        out.languages
            .sort_by(|a, b| b.lines.cmp(&a.lines).then(a.name.cmp(b.name)));
        out
    }
}

#[derive(Clone, Copy)]
enum Written {
    Code(&'static str),
    Data,
    Unknown,
}

fn file_name(path: &[u8]) -> &[u8] {
    match path.iter().rposition(|&b| b == b'/') {
        Some(i) => path.get(i + 1..).unwrap_or_default(),
        None => path,
    }
}

pub(crate) fn language_of(path: &[u8]) -> Option<&'static str> {
    let name = path.rsplit(|&b| b == b'/').next().unwrap_or(path);
    let written = by_name(name).or_else(|| extension(name).map(by_extension))?;
    match written {
        Written::Code(language) => Some(language),
        _ => None,
    }
}

fn by_name(name: &[u8]) -> Option<Written> {
    if let Some(&(_, language)) = BY_NAME.iter().find(|(n, _)| n.as_bytes() == name) {
        return Some(Written::Code(language));
    }
    (name.starts_with(b"Dockerfile.") || name.starts_with(b"Containerfile."))
        .then_some(Written::Code("Dockerfile"))
}

fn extension(name: &[u8]) -> Option<&[u8]> {
    let dot = name.iter().rposition(|&b| b == b'.')?;
    name.get(dot + 1..)
}

fn by_extension(extension: &[u8]) -> Written {
    if DATA
        .iter()
        .any(|e| e.as_bytes().eq_ignore_ascii_case(extension))
    {
        return Written::Data;
    }
    match BY_EXTENSION
        .iter()
        .find(|(e, _)| e.as_bytes().eq_ignore_ascii_case(extension))
    {
        Some(&(_, language)) => Written::Code(language),
        None => Written::Unknown,
    }
}

const BY_NAME: &[(&str, &str)] = &[
    ("Dockerfile", "Dockerfile"),
    ("Containerfile", "Dockerfile"),
    ("Makefile", "Makefile"),
    ("makefile", "Makefile"),
    ("GNUmakefile", "Makefile"),
    ("CMakeLists.txt", "CMake"),
    ("Justfile", "Just"),
    ("justfile", "Just"),
    ("Rakefile", "Ruby"),
    ("Gemfile", "Ruby"),
    ("Brewfile", "Ruby"),
    ("Podfile", "Ruby"),
    ("Vagrantfile", "Ruby"),
    ("Jenkinsfile", "Groovy"),
    ("BUILD", "Starlark"),
    ("BUILD.bazel", "Starlark"),
    ("WORKSPACE", "Starlark"),
];

const DATA: &[&str] = &[
    "json",
    "jsonc",
    "json5",
    "jsonl",
    "yaml",
    "yml",
    "toml",
    "xml",
    "csv",
    "tsv",
    "ini",
    "cfg",
    "conf",
    "properties",
    "env",
    "plist",
    "svg",
];

const BY_EXTENSION: &[(&str, &str)] = &[
    ("rs", "Rust"),
    ("ts", "TypeScript"),
    ("tsx", "TypeScript"),
    ("mts", "TypeScript"),
    ("cts", "TypeScript"),
    ("js", "JavaScript"),
    ("jsx", "JavaScript"),
    ("mjs", "JavaScript"),
    ("cjs", "JavaScript"),
    ("py", "Python"),
    ("pyi", "Python"),
    ("go", "Go"),
    ("java", "Java"),
    ("kt", "Kotlin"),
    ("kts", "Kotlin"),
    ("swift", "Swift"),
    ("c", "C"),
    ("h", "C"),
    ("cc", "C++"),
    ("cpp", "C++"),
    ("cxx", "C++"),
    ("hpp", "C++"),
    ("hh", "C++"),
    ("hxx", "C++"),
    ("cs", "C#"),
    ("fs", "F#"),
    ("fsx", "F#"),
    ("vb", "Visual Basic"),
    ("rb", "Ruby"),
    ("php", "PHP"),
    ("scala", "Scala"),
    ("groovy", "Groovy"),
    ("gradle", "Groovy"),
    ("sh", "Shell"),
    ("bash", "Shell"),
    ("zsh", "Shell"),
    ("fish", "Shell"),
    ("ps1", "PowerShell"),
    ("bat", "Batchfile"),
    ("cmd", "Batchfile"),
    ("lua", "Lua"),
    ("r", "R"),
    ("m", "Objective-C"),
    ("mm", "Objective-C++"),
    ("dart", "Dart"),
    ("ex", "Elixir"),
    ("exs", "Elixir"),
    ("erl", "Erlang"),
    ("hrl", "Erlang"),
    ("hs", "Haskell"),
    ("ml", "OCaml"),
    ("mli", "OCaml"),
    ("clj", "Clojure"),
    ("cljs", "Clojure"),
    ("cljc", "Clojure"),
    ("elm", "Elm"),
    ("purs", "PureScript"),
    ("gleam", "Gleam"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("astro", "Astro"),
    ("html", "HTML"),
    ("htm", "HTML"),
    ("css", "CSS"),
    ("scss", "SCSS"),
    ("sass", "Sass"),
    ("less", "Less"),
    ("sql", "SQL"),
    ("prisma", "Prisma"),
    ("graphql", "GraphQL"),
    ("gql", "GraphQL"),
    ("proto", "Protocol Buffers"),
    ("nix", "Nix"),
    ("zig", "Zig"),
    ("nim", "Nim"),
    ("jl", "Julia"),
    ("pl", "Perl"),
    ("pm", "Perl"),
    ("tf", "HCL"),
    ("hcl", "HCL"),
    ("cmake", "CMake"),
    ("mk", "Makefile"),
    ("sol", "Solidity"),
    ("sv", "SystemVerilog"),
    ("vhd", "VHDL"),
    ("vhdl", "VHDL"),
    ("asm", "Assembly"),
    ("s", "Assembly"),
    ("cu", "CUDA"),
    ("glsl", "GLSL"),
    ("hlsl", "HLSL"),
    ("wgsl", "WGSL"),
    ("metal", "Metal"),
    ("mdx", "MDX"),
    ("tex", "TeX"),
    ("ipynb", "Jupyter Notebook"),
    ("gd", "GDScript"),
    ("cr", "Crystal"),
    ("rkt", "Racket"),
    ("scm", "Scheme"),
    ("lisp", "Common Lisp"),
    ("el", "Emacs Lisp"),
    ("vim", "Vim Script"),
    ("hx", "Haxe"),
    ("pas", "Pascal"),
    ("f90", "Fortran"),
    ("ada", "Ada"),
    ("odin", "Odin"),
    ("mojo", "Mojo"),
    ("typ", "Typst"),
    ("bzl", "Starlark"),
    ("star", "Starlark"),
];
