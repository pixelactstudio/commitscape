const MOST: usize = 16;

const VARIABLE: &str = "COMMITSCAPE_THREADS";

/// How many threads to give `work` independent pieces of work: one per core, at most 16, and never more than `COMMITSCAPE_THREADS` says.
pub fn threads(work: usize) -> usize {
    let cores = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    let cap = std::env::var(VARIABLE)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(usize::MAX);
    cores.min(cap).min(MOST).min(work).max(1)
}
