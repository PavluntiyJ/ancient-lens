//! Typed arguments of the page's commands.
use crate::store::Result;
use serde::{de::DeserializeOwned, Deserialize, Deserializer};
use serde_json::{json, Value};

/// Reads a command's arguments into its struct. Arguments that are not an object read as
/// an empty one, as indexing them did before.
pub(super) fn parse<T: DeserializeOwned>(args: &Value) -> Result<T> {
    let empty = json!({});
    let args = if args.is_object() { args } else { &empty };
    T::deserialize(args).map_err(|_| "Invalid arguments".into())
}

/// A field that is missing, null or of another type reads as `None`, so each command keeps
/// its own default or its own error message for it. Use with `#[serde(default)]`.
pub(super) fn lenient<'de, D, T>(field: D) -> std::result::Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(T::deserialize(Value::deserialize(field)?).ok())
}

/// Commands that take one account or match ID as a string.
#[derive(Deserialize)]
pub(super) struct Id {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
}
impl Id {
    /// The ID, or an empty string that the command's own validation rejects.
    pub(super) fn id(&self) -> &str {
        self.id.as_deref().unwrap_or("")
    }
}

/// Commands that take a list of hero IDs and, for some, a rank bracket.
#[derive(Deserialize)]
pub(super) struct Heroes {
    #[serde(default, deserialize_with = "lenient")]
    ids: Option<Vec<u64>>,
    #[serde(default, deserialize_with = "lenient")]
    bracket: Option<String>,
}
impl Heroes {
    pub(super) fn ids(&self) -> Result<&[u64]> {
        Ok(self.ids.as_deref().ok_or("Invalid heroes")?)
    }
    pub(super) fn bracket(&self) -> &str {
        self.bracket.as_deref().unwrap_or("ALL")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Sample {
        #[serde(default, deserialize_with = "lenient")]
        hero_id: Option<u64>,
        #[serde(default, deserialize_with = "lenient")]
        on: Option<bool>,
    }

    #[test]
    fn wrong_or_missing_fields_read_as_none() {
        let read = |args: Value| parse::<Sample>(&args).unwrap();
        let sample = read(json!({"heroId": 5, "on": true}));
        assert_eq!((sample.hero_id, sample.on), (Some(5), Some(true)));
        for args in [
            json!({}),
            json!({"heroId": "5", "on": 1}),
            json!({"heroId": -1, "on": null}),
            json!({"heroId": 5.5}),
            json!(null),
            json!([1, 2]),
        ] {
            let sample = read(args);
            assert_eq!((sample.hero_id, sample.on), (None, None));
        }
    }

    #[test]
    fn ids_and_brackets_keep_their_defaults_and_errors() {
        let id = parse::<Id>(&json!({"id": 7})).unwrap();
        assert_eq!(id.id(), "");
        let heroes = parse::<Heroes>(&json!({"ids": [1, 2]})).unwrap();
        assert_eq!(
            (heroes.ids().unwrap(), heroes.bracket()),
            (&[1, 2][..], "ALL")
        );
        let heroes = parse::<Heroes>(&json!({"ids": [1, "2"], "bracket": "DIVINE"})).unwrap();
        assert_eq!(heroes.ids().unwrap_err().to_string(), "Invalid heroes");
        assert_eq!(heroes.bracket(), "DIVINE");
    }
}
