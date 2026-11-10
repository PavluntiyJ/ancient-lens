//! Exercise the same schemas the bridge uses against actual Rust serialization.
use ancient_lens::{own_account::Observation, store::Store};
use serde_json::json;
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn public_state_and_own_events_match_the_page_contract() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path().into()).unwrap();
    let mut samples = vec![json!({"state": store.public(), "own": store.own_public()})];
    store.change("state:account", &json!({"id": "1"})).unwrap();
    store.change("note:add", &json!({"note": {"accountId":"2", "name":"Synthetic", "text":"Fixture", "matchId":1001, "heroId":1, "ally":true}})).unwrap();
    store
        .change("mmr:add", &json!({"value":3000, "expectedAccountId":"1"}))
        .unwrap();
    let mut observation = Observation::unavailable(Some("1".into()), "measured", "dota-memory");
    observation.mmr = Some(3025);
    observation.confidence = Some(100);
    observation.behavior_score = Some(10000);
    observation.communication_score = Some(10000);
    store.observe_account(observation.clone()).unwrap();
    samples.push(json!({"state": store.public(), "own": store.own_public()}));
    observation.status = "calibrating".into();
    observation.mmr = None;
    observation.confidence = Some(0);
    store.observe_account(observation).unwrap();
    samples.push(json!({"state": store.public(), "own": store.own_public()}));
    samples.push(json!({"state": store.profile_account("2").unwrap(), "own": store.own_public()}));
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let mut child = Command::new("node")
        .args([
            "--experimental-strip-types",
            "scripts/check-state-contract.mjs",
        ])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Node is required for the state contract check; run npm ci first");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&samples).unwrap().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "State IPC contract drift:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
