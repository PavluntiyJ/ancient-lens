//! The core's error type. Every variant carries the English message the page shows, unchanged
//! from when errors were plain strings; the variant says what kind of failure it is, so a
//! caller can react to the kind instead of comparing message text.
use serde::{Serialize, Serializer};
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The request or a file is not valid: a malformed ID, an unknown setting, a corrupt file.
    Invalid(String),
    /// The caller is not allowed, such as a GSI packet with the wrong token.
    Unauthorized(String),
    /// A provider's quota or our own concurrency limit; trying later can succeed.
    RateLimited(String),
    /// An upstream provider or service failed or answered in an unexpected shape.
    Upstream(String),
    /// A local file or system call failed.
    Io(String),
    /// Not classified yet: the message as it always was.
    Other(String),
}

impl Error {
    pub fn invalid(message: impl Into<String>) -> Self {
        Error::Invalid(message.into())
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Error::Unauthorized(message.into())
    }
    pub fn rate_limited(message: impl Into<String>) -> Self {
        Error::RateLimited(message.into())
    }
    pub fn upstream(message: impl Into<String>) -> Self {
        Error::Upstream(message.into())
    }

    /// The message the page shows.
    pub fn message(&self) -> &str {
        match self {
            Error::Invalid(m)
            | Error::Unauthorized(m)
            | Error::RateLimited(m)
            | Error::Upstream(m)
            | Error::Io(m)
            | Error::Other(m) => m,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for Error {}

/// The page receives the message alone, as it did when errors were strings.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.message())
    }
}

impl From<String> for Error {
    fn from(message: String) -> Self {
        Error::Other(message)
    }
}

impl From<&str> for Error {
    fn from(message: &str) -> Self {
        Error::Other(message.into())
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Error::Io(error.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Error::Invalid(error.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(error: reqwest::Error) -> Self {
        Error::Upstream(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_gets_the_same_message_for_every_kind() {
        for error in [
            Error::invalid("Invalid note"),
            Error::rate_limited("Invalid note"),
            Error::from("Invalid note"),
        ] {
            assert_eq!(error.to_string(), "Invalid note");
            assert_eq!(serde_json::to_value(&error).unwrap(), "Invalid note");
        }
    }
}
