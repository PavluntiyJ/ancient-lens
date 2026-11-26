use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::fmt;

const MAX_DEPTH: usize = 32;
const MAX_VALUES: usize = 16_384;

pub(super) fn parse(body: &[u8]) -> serde_json::Result<Value> {
    let mut json = serde_json::Deserializer::from_slice(body);
    let mut remaining = MAX_VALUES;
    let value = PacketValue {
        depth: 0,
        remaining: &mut remaining,
    }
    .deserialize(&mut json)?;
    json.end()?;
    Ok(value)
}

// The HTTP body limit caps string and key bytes. Charge each value before
// building it, including values in unknown fields and duplicate object entries.
struct PacketValue<'a> {
    depth: usize,
    remaining: &'a mut usize,
}

impl PacketValue<'_> {
    fn child(&mut self) -> PacketValue<'_> {
        PacketValue {
            depth: self.depth + 1,
            remaining: self.remaining,
        }
    }
}

impl<'de> DeserializeSeed<'de> for PacketValue<'_> {
    type Value = Value;

    fn deserialize<D: de::Deserializer<'de>>(self, json: D) -> Result<Value, D::Error> {
        if self.depth > MAX_DEPTH {
            return Err(de::Error::custom("GSI packet is too deeply nested"));
        }
        *self.remaining = self
            .remaining
            .checked_sub(1)
            .ok_or_else(|| de::Error::custom("GSI packet has too many values"))?;
        json.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for PacketValue<'_> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value within the GSI packet limits")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| de::Error::custom("Invalid JSON number"))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut entries: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = entries.next_element_seed(self.child())? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(mut self, mut entries: A) -> Result<Value, A::Error> {
        let mut values = Map::new();
        while let Some(key) = entries.next_key()? {
            values.insert(key, entries.next_value_seed(self.child())?);
        }
        Ok(Value::Object(values))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_optional_fields_and_json_types() {
        let packet = br#"{
            "auth":{"token":"fixture"},"provider":{"appid":570},
            "map":{"matchid":18446744073709551615,"clock_time":-32},
            "hero":{"name":"Crystal\u0020Maiden","mana":2.5},
            "draft":{"picks":[null,{"id":5}],"active":true},
            "new_field":{"present":false}
        }"#;
        assert_eq!(
            parse(packet).unwrap(),
            json!({
                "auth":{"token":"fixture"},"provider":{"appid":570},
                "map":{"matchid":u64::MAX,"clock_time":-32},
                "hero":{"name":"Crystal Maiden","mana":2.5},
                "draft":{"picks":[null,{"id":5}],"active":true},
                "new_field":{"present":false}
            })
        );
    }

    #[test]
    fn enforces_depth_and_value_limits() {
        let nested = |depth: usize| format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
        assert!(parse(nested(MAX_DEPTH).as_bytes()).is_ok());
        assert!(parse(nested(MAX_DEPTH + 1).as_bytes()).is_err());

        let list = |count: usize| format!("[{}0]", "0,".repeat(count - 1));
        assert!(parse(list(MAX_VALUES - 1).as_bytes()).is_ok());
        assert!(parse(list(MAX_VALUES).as_bytes()).is_err());
    }

    #[test]
    fn requires_exactly_one_complete_json_value() {
        assert!(parse(b"{").is_err());
        assert!(parse(b"{} {}").is_err());
        assert!(parse(b"{}\r\n").is_ok());
    }
}
