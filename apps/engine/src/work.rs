use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use tokio::sync::{oneshot, Semaphore};

pub struct Work {
    permits: Arc<Semaphore>,
    pool: rayon::ThreadPool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkError {
    Closed,
    Panicked(String),
}

impl std::fmt::Display for WorkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkError::Closed => write!(f, "the engine is stopping"),
            WorkError::Panicked(why) => write!(f, "the work failed: {why}"),
        }
    }
}

impl std::error::Error for WorkError {}

fn reason(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic".to_string())
}

impl Work {
    /// A pool of `threads` threads for CPU work, taking at most `threads` pieces of work at once.
    pub fn new(threads: usize) -> Result<Work, rayon::ThreadPoolBuildError> {
        let threads = threads.max(1);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("engine-cpu-{i}"))
            .build()?;
        Ok(Work {
            permits: Arc::new(Semaphore::new(threads)),
            pool,
        })
    }

    /// Runs CPU work on the pool, never on the async runtime, once a permit is free; waits for it without holding a thread, in the caller's span and Sentry hub.
    pub async fn run<T, F>(&self, f: F) -> Result<T, WorkError>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| WorkError::Closed)?;
        let (tx, rx) = oneshot::channel();
        let span = tracing::Span::current();
        let hub = sentry::Hub::current();
        self.pool.spawn(move || {
            let out = sentry::Hub::run(hub, || span.in_scope(|| catch_unwind(AssertUnwindSafe(f))));
            drop(permit);
            let _ = tx.send(out.map_err(|p| WorkError::Panicked(reason(p.as_ref()))));
        });
        rx.await.map_err(|_| WorkError::Closed)?
    }

    /// Stops taking new work.
    pub fn close(&self) {
        self.permits.close();
    }

    pub fn threads(&self) -> usize {
        self.pool.current_num_threads()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn work_runs_on_the_pool_and_comes_back() {
        let work = Work::new(2).unwrap();
        let name = work
            .run(|| std::thread::current().name().map(str::to_string))
            .await
            .unwrap();
        assert!(name.unwrap_or_default().starts_with("engine-cpu-"));
        assert_eq!(work.threads(), 2);
    }

    #[tokio::test]
    async fn a_panic_is_an_error_and_the_pool_carries_on() {
        let work = Work::new(1).unwrap();
        let failed = work.run(|| -> u8 { std::panic::panic_any("boom") }).await;
        assert_eq!(failed, Err(WorkError::Panicked("boom".into())));
        assert_eq!(work.run(|| 7).await, Ok(7));
    }

    #[tokio::test]
    async fn no_more_than_the_permits_run_at_once() {
        let work = Arc::new(Work::new(2).unwrap());
        let running = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (work, running, most) = (work.clone(), running.clone(), most.clone());
            tasks.push(tokio::spawn(async move {
                work.run(move || {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    running.fetch_sub(1, Ordering::SeqCst);
                })
                .await
            }));
        }
        for t in tasks {
            t.await.unwrap().unwrap();
        }
        assert!(most.load(Ordering::SeqCst) <= 2);
    }

    #[tokio::test]
    async fn a_closed_pool_takes_no_more_work() {
        let work = Work::new(1).unwrap();
        work.close();
        assert_eq!(work.run(|| 1).await, Err(WorkError::Closed));
    }
}
