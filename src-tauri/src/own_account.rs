//! Local account/rating observations; no network, injection or game function calls.
#[cfg(windows)]
mod layout;
#[cfg(target_os = "linux")]
mod layout_linux;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;
#[cfg(target_os = "linux")]
pub(crate) use linux::launch_account;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
pub(crate) use windows::processes;

/// How long a confirmed rating survives re-confirmation or a transient read gap.
#[cfg(any(windows, target_os = "linux"))]
pub(crate) const HOLD: std::time::Duration = std::time::Duration::from_secs(30);
#[cfg(any(windows, target_os = "linux"))]
pub(crate) type Sample = (u32, u32, u32, u32);

#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn measured(mut observation: Observation, sample: Sample) -> Observation {
    observation.source = "dota-memory".into();
    observation.confidence = Some(sample.1);
    observation.mmr = (sample.1 >= 30 && sample.0 > 0).then_some(sample.0);
    observation.behavior_score = Some(sample.2);
    observation.communication_score = Some(sample.3);
    observation.status = if observation.mmr.is_some() {
        "measured"
    } else {
        "calibrating"
    }
    .into();
    observation
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub account_id: Option<String>,
    pub status: String,
    pub source: String,
    pub observed_at: String,
    pub mmr: Option<u32>,
    pub confidence: Option<u32>,
    pub behavior_score: Option<u32>,
    pub communication_score: Option<u32>,
}
impl Observation {
    pub fn unavailable(account_id: Option<String>, status: &str, source: &str) -> Self {
        Self {
            account_id,
            status: status.into(),
            source: source.into(),
            observed_at: crate::store::now(),
            mmr: None,
            confidence: None,
            behavior_score: None,
            communication_score: None,
        }
    }
}

#[derive(Default)]
pub struct Reader {
    #[cfg(windows)]
    native: windows::Reader,
    #[cfg(target_os = "linux")]
    native: linux::Reader,
}
impl Reader {
    /// `memory`: the user allowed reading Dota memory (the shared reader setting).
    pub fn poll(&mut self, live: &serde_json::Value, memory: bool) -> Observation {
        #[cfg(any(windows, target_os = "linux"))]
        {
            self.native.poll(live, memory)
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = memory;
            Observation::unavailable(fresh_self(live), "unsupported", "gsi")
        }
    }
}

pub fn fresh_self(live: &serde_json::Value) -> Option<String> {
    let age = chrono::Utc::now()
        .timestamp_millis()
        .checked_sub(live["receivedAt"].as_i64()?)?;
    if !(0..15_000).contains(&age) || live["status"] != "connected" || live["mode"] != "player" {
        return None;
    }
    // Never infer the local account from a spectator roster.
    let id = live["accountId"].as_str().or_else(|| {
        live["players"]
            .as_array()?
            .iter()
            .find(|p| p["key"] == "self")?["accountId"]
            .as_str()
    })?;
    crate::store::account_id(id).ok()
}

/// Reconstructed from the client's confidence code on the verified build (docs/dev/native-reader.md).
/// Keep the float32 time correction separate from the double polynomial.
pub fn confidence(raw: i32, sampled_at: i32, game_time: i32) -> Option<u32> {
    if !(0..=3000).contains(&raw) || sampled_at < 0 || game_time <= 0 {
        return None;
    }
    let elapsed = game_time.saturating_sub(sampled_at).max(0);
    let x = if sampled_at != 0 && elapsed > 0 {
        let q = ((elapsed as f32 / 86400.0) * 0.3_f32) / 80.0;
        let square = (250.0_f32.powi(2) - 90.0_f32.powi(2)) * q + (raw as f32).powi(2);
        ((square.sqrt() + 0.5) as i32).clamp(90, 3000)
    } else {
        raw
    } as f64;
    let (p, min, max) = if x <= 165.0 {
        ((0.0056 * x) * x - 2.55 * x + 286.56, 18, 100)
    } else if x <= 240.0 {
        ((0.0016 * x) * x - 0.8022 * x + 107.78, 7, 18)
    } else if x <= 820.0 {
        ((0.0000165 * x) * x - 0.0283 * x + 12.6, 1, 7)
    } else {
        return Some(0);
    };
    Some(((p as f32).round() as u32).clamp(min, max))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observed_windows_sample_and_boundaries() {
        assert_eq!(confidence(110, 1790882905, 1791973595), Some(60));
        assert_eq!(confidence(110, 0, 1791973595), Some(74));
        assert_eq!(confidence(165, 0, 1), Some(18));
        assert_eq!(confidence(240, 0, 1), Some(7));
        assert_eq!(confidence(820, 0, 1), Some(1));
        assert_eq!(confidence(821, 0, 1), Some(0));
        assert_eq!(confidence(-1, 0, 1), None);
    }
    #[test]
    fn identity_requires_fresh_own_data() {
        let mut v = serde_json::json!({"status":"connected","mode":"player","receivedAt":chrono::Utc::now().timestamp_millis(),"accountId":"123"});
        assert_eq!(fresh_self(&v).as_deref(), Some("123"));
        v["mode"] = serde_json::json!("spectator");
        assert_eq!(fresh_self(&v), None);
        v["mode"] = serde_json::json!("player");
        v["receivedAt"] = serde_json::json!(0);
        assert_eq!(fresh_self(&v), None);
        // A packet without a player block, as in the main menu, cannot identify the account.
        let menu = crate::gsi::normalize(
            &serde_json::json!({"auth":{"token":"test"},"provider":{"appid":570},"map":{"game_state":"DOTA_GAMERULES_STATE_INIT"}}),
            "test",
        )
        .unwrap();
        assert_eq!(fresh_self(&menu), None);
        let in_game = crate::gsi::normalize(
            &serde_json::json!({"auth":{"token":"test"},"provider":{"appid":570},"player":{"steamid":"76561198083722517","team_name":"radiant"}}),
            "test",
        )
        .unwrap();
        assert_eq!(fresh_self(&in_game).as_deref(), Some("123456789"));
    }
}
