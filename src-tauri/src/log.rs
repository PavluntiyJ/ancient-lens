//! The app's log: every line goes to stderr and, once `init` has run, to
//! `logs/ancient-lens.log` in the data folder, so a user can attach it to a bug report.
//!
//! Lines are redacted before they are written anywhere: long digit runs (account, Steam
//! and match IDs), token-like strings, memory addresses and the home folder never reach the
//! file. Call sites still keep IDs, tokens and response bodies out of their messages; the
//! redaction is the second line of defence. The file is limited to two files of `LIMIT`
//! bytes: when it is full it becomes `ancient-lens.1.log`, replacing the older one.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const LIMIT: u64 = 1024 * 1024;
const NAME: &str = "ancient-lens.log";
const OLDER: &str = "ancient-lens.1.log";

static SINK: OnceLock<Mutex<Sink>> = OnceLock::new();
static HOME: OnceLock<Option<String>> = OnceLock::new();

/// One log line, formatted like `format!`.
#[macro_export]
macro_rules! log_line {
    ($($arg:tt)*) => {
        $crate::log::line(format_args!($($arg)*))
    };
}

/// The folder that holds the log files inside a data folder.
pub fn folder(data: &Path) -> PathBuf {
    data.join("logs")
}

/// Starts writing to the log file in `data`. Without it, lines go to stderr only, as in the
/// statistics service and in tests.
pub fn init(data: &Path) {
    let directory = folder(data);
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let _ = SINK.set(Mutex::new(Sink::open(directory, LIMIT)));
}

pub fn line(message: std::fmt::Arguments) {
    let text = format!(
        "{} {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        redact(&message.to_string())
    );
    eprintln!("{text}");
    if let Some(sink) = SINK.get() {
        if let Ok(mut sink) = sink.lock() {
            sink.write(&text);
        }
    }
}

struct Sink {
    directory: PathBuf,
    file: Option<File>,
    size: u64,
    limit: u64,
}

impl Sink {
    fn open(directory: PathBuf, limit: u64) -> Self {
        let path = directory.join(NAME);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();
        let size = file
            .as_ref()
            .and_then(|f| f.metadata().ok())
            .map_or(0, |m| m.len());
        Sink {
            directory,
            file,
            size,
            limit,
        }
    }

    fn write(&mut self, text: &str) {
        // One line never exceeds the limit on its own.
        let text: String = text.chars().take(4096).collect();
        let length = text.len() as u64 + 1;
        if self.size + length > self.limit {
            self.rotate();
        }
        if let Some(file) = &mut self.file {
            if writeln!(file, "{text}").is_ok() {
                self.size += length;
            }
        }
    }

    fn rotate(&mut self) {
        self.file = None;
        let _ = fs::rename(self.directory.join(NAME), self.directory.join(OLDER));
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(self.directory.join(NAME))
            .ok();
        self.size = 0;
    }
}

/// Removes what must not reach a log a user may share.
pub fn redact(text: &str) -> String {
    let home = HOME.get_or_init(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .filter(|p| p.len() > 1)
    });
    let text = match home {
        Some(home) => text.replace(home.as_str(), "~"),
        None => text.to_string(),
    };
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(c) = rest.chars().next() {
        let word = rest
            .find(|c: char| !is_token_char(c))
            .map_or(rest, |end| &rest[..end]);
        if word.is_empty() {
            out.push(c);
            rest = &rest[c.len_utf8()..];
            continue;
        }
        out.push_str(&redact_word(word));
        rest = &rest[word.len()..];
    }
    out
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '=' | '+')
}

fn redact_word(word: &str) -> String {
    // Tokens and keys are long, and nearly always carry digits; file names are shorter.
    if word.len() >= 40 || (word.len() >= 32 && word.bytes().any(|b| b.is_ascii_digit())) {
        return "[redacted]".into();
    }
    if let Some(hex) = word.strip_prefix("0x").or_else(|| word.strip_prefix("0X")) {
        if !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return "0x#".into();
        }
    }
    // Digit runs of six or more inside the word: IDs, never ports, counts or durations.
    let mut out = String::with_capacity(word.len());
    let mut digits = String::new();
    for c in word.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        if digits.len() >= 6 {
            out.push('#');
        } else {
            out.push_str(&digits);
        }
        digits.clear();
        if c != ' ' {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_tokens_and_addresses_are_redacted() {
        let line = redact(
            "Own account update: account 123456789 steam 76561198000000000 match 7712345678 \
             token eyJhbGciOiJIUzI1NiJ9.eyJTdWJqZWN0IjoiMTIzIn0.c2lnbmF0dXJl \
             key 0123456789ABCDEF0123456789ABCDEF getter 0x7ff6a1b2c3d4 \
             gsi aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        for secret in [
            "123456789",
            "76561198000000000",
            "7712345678",
            "eyJhbGciOi",
            "0123456789ABCDEF",
            "7ff6a1b2c3d4",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert!(!line.contains(secret), "{secret} leaked: {line}");
        }
        assert!(line.contains("Own account update: account # steam # match #"));
        assert!(line.contains("token [redacted]"));
        assert!(line.contains("getter 0x#"));
    }

    #[test]
    fn ordinary_detail_stays_readable() {
        let line =
            "net OpenDota players/#/recentMatches 412ms error: HTTP 429; port 41234, 10 players, \
                    gamestate_integration_ancient_lens.cfg";
        assert_eq!(redact(line), line);
    }

    #[test]
    fn the_home_folder_is_shortened() {
        let Some(home) = dirs::home_dir() else { return };
        let path = home.join(".config").join("Ancient Lens");
        let line = redact(&format!("kept as {}", path.display()));
        assert!(!line.contains(home.to_string_lossy().as_ref()));
        assert!(line.starts_with("kept as ~"));
    }

    #[test]
    fn the_file_never_grows_past_two_limits() {
        let dir = tempfile::tempdir().unwrap();
        let mut sink = Sink::open(dir.path().into(), 1000);
        for i in 0..500 {
            sink.write(&format!("line {i} with some text to fill the file"));
        }
        let current = fs::metadata(dir.path().join(NAME)).unwrap().len();
        let older = fs::metadata(dir.path().join(OLDER)).unwrap().len();
        assert!(current <= 1000 && older <= 1000, "{current} {older}");
        let text = fs::read_to_string(dir.path().join(NAME)).unwrap();
        assert!(text.ends_with("line 499 with some text to fill the file\n"));
    }

    #[test]
    fn a_reopened_file_continues_from_its_size() {
        let dir = tempfile::tempdir().unwrap();
        Sink::open(dir.path().into(), 1000).write(&"x".repeat(900));
        let mut sink = Sink::open(dir.path().into(), 1000);
        assert_eq!(sink.size, 901);
        sink.write(&"y".repeat(200));
        assert!(fs::metadata(dir.path().join(NAME)).unwrap().len() <= 1000);
        assert_eq!(fs::metadata(dir.path().join(OLDER)).unwrap().len(), 901);
    }
}
