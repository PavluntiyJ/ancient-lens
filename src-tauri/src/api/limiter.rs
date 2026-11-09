//! Pacing and pausing for one provider, so a third provider does not copy them again.
use crate::store::Result;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Notify};

/// Requests to one provider leave at least `interval` apart. A pause refuses new requests
/// with its message until it ends, and also ends the wait of requests already queued.
/// Each provider has its own, so a failing one never blocks another.
pub(crate) struct Limiter {
    interval: Duration,
    pub(super) next: Mutex<Instant>,
    pub(super) cooldown: Mutex<Instant>,
    pub(super) issue: Mutex<String>,
    paused: Notify,
}

impl Limiter {
    pub fn new(interval: Duration) -> Self {
        Limiter {
            interval,
            next: Mutex::new(Instant::now()),
            cooldown: Mutex::new(Instant::now()),
            issue: Mutex::new(String::new()),
            paused: Notify::new(),
        }
    }

    /// Waits for this request's turn. Fails with the pause message while paused, including
    /// when a pause starts during the wait.
    pub async fn wait(&self) -> Result<()> {
        self.refuse_while_paused().await?;
        let when = {
            let mut next = self.next.lock().await;
            let when = (*next).max(Instant::now());
            *next = when + self.interval;
            when
        };
        tokio::select! { _ = tokio::time::sleep_until(when.into()) => {}, _ = self.paused.notified() => {} }
        self.refuse_while_paused().await
    }

    /// Refuses new requests for `seconds` with `message`, and wakes queued ones to fail.
    pub async fn pause(&self, seconds: u64, message: &str) {
        *self.issue.lock().await = message.into();
        *self.cooldown.lock().await = Instant::now() + Duration::from_secs(seconds);
        *self.next.lock().await = Instant::now();
        self.paused.notify_waiters();
    }

    async fn refuse_while_paused(&self) -> Result<()> {
        if Instant::now() < *self.cooldown.lock().await {
            return Err(self.issue.lock().await.clone());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn requests_leave_one_interval_apart() {
        let limiter = Limiter::new(Duration::from_millis(80));
        let started = Instant::now();
        for _ in 0..3 {
            limiter.wait().await.unwrap();
        }
        // The first leaves at once, the next two one interval apart each.
        assert!(started.elapsed() >= Duration::from_millis(160));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn a_pause_refuses_new_requests_and_ends_queued_waits() {
        let limiter = Arc::new(Limiter::new(Duration::from_secs(30)));
        limiter.wait().await.unwrap();
        // This one is queued for 30 seconds.
        let queued = tokio::spawn({
            let limiter = limiter.clone();
            async move { limiter.wait().await }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        limiter.pause(60, "provider down").await;
        let result = tokio::time::timeout(Duration::from_secs(2), queued)
            .await
            .expect("the pause wakes the queued request")
            .unwrap();
        assert_eq!(result.unwrap_err(), "provider down");
        assert_eq!(limiter.wait().await.unwrap_err(), "provider down");
    }

    #[tokio::test]
    async fn after_a_pause_requests_leave_again() {
        let limiter = Limiter::new(Duration::from_millis(10));
        limiter.pause(0, "brief").await;
        limiter.wait().await.unwrap();
    }
}
