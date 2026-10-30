use rand::RngCore;
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
/// Keyboard shortcuts of this app. The two global ones, `global` for the match window and
/// `profile` for the profile window, are bound by the operating system or the desktop portal;
/// the others are read by the page itself on both platforms.
pub const SHORTCUT_NAMES: [&str; 8] = [
    "global",
    "profile",
    "leftPrevious",
    "leftNext",
    "rightPrevious",
    "rightNext",
    "lanePrevious",
    "laneNext",
];
pub fn default_shortcuts() -> Value {
    json!({
        "global": "Alt+Numpad5",
        "profile": "Alt+Numpad6",
        "leftPrevious": "Alt+ArrowLeft",
        "leftNext": "Alt+ArrowRight",
        "rightPrevious": "Shift+ArrowLeft",
        "rightNext": "Shift+ArrowRight",
        "lanePrevious": "Alt+ArrowUp",
        "laneNext": "Alt+ArrowDown",
    })
}
fn shortcut_modifier(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some("Ctrl"),
        "alt" => Some("Alt"),
        "shift" => Some("Shift"),
        _ => None,
    }
}
fn shortcut_key(token: &str) -> Option<String> {
    let upper = token.to_ascii_uppercase();
    // The canonical form the settings page records ("KeyP", "Digit1") is accepted as typed.
    let upper = match (upper.strip_prefix("KEY"), upper.strip_prefix("DIGIT")) {
        (Some(rest), _) if rest.len() == 1 && rest.as_bytes()[0].is_ascii_alphabetic() => {
            rest.to_owned()
        }
        (_, Some(rest)) if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() => {
            rest.to_owned()
        }
        _ => upper,
    };
    if upper.len() == 1 && upper.as_bytes()[0].is_ascii_alphabetic() {
        return Some(format!("Key{upper}"));
    }
    if upper.len() == 1 && upper.as_bytes()[0].is_ascii_digit() {
        return Some(format!("Digit{upper}"));
    }
    if let Some(rest) = upper
        .strip_prefix("NUMPAD")
        .or_else(|| upper.strip_prefix("NUM"))
    {
        if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() {
            return Some(format!("Numpad{rest}"));
        }
    }
    for name in ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] {
        let short = name.trim_start_matches("Arrow");
        if upper == name.to_ascii_uppercase() || upper == short.to_ascii_uppercase() {
            return Some(name.to_owned());
        }
    }
    for name in [
        "Tab", "Enter", "Space", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    ] {
        if upper == name.to_ascii_uppercase() {
            return Some(name.to_owned());
        }
    }
    if let Some(rest) = upper.strip_prefix('F') {
        if rest
            .parse::<u8>()
            .is_ok_and(|value| (1..=12).contains(&value))
        {
            return Some(format!("F{rest}"));
        }
    }
    None
}
/// Canonical `Ctrl+Alt+Shift+Code` form, or `None` when the combination cannot be a
/// shortcut: at least one modifier is required, `Escape` only cancels recording, and
/// `Super`/`Meta` stay out because Windows reserves it for the system.
pub fn normalize_shortcut(raw: &str) -> Option<String> {
    let tokens: Vec<_> = raw
        .split('+')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();
    let (key, modifiers) = tokens.split_last()?;
    let key = shortcut_key(key)?;
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    for token in modifiers {
        match shortcut_modifier(token)? {
            "Ctrl" => {
                if ctrl {
                    return None;
                }
                ctrl = true;
            }
            "Alt" => {
                if alt {
                    return None;
                }
                alt = true;
            }
            "Shift" => {
                if shift {
                    return None;
                }
                shift = true;
            }
            _ => return None,
        }
    }
    if !(ctrl || alt || shift) {
        return None;
    }
    let mut parts = Vec::with_capacity(4);
    if ctrl {
        parts.push("Ctrl".to_owned());
    }
    if alt {
        parts.push("Alt".to_owned());
    }
    if shift {
        parts.push("Shift".to_owned());
    }
    parts.push(key);
    Some(parts.join("+"))
}
/// Validates a whole `shortcuts` object: known names only, canonical values, no duplicates.
pub fn validate_shortcuts(value: &Value) -> Result<Value> {
    let input = value.as_object().ok_or("Invalid shortcut settings")?;
    if input
        .keys()
        .any(|key| !SHORTCUT_NAMES.contains(&key.as_str()))
    {
        return Err("Invalid shortcut setting".into());
    }
    let mut merged = default_shortcuts();
    let mut seen = std::collections::BTreeMap::new();
    for name in SHORTCUT_NAMES {
        let Some(raw) = input.get(name) else {
            continue;
        };
        let combo = raw
            .as_str()
            .and_then(normalize_shortcut)
            .ok_or("Invalid shortcut combination")?;
        if seen.insert(combo.clone(), name).is_some() {
            return Err("The same shortcut is bound twice.".into());
        }
        merged[name] = json!(combo);
    }
    Ok(merged)
}
pub fn account_id(input: &str) -> Result<String> {
    let input = input.trim();
    let value = input
        .strip_prefix("https://steamcommunity.com/profiles/")
        .map(|s| s.split(['/', '?', '#']).next().unwrap_or(""))
        .unwrap_or(input);
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Enter a numeric Dota ID or SteamID64.".into());
    }
    let mut id = value.parse::<u64>().map_err(|_| "Invalid ID.")?;
    if id >= 76561197960265728 {
        id -= 76561197960265728;
    }
    if id == 0 || id > u32::MAX as u64 {
        return Err("Dota ID is out of range.".into());
    }
    Ok(id.to_string())
}
pub fn atomic_json(path: &Path, data: &Value) -> Result<()> {
    write_json(path, serde_json::to_string_pretty(data))
}
/// Without indentation, for large caches that are read back by size limit.
pub fn atomic_json_compact(path: &Path, data: &Value) -> Result<()> {
    write_json(path, serde_json::to_string(data))
}
fn write_json(path: &Path, text: serde_json::Result<String>) -> Result<()> {
    let dir = path.parent().ok_or("Data directory not found")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(text.map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub struct Store {
    pub directory: PathBuf,
    data: Value,
    own: Option<crate::own_account::Observation>,
    /// Matches recorded from the game (`matches.json`), oldest first.
    matches: Vec<Value>,
    revision: u64,
    /// Changes of the match journal, so the profile reloads recorded matches.
    journal_revision: u64,
    /// The latest median medal the live match showed: (match ID, rank tier).
    medal: Option<(u64, u64)>,
}
impl Store {
    pub fn open(directory: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join("state.json");
        let mut data = match std::fs::read(&path) {
            Ok(bytes) => {
                let v: Value = serde_json::from_slice(&bytes).map_err(|_| {
                    "The state.json file is corrupt; the original has been preserved."
                })?;
                validate(&v)?;
                // A recoverable copy is made once, before the native app's first mutation.
                let backup = directory.join("state.pre-tauri.json");
                if !backup.exists() {
                    std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
                }
                v
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut bytes = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut bytes);
                let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                let v = json!({"version":1,"accountId":"","notes":[],"mmr":[],"token":token,"nativeRosterReader":"off"});
                atomic_json(&path, &v)?;
                v
            }
            Err(e) => return Err(format!("Could not read state.json: {e}")),
        };
        if data.get("nativeRosterReader").is_none() {
            data["nativeRosterReader"] = json!("off");
            atomic_json(&path, &data)?;
        }
        if data.get("shortcuts").is_none() {
            data["shortcuts"] = default_shortcuts();
            atomic_json(&path, &data)?;
        }
        let matches = open_matches(&directory.join("matches.json"))?;
        Ok(Self {
            directory,
            data,
            own: None,
            matches,
            revision: 0,
            journal_revision: 0,
            medal: None,
        })
    }
    pub fn public(&self) -> Value {
        let entries: Vec<_> = self.data["mmr"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["accountId"].is_string() && m["accountId"] == self.data["accountId"])
            .collect();
        let unassigned = self.data["mmr"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| !m["accountId"].is_string())
            .count();
        let snapshot = self.data["accountId"]
            .as_str()
            .map_or(Value::Null, |id| self.data["ratingSnapshots"][id].clone());
        json!({"revision":self.revision,"accountId": self.data["accountId"], "notes":self.data["notes"], "mmr":entries,"unassignedMmrCount":unassigned,"ownAccount":self.own,"ratingSnapshot":snapshot,"nativeRosterReader":self.data["nativeRosterReader"],"closeToTray":self.close_to_tray(),"autoHide":self.auto_hide(),"keysOverGame":self.keys_over_game(),"updateCheck":self.update_check(),"skippedVersion":self.data["skippedVersion"],"shortcuts":self.shortcuts(),"recordedMatches":self.recorded(self.data["accountId"].as_str().unwrap_or("")).len(),"journalRevision":self.journal_revision})
    }
    /// The stored bindings, with defaults for any key an older state file did not have.
    pub fn shortcuts(&self) -> Value {
        let mut merged = default_shortcuts();
        if let Some(stored) = self.data.get("shortcuts").and_then(Value::as_object) {
            for (name, value) in stored {
                if SHORTCUT_NAMES.contains(&name.as_str()) {
                    merged[name] = value.clone();
                }
            }
        }
        merged
    }
    /// The window close button hides to the tray unless the user turned it off (absent = on).
    pub fn close_to_tray(&self) -> bool {
        self.data["closeToTray"].as_bool().unwrap_or(true)
    }
    /// Both windows hide when the user activates another application (absent = on).
    pub fn auto_hide(&self) -> bool {
        self.data["autoHide"].as_bool().unwrap_or(true)
    }
    /// While the game runs, the window keys listen only over it and this app (absent = on).
    pub fn keys_over_game(&self) -> bool {
        self.data["keysOverGame"].as_bool().unwrap_or(true)
    }
    /// Whether the app asks GitHub for new releases (absent = on).
    pub fn update_check(&self) -> bool {
        self.data["updateCheck"].as_bool().unwrap_or(true)
    }
    /// The single user consent for every Dota memory reader (Linux roster, Windows rating).
    pub fn memory_reader(&self) -> bool {
        self.data["nativeRosterReader"] == "on"
    }
    /// Only the live observation, for frequent updates that leave stored data unchanged.
    pub fn own_public(&self) -> Value {
        json!({"revision":self.revision,"ownAccount":self.own})
    }
    /// Apply one serial local observation; returns whether stored data changed.
    /// Only account/rating changes touch disk; failed probes clear live values but
    /// never reassign a previous account's data.
    pub fn observe_account(
        &mut self,
        observation: crate::own_account::Observation,
    ) -> Result<bool> {
        let mut next: Option<Value> = None;
        let mut measured: Option<String> = None;
        if let Some(id) = &observation.account_id {
            let id = account_id(id)?;
            if self.data["accountId"] != id.as_str() {
                next.get_or_insert_with(|| self.data.clone())["accountId"] = json!(id);
            }
            if observation.status == "measured" {
                if let (Some(value), Some(confidence)) = (observation.mmr, observation.confidence) {
                    if value == 0 || value > 20000 || !(30..=100).contains(&confidence) {
                        return Err("Invalid rating measurement".into());
                    }
                    // Confidence decays with time alone, so only a new MMR is a journal entry.
                    let last =
                        self.data["mmr"].as_array().unwrap().iter().rev().find(|m| {
                            m["accountId"] == id.as_str() && m["source"] == "dota-memory"
                        });
                    if last.is_none_or(|m| m["value"] != value) {
                        next.get_or_insert_with(|| self.data.clone())["mmr"].as_array_mut().unwrap().push(json!({"id":uuid::Uuid::new_v4().to_string(),"accountId":id,"value":value,"confidence":confidence,"source":"dota-memory","createdAt":observation.observed_at}));
                        measured = Some(id.clone());
                    }
                }
            }
            if let Some(snapshot) = snapshot(&observation) {
                validate_snapshot(&snapshot)?;
                let stored = &self.data["ratingSnapshots"][id.as_str()];
                let same = ["mmr", "confidence", "behaviorScore", "communicationScore"]
                    .iter()
                    .all(|key| stored[key] == snapshot[key]);
                // Equal values only refresh the time, at most every ten minutes, so an open
                // game does not rewrite state.json on every poll.
                let recent = stored["confirmedAt"]
                    .as_str()
                    .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                    .is_some_and(|at| {
                        chrono::Utc::now().signed_duration_since(at) < chrono::Duration::minutes(10)
                    });
                if !same || !recent {
                    let next = next.get_or_insert_with(|| self.data.clone());
                    if !next["ratingSnapshots"].is_object() {
                        next["ratingSnapshots"] = json!({});
                    }
                    next["ratingSnapshots"][id.as_str()] = snapshot;
                }
            }
        }
        let changed = next.is_some();
        if let Some(next) = next {
            atomic_json(&self.directory.join("state.json"), &next)?;
            self.data = next;
        }
        // A new rating may be the result of the last recorded match.
        if let Some(id) = measured {
            let mut matches = self.matches.clone();
            if crate::journal::attribute(&mut matches, self.data["mmr"].as_array().unwrap(), &id) {
                self.save_matches(matches)?;
            }
        }
        self.own = Some(observation);
        self.revision += 1;
        Ok(changed)
    }
    pub fn token(&self) -> String {
        self.data["token"].as_str().unwrap().into()
    }
    pub fn export(&self) -> Value {
        // Include all accounts and legacy unassigned records, without the GSI secret.
        json!({"accountId":self.data["accountId"],"notes":self.data["notes"],"mmr":self.data["mmr"],"ratingSnapshots":self.data["ratingSnapshots"],"nativeRosterReader":self.data["nativeRosterReader"],"matches":self.matches})
    }
    /// Matches recorded from the game for one account.
    pub fn recorded(&self, account: &str) -> Vec<Value> {
        self.matches
            .iter()
            .filter(|m| m["accountId"] == account)
            .cloned()
            .collect()
    }
    /// The median medal of the players a live match showed, for the record of that match
    /// whether it exists yet or not; returns whether a saved record changed.
    pub fn medal_rank(&mut self, match_id: u64, tier: u64) -> Result<bool> {
        if match_id == 0 || !(10..=80).contains(&tier) {
            return Err("Invalid medal".into());
        }
        self.medal = Some((match_id, tier));
        let mut matches = self.matches.clone();
        let mut changed = false;
        for row in matches.iter_mut().filter(|m| m["match_id"] == match_id) {
            changed |= row["medal_rank"] != tier;
            row["medal_rank"] = json!(tier);
        }
        if changed {
            self.save_matches(matches)?;
            self.revision += 1;
        }
        Ok(changed)
    }
    /// Saves a finished match once per account and match; returns whether it was new.
    pub fn record_match(&mut self, mut row: Value) -> Result<bool> {
        crate::journal::validate(&row)?;
        if self
            .matches
            .iter()
            .any(|m| m["accountId"] == row["accountId"] && m["match_id"] == row["match_id"])
        {
            return Ok(false);
        }
        if let Some((_, tier)) = self.medal.filter(|(id, _)| row["match_id"] == *id) {
            row["medal_rank"] = json!(tier);
        }
        let account = row["accountId"].as_str().unwrap().to_owned();
        let entries = self.data["mmr"].as_array().unwrap();
        crate::journal::baseline(&mut row, entries);
        let mut matches = self.matches.clone();
        matches.push(row);
        crate::journal::attribute(&mut matches, entries, &account);
        let excess = matches.len().saturating_sub(crate::journal::LIMIT);
        matches.drain(..excess);
        self.save_matches(matches)?;
        self.revision += 1;
        Ok(true)
    }
    /// Recorded matches whose match data is due to be fetched, newest first.
    pub fn details_due(&self, now: i64, stratz: bool, limit: usize) -> Vec<Value> {
        self.matches
            .iter()
            .rev()
            .filter(|m| crate::journal::details_due(m, now, stratz))
            .take(limit)
            .cloned()
            .collect()
    }
    /// Counts an attempt to fetch a recorded match and adds what the fetched matches know.
    /// Returns whether the record gained data.
    pub fn save_details(
        &mut self,
        account: &str,
        match_id: u64,
        details: &[Value],
        at: &str,
    ) -> Result<bool> {
        let mut matches = self.matches.clone();
        let Some(row) = matches
            .iter_mut()
            .find(|m| m["accountId"] == account && m["match_id"] == match_id)
        else {
            return Ok(false);
        };
        let before = row.clone();
        crate::journal::details_attempted(row, at);
        for value in details {
            crate::journal::add_details(row, value);
        }
        crate::journal::validate(row)?;
        // Schedule fields alone are not new data.
        let mut gained = before.clone();
        for key in ["detailsAttempts", "detailsAt", "detailsVersion"] {
            if let Some(value) = row.get(key) {
                gained[key] = value.clone();
            }
        }
        let changed = gained != *row;
        self.save_matches(matches)?;
        if changed {
            self.revision += 1;
        }
        Ok(changed)
    }
    fn save_matches(&mut self, matches: Vec<Value>) -> Result<()> {
        atomic_json(
            &self.directory.join("matches.json"),
            &json!({"version":1,"matches":matches}),
        )?;
        self.matches = matches;
        self.journal_revision += 1;
        Ok(())
    }
    pub fn change(&mut self, command: &str, args: &Value) -> Result<Value> {
        let mut next = self.data.clone();
        match command {
            "state:reader" => {
                let value = args["value"]
                    .as_str()
                    .filter(|v| ["off", "on"].contains(v))
                    .ok_or("Invalid Dota memory reading setting")?;
                next["nativeRosterReader"] = json!(value);
            }
            "state:tray" => {
                next["closeToTray"] = json!(args["value"]
                    .as_bool()
                    .ok_or("Invalid close-to-tray setting")?);
            }
            "state:auto-hide" => {
                next["autoHide"] =
                    json!(args["value"].as_bool().ok_or("Invalid auto-hide setting")?);
            }
            "state:keys-over-game" => {
                next["keysOverGame"] = json!(args["value"]
                    .as_bool()
                    .ok_or("Invalid shortcut scope setting")?);
            }
            "state:update-check" => {
                next["updateCheck"] = json!(args["value"]
                    .as_bool()
                    .ok_or("Invalid update check setting")?);
            }
            // The notice stays away for this version only; a newer one shows again.
            "state:skip-version" => {
                let version = args["version"]
                    .as_str()
                    .and_then(crate::releases::version)
                    .ok_or("Invalid version")?;
                next["skippedVersion"] = json!(crate::releases::format(version));
            }
            "state:shortcuts" => {
                next["shortcuts"] = validate_shortcuts(&args["shortcuts"])?;
            }
            "state:account" => {
                next["accountId"] = json!(account_id(args["id"].as_str().unwrap_or(""))?)
            }
            "note:save" => {
                let mut note = args["note"].clone();
                validate_note(&note)?;
                note["accountId"] = json!(account_id(note["accountId"].as_str().unwrap_or(""))?);
                // The same words as SELF_NOTE in NoteEditor.tsx.
                if note["accountId"] == next["accountId"] {
                    return Err("Why would you need a note about yourself? Everybody knows you are the best.".into());
                }
                note["name"] = json!(note["name"].as_str().unwrap().trim());
                note["text"] = json!(note["text"].as_str().unwrap().trim());
                note["updatedAt"] = json!(now());
                let notes = next["notes"].as_array_mut().unwrap();
                notes.retain(|n| n["accountId"] != note["accountId"]);
                notes.insert(0, note);
            }
            "note:delete" => {
                let id = account_id(args["id"].as_str().unwrap_or(""))?;
                next["notes"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|n| n["accountId"] != id);
            }
            "mmr:add" => {
                let id = account_id(next["accountId"].as_str().unwrap_or(""))?;
                if args
                    .get("expectedAccountId")
                    .is_some_and(|expected| expected.as_str() != Some(&id))
                {
                    return Err(
                        "The account has changed. Check the profile before saving a rating.".into(),
                    );
                }
                let value = args["value"]
                    .as_u64()
                    .filter(|v| *v <= 20000)
                    .ok_or("MMR must be between 0 and 20000.")?;
                next["mmr"].as_array_mut().unwrap().push(
                    json!({"id":uuid::Uuid::new_v4().to_string(),"accountId":id,"source":"manual","value":value,"createdAt":now()}),
                );
            }
            "mmr:delete" => {
                let id = args["id"].as_str().ok_or("Invalid entry ID")?;
                uuid::Uuid::parse_str(id).map_err(|_| "Invalid entry ID")?;
                // Only the current account's entries are listed, so only they can be deleted;
                // other accounts' and unassigned legacy entries stay untouched.
                let account = next["accountId"].clone();
                let entries = next["mmr"].as_array_mut().unwrap();
                let before = entries.len();
                entries.retain(|n| n["id"] != id || n["accountId"] != account);
                if entries.len() == before {
                    return Err("Entry not found".into());
                }
            }
            _ => return Err("Unknown operation".into()),
        }
        atomic_json(&self.directory.join("state.json"), &next)?;
        self.data = next;
        self.revision += 1;
        Ok(self.public())
    }
}
/// Loads the match journal. An unreadable file is set aside under a new name instead of
/// blocking the app or being overwritten by the next recorded match.
fn open_matches(path: &Path) -> Result<Vec<Value>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Could not read matches.json: {e}")),
    };
    let parsed = serde_json::from_slice::<Value>(&bytes).ok().filter(|v| {
        v["version"] == 1
            && v["matches"]
                .as_array()
                .is_some_and(|rows| rows.iter().all(|row| crate::journal::validate(row).is_ok()))
    });
    match parsed {
        Some(v) => Ok(v["matches"].as_array().unwrap().clone()),
        None => {
            let aside = path.with_file_name(format!(
                "matches.unreadable-{}.json",
                chrono::Utc::now().format("%Y%m%dT%H%M%S")
            ));
            std::fs::rename(path, &aside).map_err(|e| e.to_string())?;
            eprintln!(
                "matches.json was unreadable and has been kept as {}",
                aside.display()
            );
            Ok(vec![])
        }
    }
}
fn validate_note(n: &Value) -> Result<()> {
    account_id(n["accountId"].as_str().unwrap_or(""))?;
    if n["name"]
        .as_str()
        .is_none_or(|s| s.trim().chars().count() > 80)
        || n["text"]
            .as_str()
            .is_none_or(|s| s.trim().is_empty() || s.trim().chars().count() > 2000)
        || !["neutral", "teammate", "avoid"].contains(&n["tag"].as_str().unwrap_or(""))
    {
        return Err("Invalid note".into());
    }
    Ok(())
}
/// The last confirmed reading kept for display while Dota is closed; never a live value.
fn snapshot(observation: &crate::own_account::Observation) -> Option<Value> {
    if !["measured", "calibrating"].contains(&observation.status.as_str()) {
        return None;
    }
    Some(json!({
        "mmr": observation.mmr,
        "confidence": observation.confidence?,
        "behaviorScore": observation.behavior_score?,
        "communicationScore": observation.communication_score?,
        "confirmedAt": observation.observed_at,
    }))
}
fn validate_snapshot(v: &Value) -> Result<()> {
    let score = |key: &str| v[key].as_u64().is_some_and(|s| s <= 12000);
    if !(v["mmr"].is_null() || v["mmr"].as_u64().is_some_and(|m| (1..=20000).contains(&m)))
        || v["confidence"].as_u64().is_none_or(|c| c > 100)
        || !score("behaviorScore")
        || !score("communicationScore")
        || !v["confirmedAt"].is_string()
    {
        return Err("Invalid rating snapshot".into());
    }
    Ok(())
}
fn validate(v: &Value) -> Result<()> {
    let invalid = "Unrecognized state.json format; the original has been preserved.";
    if v["version"] != 1
        || !v["accountId"].is_string()
        || v["token"].as_str().is_none_or(|s| {
            s.len() != 64
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(invalid.into());
    }
    if v.get("nativeRosterReader").is_some()
        && !matches!(v["nativeRosterReader"].as_str(), Some("off" | "on"))
    {
        return Err(invalid.into());
    }
    if v.get("closeToTray")
        .is_some_and(|value| !value.is_boolean())
        || v.get("autoHide").is_some_and(|value| !value.is_boolean())
        || v.get("keysOverGame")
            .is_some_and(|value| !value.is_boolean())
        || v.get("updateCheck")
            .is_some_and(|value| !value.is_boolean())
        || v.get("skippedVersion")
            .is_some_and(|value| value.as_str().and_then(crate::releases::version).is_none())
    {
        return Err(invalid.into());
    }
    if let Some(shortcuts) = v.get("shortcuts") {
        validate_shortcuts(shortcuts).map_err(|_| invalid)?;
    }
    if let Some(snapshots) = v.get("ratingSnapshots") {
        for (id, snapshot) in snapshots.as_object().ok_or(invalid)? {
            account_id(id)?;
            validate_snapshot(snapshot).map_err(|_| invalid)?;
        }
    }
    for n in v["notes"].as_array().ok_or(invalid)? {
        validate_note(n)?;
        if !n["updatedAt"].is_string() {
            return Err(invalid.into());
        }
    }
    for m in v["mmr"].as_array().ok_or(invalid)? {
        if let Some(id) = m.get("accountId") {
            account_id(id.as_str().ok_or(invalid)?)?;
        }
        if !m["id"].is_string()
            || !m["createdAt"].is_string()
            || m["value"].as_u64().is_none_or(|v| v > 20000)
        {
            return Err(invalid.into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_defaults_off_and_migrates_without_losing_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().into()).unwrap();
        assert_eq!(store.public()["nativeRosterReader"], "off");
        let mut legacy = store.data.clone();
        legacy.as_object_mut().unwrap().remove("nativeRosterReader");
        legacy["accountId"] = json!("123");
        atomic_json(&dir.path().join("state.json"), &legacy).unwrap();
        let mut migrated = Store::open(dir.path().into()).unwrap();
        assert_eq!(migrated.public()["nativeRosterReader"], "off");
        assert_eq!(migrated.public()["accountId"], "123");
        assert_eq!(migrated.data["token"], legacy["token"]);
        for mode in ["on", "off"] {
            migrated
                .change("state:reader", &json!({"value":mode}))
                .unwrap();
            assert_eq!(
                Store::open(dir.path().into()).unwrap().public()["nativeRosterReader"],
                mode
            );
        }
        for value in [json!(true), json!(null), json!("invalid")] {
            assert!(migrated
                .change("state:reader", &json!({"value":value}))
                .is_err());
            assert_eq!(migrated.public()["nativeRosterReader"], "off");
            let mut invalid = legacy.clone();
            invalid["nativeRosterReader"] = value;
            assert!(validate(&invalid).is_err());
        }
    }
    #[test]
    fn shortcuts_default_migrate_and_validate() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().into()).unwrap();
        assert_eq!(store.public()["shortcuts"], default_shortcuts());
        // An older state file gains the defaults without losing its data.
        let mut legacy = store.data.clone();
        legacy.as_object_mut().unwrap().remove("shortcuts");
        legacy["accountId"] = json!("123");
        atomic_json(&dir.path().join("state.json"), &legacy).unwrap();
        let migrated = Store::open(dir.path().into()).unwrap();
        assert_eq!(migrated.public()["shortcuts"]["global"], "Alt+Numpad5");
        assert_eq!(migrated.public()["accountId"], "123");
        // A file saved before the profile window had its own key gains that key's default.
        let mut seven = legacy.clone();
        let mut old = default_shortcuts();
        old.as_object_mut().unwrap().remove("profile");
        seven["shortcuts"] = old;
        atomic_json(&dir.path().join("state.json"), &seven).unwrap();
        let mut migrated = Store::open(dir.path().into()).unwrap();
        assert_eq!(migrated.public()["shortcuts"]["profile"], "Alt+Numpad6");
        // Accepted aliases are stored in one canonical form.
        let saved = migrated
            .change(
                "state:shortcuts",
                &json!({"shortcuts":{
                    "global":"ctrl+shift+f9",
                    "leftPrevious":"ALT+LEFT",
                    "leftNext":"Alt+Right",
                    "rightPrevious":"Shift+Left",
                    "rightNext":"Shift+Right",
                    "lanePrevious":"Alt+Up",
                    "laneNext":"Alt+Down"
                }}),
            )
            .unwrap();
        assert_eq!(saved["shortcuts"]["global"], "Ctrl+Shift+F9");
        assert_eq!(saved["shortcuts"]["profile"], "Alt+Numpad6");
        assert_eq!(saved["shortcuts"]["leftPrevious"], "Alt+ArrowLeft");
        assert_eq!(
            Store::open(dir.path().into()).unwrap().public()["shortcuts"]["laneNext"],
            "Alt+ArrowDown"
        );
        // Invalid names, bare keys, unknown keys, repeated combinations and bad types fail
        // without changing the stored bindings.
        for invalid in [
            json!({"global":"F9"}),
            json!({"global":"Alt+Backspace"}),
            json!({"unknown":"Alt+F9"}),
            json!({"global":"Alt+F9","laneNext":"alt+f9"}),
            json!({"global":"Alt+F9","profile":"Alt+F9"}),
            json!({"global":5}),
            json!("Alt+F9"),
        ] {
            assert!(migrated
                .change("state:shortcuts", &json!({"shortcuts":invalid}))
                .is_err());
            assert_eq!(migrated.public()["shortcuts"]["global"], "Ctrl+Shift+F9");
        }
        // A missing name keeps its default, so a future setting can be added safely.
        migrated
            .change(
                "state:shortcuts",
                &json!({"shortcuts":{"global":"Alt+F10"}}),
            )
            .unwrap();
        assert_eq!(migrated.public()["shortcuts"]["leftNext"], "Alt+ArrowRight");
        // The profile window's key is rebound like any other.
        let saved = migrated
            .change(
                "state:shortcuts",
                &json!({"shortcuts":{"global":"Alt+F10","profile":"Ctrl+Alt+KeyP"}}),
            )
            .unwrap();
        assert_eq!(saved["shortcuts"]["profile"], "Ctrl+Alt+KeyP");
    }
    #[test]
    fn shortcut_keys_are_recognized_and_super_is_reserved() {
        assert_eq!(
            normalize_shortcut("alt+numpad5").as_deref(),
            Some("Alt+Numpad5")
        );
        assert_eq!(normalize_shortcut("Num5+Shift").as_deref(), None);
        assert_eq!(
            normalize_shortcut("Shift+Num5").as_deref(),
            Some("Shift+Numpad5")
        );
        assert_eq!(normalize_shortcut("Ctrl+1").as_deref(), Some("Ctrl+Digit1"));
        assert_eq!(normalize_shortcut("Ctrl+A").as_deref(), Some("Ctrl+KeyA"));
        // The settings page sends the canonical form back.
        assert_eq!(
            normalize_shortcut("Ctrl+Alt+KeyP").as_deref(),
            Some("Ctrl+Alt+KeyP")
        );
        assert_eq!(
            normalize_shortcut("Alt+Digit7").as_deref(),
            Some("Alt+Digit7")
        );
        assert_eq!(normalize_shortcut("Alt+Key1").as_deref(), None);
        assert_eq!(normalize_shortcut("Alt+DigitA").as_deref(), None);
        assert_eq!(
            normalize_shortcut("Ctrl+ArrowLeft").as_deref(),
            Some("Ctrl+ArrowLeft")
        );
        assert_eq!(normalize_shortcut("Ctrl+F13").as_deref(), None);
        assert_eq!(normalize_shortcut("Super+A").as_deref(), None);
        assert_eq!(normalize_shortcut("Ctrl+Shift+Ctrl+A").as_deref(), None);
        assert_eq!(normalize_shortcut("Escape").as_deref(), None);
    }
    #[test]
    fn closing_to_the_tray_defaults_on_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        assert!(store.close_to_tray());
        assert_eq!(store.public()["closeToTray"], true);
        store.change("state:tray", &json!({"value":false})).unwrap();
        let mut reopened = Store::open(dir.path().into()).unwrap();
        assert!(!reopened.close_to_tray());
        for value in [json!("on"), json!(null), json!(1)] {
            assert!(reopened
                .change("state:tray", &json!({"value":value}))
                .is_err());
            let mut invalid = reopened.data.clone();
            invalid["closeToTray"] = value;
            assert!(validate(&invalid).is_err());
        }
        assert!(!reopened.close_to_tray());
    }
    #[test]
    fn hiding_for_another_app_defaults_on_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        assert!(store.auto_hide());
        assert_eq!(store.public()["autoHide"], true);
        let value = store
            .change("state:auto-hide", &json!({"value":false}))
            .unwrap();
        assert_eq!(value["autoHide"], false);
        let mut reopened = Store::open(dir.path().into()).unwrap();
        assert!(!reopened.auto_hide());
        for value in [json!("on"), json!(null), json!(1)] {
            assert!(reopened
                .change("state:auto-hide", &json!({"value":value}))
                .is_err());
            let mut invalid = reopened.data.clone();
            invalid["autoHide"] = value;
            assert!(validate(&invalid).is_err());
        }
        reopened
            .change("state:auto-hide", &json!({"value":true}))
            .unwrap();
        assert!(Store::open(dir.path().into()).unwrap().auto_hide());
    }
    #[test]
    fn keys_only_over_the_game_default_on_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        assert!(store.keys_over_game());
        assert_eq!(store.public()["keysOverGame"], true);
        let value = store
            .change("state:keys-over-game", &json!({"value":false}))
            .unwrap();
        assert_eq!(value["keysOverGame"], false);
        let mut reopened = Store::open(dir.path().into()).unwrap();
        assert!(!reopened.keys_over_game());
        for value in [json!("on"), json!(null), json!(1)] {
            assert!(reopened
                .change("state:keys-over-game", &json!({"value":value}))
                .is_err());
            let mut invalid = reopened.data.clone();
            invalid["keysOverGame"] = value;
            assert!(validate(&invalid).is_err());
        }
        reopened
            .change("state:keys-over-game", &json!({"value":true}))
            .unwrap();
        assert!(Store::open(dir.path().into()).unwrap().keys_over_game());
    }
    #[test]
    fn release_check_defaults_on_and_a_skipped_version_persists() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        assert_eq!(store.public()["updateCheck"], true);
        assert_eq!(store.public()["skippedVersion"], Value::Null);
        store
            .change("state:update-check", &json!({"value":false}))
            .unwrap();
        let value = store
            .change("state:skip-version", &json!({"version":"v0.7.0"}))
            .unwrap();
        assert_eq!(value["skippedVersion"], "0.7.0");
        let mut reopened = Store::open(dir.path().into()).unwrap();
        assert!(!reopened.update_check());
        assert_eq!(reopened.public()["skippedVersion"], "0.7.0");
        for version in [json!("latest"), json!(null), json!(7)] {
            assert!(reopened
                .change("state:skip-version", &json!({"version":version}))
                .is_err());
            let mut invalid = reopened.data.clone();
            invalid["skippedVersion"] = version;
            assert!(validate(&invalid).is_err());
        }
        assert!(reopened
            .change("state:update-check", &json!({"value":"on"}))
            .is_err());
        let mut invalid = reopened.data.clone();
        invalid["updateCheck"] = json!("on");
        assert!(validate(&invalid).is_err());
    }
    #[test]
    fn ids() {
        assert_eq!(account_id("76561198083722517").unwrap(), "123456789");
        for id in ["0", "4294967296", "-1", "../state"] {
            assert!(account_id(id).is_err());
        }
    }
    #[test]
    fn migration_preserves_secret_and_data() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let token = s.token();
        s.change(
            "note:save",
            &json!({"note":{"accountId":"123","name":"Test","text":"keep","tag":"avoid"}}),
        )
        .unwrap();
        let before = s.public();
        drop(s);
        let s = Store::open(dir.path().into()).unwrap();
        assert_eq!(s.public()["notes"], before["notes"]);
        assert_eq!(s.public()["accountId"], before["accountId"]);
        assert_eq!(s.public()["mmr"], before["mmr"]);
        assert_eq!(s.token(), token);
        assert!(dir.path().join("state.pre-tauri.json").exists());
        assert!(s.public().get("token").is_none());
    }
    #[test]
    fn no_note_about_oneself() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        s.change("state:account", &json!({"id":"123"})).unwrap();
        let note =
            |id: &str| json!({"note":{"accountId":id,"name":"Me","text":"best","tag":"neutral"}});
        assert!(s
            .change("note:save", &note("123"))
            .unwrap_err()
            .contains("note about yourself"));
        s.change("note:save", &note("456")).unwrap();
        assert_eq!(s.public()["notes"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn corrupt_state_is_not_overwritten() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("state.json");
        std::fs::write(&p, b"broken").unwrap();
        assert!(Store::open(d.path().into()).is_err());
        assert_eq!(std::fs::read(p).unwrap(), b"broken");
    }
    fn measured(id: &str, mmr: u32) -> crate::own_account::Observation {
        let mut o = crate::own_account::Observation::unavailable(
            Some(id.into()),
            "measured",
            "dota-memory",
        );
        o.mmr = Some(mmr);
        o.confidence = Some(60);
        o
    }
    #[test]
    fn automatic_switch_isolates_history_and_unavailable_values() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        assert!(s.observe_account(measured("123", 6586)).unwrap());
        assert!(!s.observe_account(measured("123", 6586)).unwrap());
        assert_eq!(s.public()["mmr"].as_array().unwrap().len(), 1);
        assert!(s
            .observe_account(crate::own_account::Observation::unavailable(
                Some("456".into()),
                "account-mismatch",
                "steam",
            ))
            .unwrap());
        let b = s.public();
        assert_eq!(b["accountId"], "456");
        assert!(b["ownAccount"]["mmr"].is_null());
        assert!(b["mmr"].as_array().unwrap().is_empty());
        s.observe_account(measured("456", 3000)).unwrap();
        assert!(s
            .change("mmr:add", &json!({"value":6586,"expectedAccountId":"123"}))
            .is_err());
        s.change("mmr:add", &json!({"value":3100})).unwrap();
        s.observe_account(measured("123", 6586)).unwrap();
        let a = s.public();
        assert_eq!(a["mmr"].as_array().unwrap().len(), 1);
        assert_eq!(a["mmr"][0]["value"], 6586);
        assert!(!s
            .observe_account(crate::own_account::Observation::unavailable(
                None,
                "waiting-account",
                "steam",
            ))
            .unwrap());
        assert!(s.own_public()["ownAccount"]["mmr"].is_null());
        assert_eq!(s.own_public()["revision"], s.public()["revision"]);
        let reopened = Store::open(dir.path().into()).unwrap();
        assert_eq!(reopened.public()["mmr"], a["mmr"]);
        assert_eq!(reopened.export()["mmr"].as_array().unwrap().len(), 3);
    }
    #[test]
    fn legacy_rating_is_preserved_without_guessing_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path().into()).unwrap();
        let mut legacy = s.data.clone();
        legacy["accountId"] = json!("123");
        legacy["mmr"] =
            json!([{"id":uuid::Uuid::new_v4().to_string(),"value":2000,"createdAt":now()}]);
        atomic_json(&dir.path().join("state.json"), &legacy).unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        s.observe_account(measured("456", 3000)).unwrap();
        assert_eq!(s.public()["unassignedMmrCount"], 1);
        assert_eq!(s.public()["mmr"].as_array().unwrap().len(), 1);
        assert_eq!(s.export()["mmr"][0], legacy["mmr"][0]);
        assert!(s.export().get("token").is_none());
    }
    #[test]
    fn last_reading_survives_closing_the_game_and_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let mut o = measured("123", 6586);
        o.behavior_score = Some(10473);
        o.communication_score = Some(9296);
        assert!(s.observe_account(o.clone()).unwrap());
        // Unchanged values within ten minutes do not touch disk.
        assert!(!s.observe_account(o.clone()).unwrap());
        let closed = crate::own_account::Observation::unavailable(
            Some("123".into()),
            "waiting-game",
            "steam",
        );
        assert!(!s.observe_account(closed).unwrap());
        let saved = &s.public()["ratingSnapshot"];
        assert!(s.public()["ownAccount"]["mmr"].is_null());
        assert_eq!(
            (&saved["mmr"], &saved["confidence"], &saved["behaviorScore"]),
            (&json!(6586), &json!(60), &json!(10473))
        );
        o.communication_score = Some(9300);
        assert!(s.observe_account(o).unwrap());
        let reopened = Store::open(dir.path().into()).unwrap();
        assert_eq!(
            reopened.public()["ratingSnapshot"]["communicationScore"],
            9300
        );
        assert_eq!(reopened.export()["ratingSnapshots"]["123"]["mmr"], 6586);
        // Another account sees only its own snapshot.
        let mut other = Store::open(dir.path().into()).unwrap();
        other.change("state:account", &json!({"id":"456"})).unwrap();
        assert!(other.public()["ratingSnapshot"].is_null());
    }
    #[test]
    fn deleting_a_rating_entry_is_limited_to_the_current_account() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        s.observe_account(measured("123", 6586)).unwrap();
        let entry = s.public()["mmr"][0]["id"].as_str().unwrap().to_owned();
        s.change("state:account", &json!({"id":"456"})).unwrap();
        assert!(s.change("mmr:delete", &json!({"id":entry})).is_err());
        assert_eq!(s.export()["mmr"].as_array().unwrap().len(), 1);
        s.change("state:account", &json!({"id":"123"})).unwrap();
        s.change("mmr:delete", &json!({"id":entry})).unwrap();
        assert!(s.export()["mmr"].as_array().unwrap().is_empty());
    }
    fn finished(match_id: u64, at: &str) -> Value {
        let live = json!({"mode":"player","matchId":match_id.to_string(),"gameState":"DOTA_GAMERULES_STATE_POST_GAME",
            "clock":1800,"winTeam":"radiant","players":[{"key":"self","team":"radiant","teamSlot":0,"accountId":"123","heroId":1,"kills":5}]});
        crate::journal::record(&live, at).unwrap()
    }
    #[test]
    fn recorded_matches_persist_per_account_and_take_the_following_rating() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let mut before = measured("123", 4000);
        before.observed_at = "2020-01-01T00:00:00.000Z".into();
        s.observe_account(before).unwrap();
        let now = now();
        assert!(s.record_match(finished(10, &now)).unwrap());
        assert!(!s.record_match(finished(10, &now)).unwrap());
        assert_eq!(s.public()["recordedMatches"], 1);
        assert_eq!(s.recorded("123")[0]["mmr_before"], 4000);
        assert!(s.recorded("123")[0]["mmr_after"].is_null());
        s.observe_account(measured("123", 4025)).unwrap();
        assert_eq!(s.recorded("123")[0]["mmr_delta"], 25);
        let reopened = Store::open(dir.path().into()).unwrap();
        assert_eq!(reopened.recorded("123")[0]["mmr_after"], 4025);
        assert_eq!(reopened.export()["matches"].as_array().unwrap().len(), 1);
        assert!(reopened.recorded("456").is_empty());
        let mut invalid = finished(11, &now);
        invalid["player_slot"] = json!(7);
        assert!(s.record_match(invalid).is_err());
    }
    #[test]
    fn the_live_median_medal_joins_the_record_of_its_match() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let now = now();
        // Seen while the match runs, before its record exists.
        assert!(!s.medal_rank(10, 74).unwrap());
        assert!(s.record_match(finished(10, &now)).unwrap());
        assert_eq!(s.recorded("123")[0]["medal_rank"], 74);
        // More profiles loaded after the end: the newer median replaces it.
        let journal = s.public()["journalRevision"].as_u64().unwrap();
        assert!(s.medal_rank(10, 65).unwrap());
        assert!(s.public()["journalRevision"].as_u64().unwrap() > journal);
        assert!(!s.medal_rank(10, 65).unwrap());
        let reopened = Store::open(dir.path().into()).unwrap();
        assert_eq!(reopened.recorded("123")[0]["medal_rank"], 65);
        // Another match's medal stays out; not a medal is refused.
        assert!(s.record_match(finished(11, &now)).unwrap());
        assert!(s.recorded("123")[1]["medal_rank"].is_null());
        for tier in [0, 9, 81, 90] {
            assert!(s.medal_rank(11, tier).is_err());
        }
    }
    #[test]
    fn match_details_are_saved_to_the_record_and_count_attempts() {
        use crate::match_details::{from_opendota, tests as fixture};
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let at = "2026-10-23T20:00:00.000Z";
        let mut row = fixture::record();
        for (key, value) in [
            ("start_time", json!(1792783800)),
            ("duration", json!(1800)),
            ("radiant_win", json!(false)),
            ("source", json!("game")),
            ("recordedAt", json!(at)),
        ] {
            row[key] = value;
        }
        assert!(s.record_match(row).unwrap());
        let end = 1792785600;
        assert!(s.details_due(end, false, 2).is_empty());
        assert_eq!(s.details_due(end + 120, false, 2).len(), 1);
        let journal = s.public()["journalRevision"].as_u64().unwrap();
        // A failed attempt is still counted, so the next one waits.
        assert!(!s.save_details("7", 42, &[], at).unwrap());
        assert!(s.details_due(end + 120, false, 2).is_empty());
        let details = from_opendota(42, &fixture::opendota()).unwrap();
        assert!(s.save_details("7", 42, &[details], at).unwrap());
        assert!(s.public()["journalRevision"].as_u64().unwrap() > journal);
        let reopened = Store::open(dir.path().into()).unwrap();
        let saved = &reopened.recorded("7")[0];
        assert_eq!(
            (&saved["hero_damage"], &saved["detailsAttempts"]),
            (&json!(12000), &json!(2))
        );
        assert!(reopened.details_due(end + 86400 * 3, false, 2).is_empty());
        assert!(!s.save_details("8", 42, &[], at).unwrap());
    }
    #[test]
    fn an_unreadable_journal_is_set_aside_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("matches.json"), b"broken").unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        assert!(s.recorded("123").is_empty());
        let aside: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("matches.unreadable-")
            })
            .collect();
        assert_eq!(std::fs::read(aside[0].path()).unwrap(), b"broken");
        s.record_match(finished(10, &now())).unwrap();
        assert_eq!(
            Store::open(dir.path().into())
                .unwrap()
                .recorded("123")
                .len(),
            1
        );
    }
    #[test]
    fn calibration_does_not_record_zero_as_a_rating() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let mut o = measured("123", 0);
        o.status = "calibrating".into();
        o.mmr = None;
        o.confidence = Some(29);
        s.observe_account(o).unwrap();
        assert!(s.public()["mmr"].as_array().unwrap().is_empty());
        assert_eq!(s.public()["ownAccount"]["confidence"], 29);
    }
    #[test]
    fn confidence_decay_alone_is_not_a_new_rating_entry() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        s.observe_account(measured("123", 6586)).unwrap();
        let mut decayed = measured("123", 6586);
        decayed.confidence = Some(59);
        assert!(!s.observe_account(decayed).unwrap());
        assert_eq!(s.public()["mmr"].as_array().unwrap().len(), 1);
        assert_eq!(s.public()["ownAccount"]["confidence"], 59);
        assert!(s.observe_account(measured("123", 6612)).unwrap());
        assert_eq!(s.public()["mmr"].as_array().unwrap().len(), 2);
        assert!(!s.memory_reader());
        s.change("state:reader", &json!({"value":"on"})).unwrap();
        assert!(s.memory_reader());
    }
}
