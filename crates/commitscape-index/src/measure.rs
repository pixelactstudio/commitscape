//! The Complexity Proxy: the indentation structure of a file at HEAD.
//!
//! Language-agnostic by design. Nesting shows up as indentation in nearly
//! every language people write, so summing indentation levels across a file
//! approximates how much nested logic it holds without parsing anything.
//!
//! Levels, not whitespace characters. Each file's indentation unit is
//! detected: a tab, or the most common step between consecutive lines when it
//! is indented with spaces. A tab-indented file and a two-space file with the
//! same structure therefore score the same; otherwise a hotspot ranking in a
//! polyglot repository would partly rank indentation conventions.

/// What the Complexity Proxy measured in one file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measure {
    /// Every line, blank or not.
    pub loc: u32,
    /// Sum of indentation levels across non-blank lines.
    pub indent_levels: u32,
    /// Mean indentation level per non-blank line.
    pub indent_mean: f32,
    /// Population standard deviation of indentation levels.
    pub indent_stddev: f32,
}

/// The unit a file is indented in, when nothing better can be inferred.
const DEFAULT_SPACES: u32 = 4;

/// Measures a text file's contents.
pub fn measure(contents: &[u8]) -> Measure {
    let lines: Vec<&[u8]> = split_lines(contents);
    let widths: Vec<Option<Indent>> = lines.iter().map(|l| indent(l)).collect();

    let tabbed = widths.iter().flatten().filter(|i| i.tabs > 0).count();
    let spaced = widths
        .iter()
        .flatten()
        .filter(|i| i.tabs == 0 && i.spaces > 0)
        .count();
    let unit = if tabbed >= spaced && tabbed > 0 {
        Unit::Tab
    } else {
        Unit::Spaces(space_unit(&widths))
    };

    let levels: Vec<u32> = widths
        .iter()
        .flatten()
        .map(|i| match unit {
            // Alignment spaces after tabs are not nesting.
            Unit::Tab => i.tabs,
            Unit::Spaces(n) => (i.tabs * DEFAULT_SPACES + i.spaces) / n,
        })
        .collect();

    let total: u32 = levels.iter().sum();
    let n = levels.len() as f32;
    let mean = if levels.is_empty() {
        0.0
    } else {
        total as f32 / n
    };
    let variance = if levels.is_empty() {
        0.0
    } else {
        levels
            .iter()
            .map(|&l| (l as f32 - mean).powi(2))
            .sum::<f32>()
            / n
    };
    Measure {
        loc: lines.len() as u32,
        indent_levels: total,
        indent_mean: mean,
        indent_stddev: variance.sqrt(),
    }
}

/// Lines without their terminators. A final newline does not start another
/// line.
fn split_lines(contents: &[u8]) -> Vec<&[u8]> {
    if contents.is_empty() {
        return Vec::new();
    }
    let body = contents.strip_suffix(b"\n").unwrap_or(contents);
    body.split(|&b| b == b'\n')
        .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct Indent {
    tabs: u32,
    spaces: u32,
}

enum Unit {
    Tab,
    Spaces(u32),
}

/// The leading whitespace of a line, or `None` for a blank one.
fn indent(line: &[u8]) -> Option<Indent> {
    let mut tabs = 0;
    let mut spaces = 0;
    for &b in line {
        match b {
            b'\t' if spaces == 0 => tabs += 1,
            b'\t' => spaces += DEFAULT_SPACES,
            b' ' => spaces += 1,
            b'\r' | b'\x0c' | b'\x0b' => {}
            _ => return Some(Indent { tabs, spaces }),
        }
    }
    None
}

/// The most common increase in indentation between consecutive non-blank
/// lines of a space-indented file. Ties go to the smaller step.
fn space_unit(widths: &[Option<Indent>]) -> u32 {
    let mut counts = [0u32; 9];
    let mut previous = None;
    for w in widths.iter().flatten() {
        let width = w.tabs * DEFAULT_SPACES + w.spaces;
        if let Some(p) = previous {
            if width > p {
                let step = (width - p) as usize;
                if let Some(c) = counts.get_mut(step) {
                    *c += 1;
                }
            }
        }
        previous = Some(width);
    }
    counts
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, &c)| c > 0)
        .max_by_key(|(step, &c)| (c, std::cmp::Reverse(*step)))
        .map(|(step, _)| step as u32)
        .unwrap_or(DEFAULT_SPACES)
}

#[cfg(test)]
mod tests {
    use super::*;

    // One function with an `if` inside: levels 0, 1, 2, 1, 0. Sum 4 over 5
    // non-blank lines, mean 0.8.
    const TWO_SPACES: &str = "fn a() {\n  if x {\n    y();\n  }\n}\n";
    const FOUR_SPACES: &str = "fn a() {\n    if x {\n        y();\n    }\n}\n";
    const TABS: &str = "fn a() {\n\tif x {\n\t\ty();\n\t}\n}\n";

    #[test]
    fn the_same_structure_scores_the_same_in_any_indentation_style() {
        for text in [TWO_SPACES, FOUR_SPACES, TABS] {
            let m = measure(text.as_bytes());
            assert_eq!(m.indent_levels, 4, "{text:?}");
            assert_eq!(m.loc, 5);
            assert!((m.indent_mean - 0.8).abs() < 1e-6);
        }
    }

    #[test]
    fn blank_lines_count_as_lines_but_not_as_indentation() {
        let m = measure(b"a\n\n  \n  b\n");
        assert_eq!(m.loc, 4);
        // Only `a` (0) and `b` (1, a two-space unit) are non-blank.
        assert_eq!(m.indent_levels, 1);
        assert!((m.indent_mean - 0.5).abs() < 1e-6);
        assert!((m.indent_stddev - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_flat_file_has_no_indentation() {
        let m = measure(b"one\ntwo\nthree");
        assert_eq!(m.loc, 3, "no final newline is still three lines");
        assert_eq!(m.indent_levels, 0);
        assert_eq!(m.indent_stddev, 0.0);
    }

    #[test]
    fn alignment_after_tabs_is_not_nesting() {
        // Two tabs then three alignment spaces: still level 2.
        let m = measure(b"a(\n\t\t   b\n");
        assert_eq!(m.indent_levels, 2);
    }

    #[test]
    fn windows_line_endings_are_lines_too() {
        assert_eq!(measure(b"a\r\n  b\r\n").loc, 2);
    }

    #[test]
    fn an_empty_file_is_empty() {
        let m = measure(b"");
        assert_eq!((m.loc, m.indent_levels), (0, 0));
    }
}
