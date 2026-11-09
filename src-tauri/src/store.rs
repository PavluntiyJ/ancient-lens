mod state;

use serde_json::{json, Value};
pub use state::{MmrEntry, Note, NoteEntry, RatingSnapshot, Reader, State};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
/// Removed menu entries that are still remembered; far above any real number of accounts.
const MAX_HIDDEN_PROFILES: usize = 256;
/// Most notes kept about one player.
const MAX_NOTE_ENTRIES: usize = 500;
/// A note written this long after a recorded match with the player still belongs to it.
const NOTE_AFTER_MATCH: i64 = 15 * 60;
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
fn default_shortcut_map() -> std::collections::BTreeMap<String, String> {
    serde_json::from_value(default_shortcuts()).expect("default shortcuts are strings")
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
    state: State,
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
        let mut state = match std::fs::read(&path) {
            Ok(bytes) => {
                let v: Value = serde_json::from_slice(&bytes).map_err(|_| {
                    "The state.json file is corrupt; the original has been preserved."
                })?;
                let state = State::from_value(v)?;
                // A recoverable copy is made once, before the native app's first mutation.
                let backup = directory.join("state.pre-tauri.json");
                if !backup.exists() {
                    std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
                }
                state
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut bytes = [0u8; 32];
                rand::fill(&mut bytes[..]);
                let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                let state = State {
                    version: 1,
                    account_id: String::new(),
                    notes: vec![],
                    mmr: vec![],
                    token,
                    native_roster_reader: Some(Reader::Off),
                    shortcuts: None,
                    close_to_tray: None,
                    auto_hide: None,
                    keys_over_game: None,
                    update_check: None,
                    skipped_version: None,
                    rating_snapshots: None,
                    profile_accounts: None,
                    hidden_profiles: None,
                    other: Default::default(),
                };
                write_state(&path, &state)?;
                state
            }
            Err(e) => return Err(format!("Could not read state.json: {e}")),
        };
        if state.native_roster_reader.is_none() {
            state.native_roster_reader = Some(Reader::Off);
            write_state(&path, &state)?;
        }
        if state.shortcuts.is_none() {
            state.shortcuts = Some(default_shortcut_map());
            write_state(&path, &state)?;
        }
        let matches = open_matches(&directory.join("matches.json"))?;
        if migrate_notes(&mut state, &matches) {
            write_state(&path, &state)?;
        }
        Ok(Self {
            directory,
            state,
            own: None,
            matches,
            revision: 0,
            journal_revision: 0,
            medal: None,
        })
    }
    pub fn public(&self) -> Value {
        self.public_for_account(&self.state.account_id)
    }
    pub fn profile_account(&self, input: &str) -> Result<Value> {
        Ok(self.public_for_account(&account_id(input)?))
    }
    fn public_for_account(&self, id: &str) -> Value {
        let state = &self.state;
        let entries: Vec<&MmrEntry> = state
            .mmr
            .iter()
            .filter(|m| m.account_id.as_deref() == Some(id))
            .collect();
        let unassigned = state.mmr.iter().filter(|m| m.account_id.is_none()).count();
        let snapshot = state
            .rating_snapshots
            .as_ref()
            .and_then(|rows| rows.get(id));
        let mut accounts = Vec::<String>::new();
        let hidden: Vec<&str> = state
            .hidden_profiles
            .iter()
            .flatten()
            .map(String::as_str)
            .collect();
        let candidates = state
            .profile_accounts
            .iter()
            .flatten()
            .map(String::as_str)
            .chain(
                state
                    .rating_snapshots
                    .iter()
                    .flat_map(|rows| rows.keys().map(String::as_str)),
            )
            .chain(state.mmr.iter().filter_map(|row| row.account_id.as_deref()))
            .chain(std::iter::once(state.account_id.as_str()));
        for candidate in candidates {
            if !candidate.is_empty()
                && !hidden.contains(&candidate)
                && !accounts.iter().any(|old| old == candidate)
            {
                accounts.push(candidate.to_owned());
            }
        }
        json!({"revision":self.revision,"accountId": id, "notes":state.notes, "mmr":entries,"unassignedMmrCount":unassigned,"ownAccount":self.own,"ratingSnapshot":snapshot,"profileAccounts":accounts,"nativeRosterReader":state.native_roster_reader,"closeToTray":self.close_to_tray(),"autoHide":self.auto_hide(),"keysOverGame":self.keys_over_game(),"updateCheck":self.update_check(),"skippedVersion":state.skipped_version,"shortcuts":self.shortcuts(),"recordedMatches":self.recorded(id).len(),"journalRevision":self.journal_revision})
    }
    /// The stored bindings, with defaults for any key an older state file did not have.
    pub fn shortcuts(&self) -> Value {
        let mut merged = default_shortcuts();
        for (name, value) in self.state.shortcuts.iter().flatten() {
            if SHORTCUT_NAMES.contains(&name.as_str()) {
                merged[name] = json!(value);
            }
        }
        merged
    }
    /// The window close button hides to the tray unless the user turned it off (absent = on).
    pub fn close_to_tray(&self) -> bool {
        self.state.close_to_tray.unwrap_or(true)
    }
    /// Both windows hide when the user activates another application (absent = on).
    pub fn auto_hide(&self) -> bool {
        self.state.auto_hide.unwrap_or(true)
    }
    /// While the game runs, the window keys listen only over it and this app (absent = on).
    pub fn keys_over_game(&self) -> bool {
        self.state.keys_over_game.unwrap_or(true)
    }
    /// Whether the app asks GitHub for new releases (absent = on).
    pub fn update_check(&self) -> bool {
        self.state.update_check.unwrap_or(true)
    }
    /// The single user consent for every Dota memory reader (Linux roster, Windows rating).
    pub fn memory_reader(&self) -> bool {
        self.state.reader() == Reader::On
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
        let mut next: Option<State> = None;
        let mut measured: Option<String> = None;
        if let Some(id) = &observation.account_id {
            let id = account_id(id)?;
            if self.state.account_id != id {
                next.get_or_insert_with(|| self.state.clone()).account_id = id.clone();
            }
            if observation.status == "measured" {
                if let (Some(value), Some(confidence)) = (observation.mmr, observation.confidence) {
                    if value == 0 || value > 20000 || !(30..=100).contains(&confidence) {
                        return Err("Invalid rating measurement".into());
                    }
                    // Confidence decays with time alone, so only a new MMR is a journal entry.
                    let last = self.state.mmr.iter().rev().find(|m| {
                        m.account_id.as_deref() == Some(id.as_str())
                            && m.source.as_deref() == Some("dota-memory")
                    });
                    if last.is_none_or(|m| m.value != u64::from(value)) {
                        next.get_or_insert_with(|| self.state.clone())
                            .mmr
                            .push(MmrEntry {
                                id: uuid::Uuid::new_v4().to_string(),
                                account_id: Some(id.clone()),
                                value: value.into(),
                                confidence: Some(confidence.into()),
                                source: Some("dota-memory".into()),
                                created_at: observation.observed_at.clone(),
                                other: Default::default(),
                            });
                        measured = Some(id.clone());
                    }
                }
            }
            if let Some(snapshot) = snapshot(&observation) {
                snapshot.check()?;
                let stored = self
                    .state
                    .rating_snapshots
                    .as_ref()
                    .and_then(|rows| rows.get(&id));
                let same = stored.is_some_and(|stored| stored.same_reading(&snapshot));
                // Equal values only refresh the time, at most every ten minutes, so an open
                // game does not rewrite state.json on every poll.
                let recent = stored
                    .and_then(|stored| {
                        chrono::DateTime::parse_from_rfc3339(&stored.confirmed_at).ok()
                    })
                    .is_some_and(|at| {
                        chrono::Utc::now().signed_duration_since(at) < chrono::Duration::minutes(10)
                    });
                if !same || !recent {
                    next.get_or_insert_with(|| self.state.clone())
                        .rating_snapshots
                        .get_or_insert_with(Default::default)
                        .insert(id.clone(), snapshot);
                }
            }
        }
        let changed = next.is_some();
        if let Some(next) = next {
            write_state(&self.directory.join("state.json"), &next)?;
            self.state = next;
        }
        // A new rating may be the result of the last recorded match.
        if let Some(id) = measured {
            let mut matches = self.matches.clone();
            if crate::journal::attribute(&mut matches, &self.mmr_rows(), &id) {
                self.save_matches(matches)?;
            }
        }
        self.own = Some(observation);
        self.revision += 1;
        Ok(changed)
    }
    pub fn token(&self) -> String {
        self.state.token.clone()
    }
    pub fn export(&self) -> Value {
        // Include all accounts and legacy unassigned records, without the GSI secret.
        let state = &self.state;
        json!({"accountId":state.account_id,"notes":state.notes,"mmr":state.mmr,"ratingSnapshots":state.rating_snapshots,"profileAccounts":state.profile_accounts,"hiddenProfiles":state.hidden_profiles,"nativeRosterReader":state.native_roster_reader,"matches":self.matches})
    }
    /// The rating entries in the shape the match journal reads.
    fn mmr_rows(&self) -> Vec<Value> {
        self.state.mmr.iter().map(|entry| json!(entry)).collect()
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
        let account = row["accountId"]
            .as_str()
            .ok_or("Invalid match record")?
            .to_owned();
        let entries = self.mmr_rows();
        crate::journal::baseline(&mut row, &entries);
        let mut matches = self.matches.clone();
        matches.push(row);
        crate::journal::attribute(&mut matches, &entries, &account);
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
        let mut next = self.state.clone();
        match command {
            "state:reader" => {
                next.native_roster_reader = Some(match args["value"].as_str() {
                    Some("off") => Reader::Off,
                    Some("on") => Reader::On,
                    _ => return Err("Invalid Dota memory reading setting".into()),
                });
            }
            "state:tray" => {
                next.close_to_tray = Some(
                    args["value"]
                        .as_bool()
                        .ok_or("Invalid close-to-tray setting")?,
                );
            }
            "state:auto-hide" => {
                next.auto_hide = Some(args["value"].as_bool().ok_or("Invalid auto-hide setting")?);
            }
            "state:keys-over-game" => {
                next.keys_over_game = Some(
                    args["value"]
                        .as_bool()
                        .ok_or("Invalid shortcut scope setting")?,
                );
            }
            "state:update-check" => {
                next.update_check = Some(
                    args["value"]
                        .as_bool()
                        .ok_or("Invalid update check setting")?,
                );
            }
            // The notice stays away for this version only; a newer one shows again.
            "state:skip-version" => {
                let version = args["version"]
                    .as_str()
                    .and_then(crate::releases::version)
                    .ok_or("Invalid version")?;
                next.skipped_version = Some(crate::releases::format(version));
            }
            "state:shortcuts" => {
                let merged = validate_shortcuts(&args["shortcuts"])?;
                next.shortcuts =
                    Some(serde_json::from_value(merged).map_err(|_| "Invalid shortcut settings")?);
            }
            "state:add-profile" => {
                let id = account_id(args["id"].as_str().unwrap_or(""))?;
                // Adding an account that was removed from the menu shows it again.
                if let Some(hidden) = &mut next.hidden_profiles {
                    hidden.retain(|old| old != &id);
                }
                let rows = next.profile_accounts.get_or_insert_with(Vec::new);
                if !rows.contains(&id) {
                    if rows.len() >= 32 {
                        return Err("Up to 32 saved profiles are supported".into());
                    }
                    rows.push(id);
                }
            }
            "state:remove-profile" => {
                let id = account_id(args["id"].as_str().unwrap_or(""))?;
                // The game's account stays in the menu; its key and the header icon rely on it.
                if next.account_id == id {
                    return Err("The current account cannot be removed".into());
                }
                // Removing hides the entry; readings, notes and matches are kept.
                if let Some(rows) = &mut next.profile_accounts {
                    rows.retain(|old| old != &id);
                }
                // Only IDs the menu would still derive from saved readings need remembering;
                // the rest are dropped, so the list stays as small as the data it filters.
                let derived: std::collections::HashSet<String> = next
                    .rating_snapshots
                    .iter()
                    .flat_map(|rows| rows.keys().cloned())
                    .chain(next.mmr.iter().filter_map(|row| row.account_id.clone()))
                    .collect();
                let hidden = next.hidden_profiles.get_or_insert_with(Vec::new);
                hidden.retain(|old| derived.contains(old));
                if derived.contains(&id) && !hidden.contains(&id) {
                    if hidden.len() >= MAX_HIDDEN_PROFILES {
                        return Err(format!(
                            "Up to {MAX_HIDDEN_PROFILES} removed profiles are remembered"
                        ));
                    }
                    hidden.push(id);
                }
            }
            "state:account" => next.account_id = account_id(args["id"].as_str().unwrap_or(""))?,
            // A note is added on top of the player's earlier ones, never in their place.
            "note:add" => {
                let input = &args["note"];
                let id = account_id(input["accountId"].as_str().unwrap_or(""))?;
                // The same words as SELF_NOTE in NoteEditor.tsx.
                if next.account_id == id {
                    return Err("Why would you need a note about yourself? Everybody knows you are the best.".into());
                }
                let name = input["name"]
                    .as_str()
                    .map(str::trim)
                    .filter(|name| name.chars().count() <= 80)
                    .ok_or("Invalid note")?;
                let text = input["text"].as_str().unwrap_or("").trim();
                if text.is_empty() {
                    return Err("Write a note.".into());
                }
                // Absent or null is no link; anything else must have the field's type.
                let field = |key: &str| Some(&input[key]).filter(|value| !value.is_null());
                let number = |key: &str| {
                    field(key)
                        .map(|value| value.as_u64().ok_or("Invalid note"))
                        .transpose()
                };
                let entry = NoteEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    text: text.to_owned(),
                    at: now(),
                    edited_at: None,
                    match_id: number("matchId")?,
                    hero_id: number("heroId")?,
                    ally: field("ally")
                        .map(|value| value.as_bool().ok_or("Invalid note"))
                        .transpose()?,
                    other: Default::default(),
                };
                entry.check()?;
                let mut note = match next.notes.iter().position(|n| n.account_id == id) {
                    Some(index) => next.notes.remove(index),
                    None => Note {
                        account_id: id,
                        name: String::new(),
                        entries: Some(vec![]),
                        text: None,
                        tag: None,
                        updated_at: String::new(),
                        other: Default::default(),
                    },
                };
                if !name.is_empty() {
                    note.name = name.to_owned();
                }
                let entries = note.entries_mut();
                if entries.len() >= MAX_NOTE_ENTRIES {
                    return Err(format!(
                        "Up to {MAX_NOTE_ENTRIES} notes per player are kept"
                    ));
                }
                entries.insert(0, entry);
                note.touch();
                next.notes.insert(0, note);
            }
            "note:edit" => {
                let (note, index) = note_entry(&mut next, args)?;
                let text = args["text"].as_str().unwrap_or("").trim();
                if text.is_empty() {
                    return Err("Write a note.".into());
                }
                let entry = &mut note.entries_mut()[index];
                entry.text = text.to_owned();
                entry.edited_at = Some(now());
                entry.check()?;
                note.touch();
            }
            "note:delete-entry" => {
                let (note, index) = note_entry(&mut next, args)?;
                note.entries_mut().remove(index);
                if note.entries_mut().is_empty() {
                    let id = note.account_id.clone();
                    next.notes.retain(|n| n.account_id != id);
                } else {
                    note.touch();
                }
            }
            // Every note about the player.
            "note:delete" => {
                let id = account_id(args["id"].as_str().unwrap_or(""))?;
                next.notes.retain(|n| n.account_id != id);
            }
            "mmr:add" => {
                let id = account_id(&next.account_id)?;
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
                next.mmr.push(MmrEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    account_id: Some(id),
                    value,
                    confidence: None,
                    source: Some("manual".into()),
                    created_at: now(),
                    other: Default::default(),
                });
            }
            "mmr:delete" => {
                let id = args["id"].as_str().ok_or("Invalid entry ID")?;
                uuid::Uuid::parse_str(id).map_err(|_| "Invalid entry ID")?;
                // Only the current account's entries are listed, so only they can be deleted;
                // other accounts' and unassigned legacy entries stay untouched.
                let account = next.account_id.clone();
                let before = next.mmr.len();
                next.mmr
                    .retain(|n| n.id != id || n.account_id.as_deref() != Some(account.as_str()));
                if next.mmr.len() == before {
                    return Err("Entry not found".into());
                }
            }
            _ => return Err("Unknown operation".into()),
        }
        write_state(&self.directory.join("state.json"), &next)?;
        self.state = next;
        self.revision += 1;
        Ok(self.public())
    }
    /// The saved state as written to disk.
    #[cfg(test)]
    fn data(&self) -> Value {
        self.state.to_value()
    }
    /// Replaces the saved state in memory only, as a test fixture.
    #[cfg(test)]
    fn set_data(&mut self, value: Value) {
        self.state = State::from_value(value).unwrap();
    }
}
/// Writes the state in the file's established shape: through `Value`, so keys keep their
/// sorted order and the bytes match what earlier versions wrote.
fn write_state(path: &Path, state: &State) -> Result<()> {
    atomic_json(path, &state.to_value())
}
/// Loads the match journal. An unreadable file is set aside under a new name instead of
/// blocking the app or being overwritten by the next recorded match.
fn open_matches(path: &Path) -> Result<Vec<Value>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Could not read matches.json: {e}")),
    };
    let parsed = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .filter(|v| v["version"] == 1)
        .and_then(|mut v| match v["matches"].take() {
            Value::Array(rows) => Some(rows),
            _ => None,
        })
        .filter(|rows| rows.iter().all(|row| crate::journal::validate(row).is_ok()));
    match parsed {
        Some(rows) => Ok(rows),
        None => {
            let aside = path.with_file_name(format!(
                "matches.unreadable-{}.json",
                chrono::Utc::now().format("%Y%m%dT%H%M%S")
            ));
            std::fs::rename(path, &aside).map_err(|e| e.to_string())?;
            crate::log_line!(
                "matches.json was unreadable and has been kept as {}",
                aside.display()
            );
            Ok(vec![])
        }
    }
}
/// The note `args` names by player and note ID, and its place among the player's notes.
fn note_entry<'a>(state: &'a mut State, args: &Value) -> Result<(&'a mut Note, usize)> {
    let id = account_id(args["accountId"].as_str().unwrap_or(""))?;
    let entry = args["entryId"].as_str().ok_or("Invalid note")?;
    let note = state
        .notes
        .iter_mut()
        .find(|n| n.account_id == id)
        .ok_or("Note not found")?;
    let index = note
        .entries
        .as_ref()
        .and_then(|rows| rows.iter().position(|row| row.id == entry))
        .ok_or("Note not found")?;
    Ok((note, index))
}
/// Turns each note of an older version into the first note of its player, linked to the
/// recorded match it was written during or shortly after. Returns whether anything changed.
fn migrate_notes(state: &mut State, matches: &[Value]) -> bool {
    let mut changed = false;
    for note in state.notes.iter_mut().filter(|note| note.entries.is_none()) {
        let at = note.updated_at.clone();
        let mut entry = NoteEntry {
            id: uuid::Uuid::new_v4().to_string(),
            text: note.text.clone().unwrap_or_default(),
            at: at.clone(),
            edited_at: None,
            match_id: None,
            hero_id: None,
            ally: None,
            other: Default::default(),
        };
        if let Ok(written) = chrono::DateTime::parse_from_rfc3339(&at).map(|t| t.timestamp()) {
            if let Some((match_id, hero, ally)) = note_match(&note.account_id, written, matches) {
                entry.match_id = Some(match_id);
                entry.hero_id = hero;
                entry.ally = Some(ally);
            }
        }
        note.entries = Some(vec![entry]);
        note.tag = Some("neutral".into());
        changed = true;
    }
    changed
}
/// The recorded match a note about `account` written at `written` (Unix seconds) belongs
/// to: the player was in it, and the note came during the match or shortly after its end.
/// Returns the match ID, the player's hero when known, and whether they were an ally.
fn note_match(account: &str, written: i64, matches: &[Value]) -> Option<(u64, Option<u64>, bool)> {
    let id = account.parse::<u64>().ok()?;
    matches
        .iter()
        .filter_map(|m| {
            let start = m["start_time"].as_i64()?;
            let end = start + m["duration"].as_i64().unwrap_or(0);
            if written < start || written > end + NOTE_AFTER_MATCH {
                return None;
            }
            let side = |key: &str| {
                m[key]
                    .as_array()
                    .and_then(|rows| rows.iter().find(|p| p["id"] == id))
                    .map(|p| p["hero"].as_u64())
            };
            let found = if let Some(hero) = side("allies") {
                Some((hero, true))
            } else if let Some(hero) = side("enemies") {
                Some((hero, false))
            } else {
                let radiant = m["player_slot"].as_u64().map(|slot| slot < 128);
                m["lineup"]
                    .as_array()
                    .and_then(|rows| rows.iter().find(|p| p["id"] == id))
                    .and_then(|p| {
                        Some((p["hero_id"].as_u64(), p["radiant"].as_bool()? == radiant?))
                    })
            }?;
            Some((end, m["match_id"].as_u64()?, found))
        })
        // The match that ended closest to the note.
        .min_by_key(|(end, _, _)| (written - end).abs())
        .map(|(_, match_id, (hero, ally))| (match_id, hero, ally))
}
/// The last confirmed reading kept for display while Dota is closed; never a live value.
fn snapshot(observation: &crate::own_account::Observation) -> Option<RatingSnapshot> {
    if !["measured", "calibrating"].contains(&observation.status.as_str()) {
        return None;
    }
    Some(RatingSnapshot {
        mmr: observation.mmr.map(u64::from),
        confidence: observation.confidence?.into(),
        behavior_score: observation.behavior_score?.into(),
        communication_score: observation.communication_score?.into(),
        confirmed_at: observation.observed_at.clone(),
        other: Default::default(),
    })
}
/// Checks a whole state file as `Store::open` does.
#[cfg(test)]
fn validate(v: &Value) -> Result<()> {
    State::from_value(v.clone()).map(|_| ())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_defaults_off_and_migrates_without_losing_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().into()).unwrap();
        assert_eq!(store.public()["nativeRosterReader"], "off");
        let mut legacy = store.data();
        legacy.as_object_mut().unwrap().remove("nativeRosterReader");
        legacy["accountId"] = json!("123");
        atomic_json(&dir.path().join("state.json"), &legacy).unwrap();
        let mut migrated = Store::open(dir.path().into()).unwrap();
        assert_eq!(migrated.public()["nativeRosterReader"], "off");
        assert_eq!(migrated.public()["accountId"], "123");
        assert_eq!(migrated.data()["token"], legacy["token"]);
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
        let mut legacy = store.data();
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
            let mut invalid = reopened.data();
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
            let mut invalid = reopened.data();
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
            let mut invalid = reopened.data();
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
            let mut invalid = reopened.data();
            invalid["skippedVersion"] = version;
            assert!(validate(&invalid).is_err());
        }
        assert!(reopened
            .change("state:update-check", &json!({"value":"on"}))
            .is_err());
        let mut invalid = reopened.data();
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
            "note:add",
            &json!({"note":{"accountId":"123","name":"Test","text":"keep"}}),
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
        let note = |id: &str| json!({"note":{"accountId":id,"name":"Me","text":"best"}});
        assert!(s
            .change("note:add", &note("123"))
            .unwrap_err()
            .contains("note about yourself"));
        s.change("note:add", &note("456")).unwrap();
        assert_eq!(s.public()["notes"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn notes_are_added_on_top_and_edited_or_deleted_one_by_one() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let add = |text: &str, extra: Value| {
            let mut note = json!({"accountId":"456","name":"Kestrel","text":text});
            for (key, value) in extra.as_object().unwrap() {
                note[key] = value.clone();
            }
            json!({ "note": note })
        };
        s.change("note:add", &add("good support", json!({})))
            .unwrap();
        let state = s
            .change(
                "note:add",
                &add(
                    " tilted today ",
                    json!({"matchId":9077798618u64,"heroId":100,"ally":true}),
                ),
            )
            .unwrap();
        let note = &state["notes"][0];
        let entries = note["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2, "the earlier note stays");
        assert_eq!(
            (
                &entries[0]["text"],
                &entries[0]["matchId"],
                &entries[0]["heroId"],
                &entries[0]["ally"]
            ),
            (
                &json!("tilted today"),
                &json!(9077798618u64),
                &json!(100),
                &json!(true)
            )
        );
        assert!(entries[1].get("matchId").is_none());
        // Older versions read the newest note from these fields.
        assert_eq!(
            (&note["text"], &note["tag"]),
            (&json!("tilted today"), &json!("neutral"))
        );
        validate(&s.data()).unwrap();
        // An empty name keeps the one saved earlier.
        let state = s
            .change(
                "note:add",
                &json!({"note":{"accountId":"456","name":"","text":"third"}}),
            )
            .unwrap();
        assert_eq!(state["notes"][0]["name"], "Kestrel");
        for bad in [
            json!({"matchId":0}),
            json!({"heroId":"Tusk"}),
            json!({"ally":"yes"}),
        ] {
            assert!(s.change("note:add", &add("x", bad)).is_err());
        }
        assert_eq!(
            s.change("note:add", &add("   ", json!({}))).unwrap_err(),
            "Write a note."
        );
        let first = s.public()["notes"][0]["entries"][2]["id"].clone();
        let state = s
            .change(
                "note:edit",
                &json!({"accountId":"456","entryId":first,"text":"great support"}),
            )
            .unwrap();
        let edited = &state["notes"][0]["entries"][2];
        assert_eq!(edited["text"], "great support");
        assert!(edited["editedAt"].is_string());
        assert_eq!(
            state["notes"][0]["text"], "third",
            "the newest note is unchanged"
        );
        assert_eq!(
            s.change(
                "note:edit",
                &json!({"accountId":"456","entryId":"nope","text":"x"})
            )
            .unwrap_err(),
            "Note not found"
        );
        // Deleting the newest note shows the next one; deleting the last removes the player.
        let ids: Vec<Value> = s.public()["notes"][0]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].clone())
            .collect();
        let state = s
            .change(
                "note:delete-entry",
                &json!({"accountId":"456","entryId":ids[0]}),
            )
            .unwrap();
        assert_eq!(state["notes"][0]["text"], "tilted today");
        for id in &ids[1..] {
            s.change(
                "note:delete-entry",
                &json!({"accountId":"456","entryId":id}),
            )
            .unwrap();
        }
        assert!(s.public()["notes"].as_array().unwrap().is_empty());
        // The whole player at once.
        s.change("note:add", &add("again", json!({}))).unwrap();
        s.change("note:delete", &json!({"id":"456"})).unwrap();
        assert!(s.public()["notes"].as_array().unwrap().is_empty());
    }
    #[test]
    fn a_player_keeps_at_most_500_notes() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path().into()).unwrap();
        let entries: Vec<Value> = (0..MAX_NOTE_ENTRIES)
            .map(|_| json!({"id":uuid::Uuid::new_v4().to_string(),"text":"x","at":now()}))
            .collect();
        let mut data = s.data();
        data["notes"] = json!([{"accountId":"456","name":"","entries":entries,"text":"x","tag":"neutral","updatedAt":now()}]);
        validate(&data).unwrap();
        s.set_data(data);
        assert!(s
            .change(
                "note:add",
                &json!({"note":{"accountId":"456","name":"","text":"one more"}})
            )
            .unwrap_err()
            .contains("500"));
    }
    #[test]
    fn older_notes_become_the_first_note_linked_to_their_match() {
        let dir = tempfile::tempdir().unwrap();
        let live = json!({"mode":"player","status":"connected","matchId":"8012345678","gameState":"DOTA_GAMERULES_STATE_POST_GAME",
            "clock":2400,"winTeam":"dire","players":[{"key":"self","team":"dire","teamSlot":2,"accountId":"123","heroId":74,"kills":9}]});
        let mut row = crate::journal::record(&live, "2026-10-23T20:00:00.000Z").unwrap();
        row["allies"] = json!([{"id":456,"hero":7}]);
        row["lineup"] = json!([{"radiant":false,"own":true,"hero_id":74},{"radiant":true,"id":789,"hero_id":3}]);
        crate::journal::validate(&row).unwrap();
        let end = row["start_time"].as_i64().unwrap() + row["duration"].as_i64().unwrap();
        let at = |seconds: i64| {
            chrono::DateTime::from_timestamp(seconds, 0)
                .unwrap()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        };
        atomic_json(
            &dir.path().join("matches.json"),
            &json!({"version":1,"matches":[row]}),
        )
        .unwrap();
        let legacy = |id: &str, written: i64| json!({"accountId":id,"name":"P","text":"remember","tag":"avoid","updatedAt":at(written)});
        let mut state = Store::open(dir.path().into()).unwrap().data();
        state["notes"] = json!([
            legacy("456", end + 5 * 60),
            legacy("789", end - 600),
            legacy("456", end + 20 * 60),
            legacy("999", end),
        ]);
        state["notes"][2]["accountId"] = json!("457");
        atomic_json(&dir.path().join("state.json"), &state).unwrap();
        let s = Store::open(dir.path().into()).unwrap();
        let notes = s.public()["notes"].as_array().unwrap().clone();
        let entry = |i: usize| notes[i]["entries"][0].clone();
        // Written five minutes after the match, about an ally.
        assert_eq!(
            (&entry(0)["matchId"], &entry(0)["heroId"], &entry(0)["ally"]),
            (&json!(8012345678u64), &json!(7), &json!(true))
        );
        assert_eq!(
            (&entry(0)["text"], &entry(0)["at"]),
            (&json!("remember"), &json!(at(end + 5 * 60)))
        );
        assert_eq!(notes[0]["tag"], "neutral");
        // During the match, an enemy known only from the lineup.
        assert_eq!(
            (&entry(1)["matchId"], &entry(1)["heroId"], &entry(1)["ally"]),
            (&json!(8012345678u64), &json!(3), &json!(false))
        );
        // Another player, and a player not in the match, stay without a match.
        assert!(entry(2).get("matchId").is_none() && entry(3).get("matchId").is_none());
        validate(&s.data()).unwrap();
        // The migration is saved once and kept.
        let again = Store::open(dir.path().into()).unwrap();
        assert_eq!(again.public()["notes"], s.public()["notes"]);
    }
    #[test]
    fn fields_of_a_newer_version_survive_a_write_and_the_file_keeps_its_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let mut s = Store::open(dir.path().into()).unwrap();
        s.change("state:account", &json!({"id":"123"})).unwrap();
        s.change(
            "note:add",
            &json!({"note":{"accountId":"456","name":"P","text":"x","matchId":7,"ally":false}}),
        )
        .unwrap();
        s.change("mmr:add", &json!({"value":3000})).unwrap();
        s.change("state:tray", &json!({"value":true})).unwrap();
        let mut data = s.data();
        data["futureSetting"] = json!({"nested":[1, "two"]});
        data["notes"][0]["futureNote"] = json!(true);
        data["notes"][0]["entries"][0]["futureEntry"] = json!("kept");
        data["mmr"][0]["futureReading"] = json!(null);
        atomic_json(&path, &data).unwrap();
        let written = std::fs::read(&path).unwrap();
        // Setting a value it already has rewrites the file byte for byte.
        let mut s = Store::open(dir.path().into()).unwrap();
        s.change("state:tray", &json!({"value":true})).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), written);
        // A real change keeps every field this version does not know.
        s.change("state:tray", &json!({"value":false})).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["futureSetting"], json!({"nested":[1, "two"]}));
        assert_eq!(saved["notes"][0]["futureNote"], true);
        assert_eq!(saved["notes"][0]["entries"][0]["futureEntry"], "kept");
        assert!(saved["mmr"][0]
            .as_object()
            .unwrap()
            .contains_key("futureReading"));
        assert_eq!(saved["closeToTray"], false);
    }
    #[test]
    fn a_mistyped_field_is_a_load_error() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path().into()).unwrap();
        for (key, value) in [
            ("autoHide", json!("yes")),
            ("profileAccounts", json!(null)),
            (
                "notes",
                json!([{"accountId":"456","name":7,"updatedAt":"x"}]),
            ),
            ("mmr", json!([{"id":"a","value":-1,"createdAt":"x"}])),
        ] {
            let mut data = s.data();
            data[key] = value;
            atomic_json(&dir.path().join("state.json"), &data).unwrap();
            assert!(Store::open(dir.path().into()).is_err(), "{key}");
        }
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
    fn removed_profiles_are_remembered_only_while_needed_and_within_a_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        store.observe_account(measured("1", 3000)).unwrap();
        // An account added by hand has no readings: removing it just drops it from the list.
        store
            .change("state:add-profile", &json!({"id":"999"}))
            .unwrap();
        store
            .change("state:remove-profile", &json!({"id":"999"}))
            .unwrap();
        assert!(!store.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("999")));
        assert_eq!(store.data()["hiddenProfiles"], json!([]));
        // Many accounts with saved readings, all removed: the limit is an error, not a
        // state file that could no longer be opened.
        let mut data = store.data();
        let reading = data["mmr"][0].clone();
        assert_eq!(reading["accountId"], "1");
        for id in 2..=MAX_HIDDEN_PROFILES + 2 {
            let mut copy = reading.clone();
            copy["id"] = json!(uuid::Uuid::new_v4().to_string());
            copy["accountId"] = json!(id.to_string());
            data["mmr"].as_array_mut().unwrap().push(copy);
        }
        store.set_data(data);
        for id in 2..MAX_HIDDEN_PROFILES + 2 {
            store
                .change("state:remove-profile", &json!({"id":id.to_string()}))
                .unwrap();
        }
        let last = (MAX_HIDDEN_PROFILES + 2).to_string();
        assert!(store
            .change("state:remove-profile", &json!({"id":last}))
            .unwrap_err()
            .contains("removed profiles"));
        assert_eq!(
            Store::open(dir.path().into()).unwrap().data()["hiddenProfiles"]
                .as_array()
                .unwrap()
                .len(),
            MAX_HIDDEN_PROFILES
        );
        // A hand-edited file over the limit is rejected like other corrupt lists.
        let mut over = store.data();
        over["hiddenProfiles"]
            .as_array_mut()
            .unwrap()
            .push(json!(last));
        assert!(validate(&over).is_err());
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
    fn browsing_and_adding_profiles_preserves_the_active_account_and_scopes_ratings() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        store.observe_account(measured("123", 6586)).unwrap();
        store.observe_account(measured("456", 3000)).unwrap();
        let current = store.public();
        store
            .change("state:add-profile", &json!({"id":"789"}))
            .unwrap();
        assert_eq!(store.public()["accountId"], "456");
        assert!(store.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("789")));
        let other = store.profile_account("123").unwrap();
        assert_eq!(other["mmr"][0]["value"], 6586);
        assert_eq!(other["ownAccount"]["accountId"], "456");
        assert_eq!(store.public()["mmr"], current["mmr"]);
        assert_eq!(store.profile_account("789").unwrap()["mmr"], json!([]));
        assert!(store.profile_account("789").unwrap()["ratingSnapshot"].is_null());
        let reopened = Store::open(dir.path().into()).unwrap();
        assert_eq!(reopened.public()["accountId"], "456");
        assert!(reopened.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("789")));
    }
    #[test]
    fn removing_a_saved_profile_hides_it_and_keeps_its_data() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().into()).unwrap();
        store.observe_account(measured("456", 3000)).unwrap();
        store.observe_account(measured("123", 6586)).unwrap();
        assert!(store.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("456")));
        store
            .change("state:remove-profile", &json!({"id":"456"}))
            .unwrap();
        assert!(!store.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("456")));
        // The game's current account cannot leave the menu.
        assert!(store
            .change("state:remove-profile", &json!({"id":"123"}))
            .is_err());
        // Readings stay available for the hidden account.
        assert_eq!(
            store.profile_account("456").unwrap()["mmr"][0]["value"],
            3000
        );
        // The choice survives a restart, and adding the ID again brings the entry back.
        let reopened = Store::open(dir.path().into()).unwrap();
        assert!(!reopened.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("456")));
        drop(reopened);
        store
            .change("state:add-profile", &json!({"id":"456"}))
            .unwrap();
        assert!(store.public()["profileAccounts"]
            .as_array()
            .unwrap()
            .contains(&json!("456")));
    }
    #[test]
    fn legacy_rating_is_preserved_without_guessing_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(dir.path().into()).unwrap();
        let mut legacy = s.data();
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
