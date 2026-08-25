//! Row ids across the IPC boundary.
//!
//! Row ids are random 63-bit integers (U3, so a deleted row's id cannot be
//! reused and its ciphertext replayed into the row that inherits it). JSON
//! numbers are IEEE-754 doubles in JavaScript, exact only up to 2^53 - 1, so an
//! id serialised as a number silently loses its low bits:
//!
//! ```text
//! stored   5744466908857731456
//! in JS    5744466908857731000
//! ```
//!
//! A rounded id matches no row. Foreign keys fail, favourites do nothing,
//! reveal and delete target rows that do not exist — and all of it fails
//! *quietly*, because "no row matched" is not an error at the SQL level.
//!
//! So ids cross as strings and are parsed back here. The alternative — capping
//! ids at 53 bits — would fix new rows only, because a row's id is bound into
//! its AAD (KTD12) and cannot be changed without re-encrypting every column.

use serde::{Deserialize, Deserializer, Serializer};

use super::CommandError;

/// Parses an id that arrived as a string.
pub fn parse_id(raw: &str) -> Result<i64, CommandError> {
    raw.parse::<i64>()
        .map_err(|_| CommandError::new("validation", format!("{raw:?} is not a valid id")))
}

/// Serialises `i64` as a JSON string.
pub mod as_string {
    use super::*;

    pub fn serialize<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    /// Accepts a string, and a number as a courtesy for hand-written calls —
    /// a number that arrived intact parses fine, and one that did not was
    /// already lost before it reached us.
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Either {
            Text(String),
            Number(i64),
        }

        match Either::deserialize(deserializer)? {
            Either::Text(text) => text.parse().map_err(serde::de::Error::custom),
            Either::Number(number) => Ok(number),
        }
    }
}

/// Serialises `Option<i64>` as a JSON string or null.
pub mod as_string_opt {
    use super::*;

    pub fn serialize<S: Serializer>(value: &Option<i64>, serializer: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(inner) => serializer.serialize_str(&inner.to_string()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<i64>, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Either {
            Text(String),
            Number(i64),
        }

        let value = Option::<Either>::deserialize(deserializer)?;
        match value {
            None => Ok(None),
            // An empty string is what an unselected `<select>` sends.
            Some(Either::Text(text)) if text.is_empty() => Ok(None),
            Some(Either::Text(text)) => text.parse().map(Some).map_err(serde::de::Error::custom),
            Some(Either::Number(number)) => Ok(Some(number)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Row {
        #[serde(with = "as_string")]
        id: i64,
        #[serde(with = "as_string_opt")]
        folder_id: Option<i64>,
    }

    /// The exact value that was being corrupted, end to end.
    #[test]
    fn a_63_bit_id_survives_a_json_round_trip() {
        let row = Row {
            id: 5_744_466_908_857_731_456,
            folder_id: Some(2_262_211_442_473_880_730),
        };

        let json = serde_json::to_string(&row).unwrap();
        assert!(
            json.contains("\"5744466908857731456\""),
            "the id must be a string, not a number: {json}"
        );

        assert_eq!(serde_json::from_str::<Row>(&json).unwrap(), row);
    }

    #[test]
    fn the_full_i64_range_survives() {
        for id in [
            1i64,
            i64::MAX,
            9_007_199_254_740_993,
            4_611_686_018_427_387_904,
        ] {
            let row = Row {
                id,
                folder_id: None,
            };
            let json = serde_json::to_string(&row).unwrap();
            assert_eq!(serde_json::from_str::<Row>(&json).unwrap().id, id, "{json}");
        }
    }

    #[test]
    fn a_null_folder_stays_null() {
        let json = r#"{"id":"7","folder_id":null}"#;
        assert_eq!(serde_json::from_str::<Row>(json).unwrap().folder_id, None);
    }

    /// An unselected `<select>` submits an empty string, not null.
    #[test]
    fn an_empty_string_folder_reads_as_none() {
        let json = r#"{"id":"7","folder_id":""}"#;
        assert_eq!(serde_json::from_str::<Row>(json).unwrap().folder_id, None);
    }

    #[test]
    fn a_plain_number_is_still_accepted() {
        let json = r#"{"id":42,"folder_id":7}"#;
        let row = serde_json::from_str::<Row>(json).unwrap();
        assert_eq!(row.id, 42);
        assert_eq!(row.folder_id, Some(7));
    }

    #[test]
    fn nonsense_is_rejected_rather_than_silently_zero() {
        assert!(serde_json::from_str::<Row>(r#"{"id":"abc","folder_id":null}"#).is_err());
        assert!(parse_id("abc").is_err());
        assert!(parse_id("").is_err());
        assert_eq!(
            parse_id("5744466908857731456").unwrap(),
            5_744_466_908_857_731_456
        );
    }
}
