//! The typed contents of `state.json`. The file format is unchanged: the same camelCase
//! names, the same values, and fields an older version did not write stay absent until they
//! are set. Fields this version does not know are kept in `other` and written back, so a
//! newer file opened by an older version keeps its data.
use super::{account_id, validate_shortcuts, Result, MAX_HIDDEN_PROFILES, MAX_NOTE_ENTRIES};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const INVALID: &str = "Unrecognized state.json format; the original has been preserved.";

/// For optional fields that may be absent but never `null`: absent is `None` through
/// `#[serde(default)]`, a present value must have the field's type.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reader {
    Off,
    On,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub version: u64,
    pub account_id: String,
    pub notes: Vec<Note>,
    pub mmr: Vec<MmrEntry>,
    pub token: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub native_roster_reader: Option<Reader>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub shortcuts: Option<BTreeMap<String, String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub close_to_tray: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub auto_hide: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub keys_over_game: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub update_check: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub skipped_version: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub rating_snapshots: Option<BTreeMap<String, RatingSnapshot>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub profile_accounts: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub hidden_profiles: Option<Vec<String>>,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

/// A player's notes, newest first. `text`, `tag` and `updatedAt` repeat the newest note
/// in the shape older versions read, so going back to one keeps the state file readable.
/// A note of an older version has no `entries` until it is migrated on open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub account_id: String,
    pub name: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub entries: Option<Vec<NoteEntry>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub text: Option<String>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub tag: Option<String>,
    pub updated_at: String,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    pub id: String,
    pub text: String,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hero_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ally: Option<bool>,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

/// One rating reading. Entries of early versions have no `accountId`; they are kept
/// unassigned rather than guessed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MmrEntry {
    pub id: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub account_id: Option<String>,
    pub value: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub created_at: String,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

/// The last confirmed reading kept for display while Dota is closed; never a live value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingSnapshot {
    /// `null` while the account calibrates.
    #[serde(default)]
    pub mmr: Option<u64>,
    pub confidence: u64,
    pub behavior_score: u64,
    pub communication_score: u64,
    pub confirmed_at: String,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

impl State {
    /// Parses and checks a whole state file.
    pub fn from_value(value: Value) -> Result<Self> {
        let state: State = serde_json::from_value(value).map_err(|_| INVALID)?;
        state.check()?;
        Ok(state)
    }

    /// The file as written to disk and compared in tests: keys in the same order as before.
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("state serializes")
    }

    pub fn reader(&self) -> Reader {
        self.native_roster_reader.unwrap_or(Reader::Off)
    }

    fn check(&self) -> Result<()> {
        let token_ok = self.token.len() == 64
            && self
                .token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if self.version != 1 || !token_ok {
            return Err(INVALID.into());
        }
        if self
            .skipped_version
            .as_deref()
            .is_some_and(|v| crate::releases::version(v).is_none())
        {
            return Err(INVALID.into());
        }
        if let Some(shortcuts) = &self.shortcuts {
            validate_shortcuts(&serde_json::to_value(shortcuts).map_err(|_| INVALID)?)
                .map_err(|_| INVALID)?;
        }
        for (id, snapshot) in self.rating_snapshots.iter().flatten() {
            account_id(id)?;
            snapshot.check().map_err(|_| INVALID)?;
        }
        if let Some(accounts) = &self.profile_accounts {
            unique_ids(accounts, 32)?;
        }
        if let Some(hidden) = &self.hidden_profiles {
            unique_ids(hidden, MAX_HIDDEN_PROFILES)?;
        }
        for note in &self.notes {
            note.check()?;
        }
        for entry in &self.mmr {
            if let Some(id) = &entry.account_id {
                account_id(id)?;
            }
            if entry.value > 20000 {
                return Err(INVALID.into());
            }
        }
        Ok(())
    }
}

/// Canonical account IDs, each once, at most `limit` of them.
fn unique_ids(ids: &[String], limit: usize) -> Result<()> {
    if ids.len() > limit {
        return Err(INVALID.into());
    }
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        if account_id(id)? != *id || !seen.insert(id) {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

impl Note {
    pub fn check(&self) -> Result<()> {
        account_id(&self.account_id)?;
        let invalid = || Err("Invalid note".into());
        if self.name.trim().chars().count() > 80 {
            return invalid();
        }
        let Some(entries) = &self.entries else {
            // A note of an older version, migrated on open.
            let text = self.text.as_deref().unwrap_or("").trim();
            if text.is_empty()
                || text.chars().count() > 2000
                || !["neutral", "teammate", "avoid"].contains(&self.tag.as_deref().unwrap_or(""))
            {
                return invalid();
            }
            return Ok(());
        };
        if entries.is_empty() || entries.len() > MAX_NOTE_ENTRIES {
            return invalid();
        }
        for entry in entries {
            entry.check()?;
        }
        Ok(())
    }

    /// The entries of a migrated note; empty for a note of an older version.
    pub fn entries_mut(&mut self) -> &mut Vec<NoteEntry> {
        self.entries.get_or_insert_with(Vec::new)
    }

    /// Repeats the newest note in the fields older versions read.
    pub fn touch(&mut self) {
        self.text = self
            .entries
            .as_ref()
            .and_then(|rows| rows.first())
            .map(|entry| entry.text.clone());
        self.tag = Some("neutral".into());
        self.updated_at = super::now();
    }
}

impl NoteEntry {
    pub fn check(&self) -> Result<()> {
        let text = |s: &str, max: usize| !s.trim().is_empty() && s.trim().chars().count() <= max;
        let valid = uuid::Uuid::parse_str(&self.id).is_ok()
            && text(&self.text, 2000)
            && text(&self.at, 40)
            && self.edited_at.as_deref().is_none_or(|s| text(s, 40))
            && self.match_id.is_none_or(|id| id > 0)
            && self.hero_id.is_none_or(|id| (1..=1000).contains(&id));
        if valid {
            Ok(())
        } else {
            Err("Invalid note".into())
        }
    }
}

impl RatingSnapshot {
    pub fn check(&self) -> Result<()> {
        if self.mmr.is_some_and(|m| !(1..=20000).contains(&m))
            || self.confidence > 100
            || self.behavior_score > 12000
            || self.communication_score > 12000
        {
            return Err("Invalid rating snapshot".into());
        }
        Ok(())
    }

    /// Whether two readings show the same values, whenever they were confirmed.
    pub fn same_reading(&self, other: &RatingSnapshot) -> bool {
        (
            self.mmr,
            self.confidence,
            self.behavior_score,
            self.communication_score,
        ) == (
            other.mmr,
            other.confidence,
            other.behavior_score,
            other.communication_score,
        )
    }
}
