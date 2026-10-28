//! Text KeyValues as Steam writes them, parsed with byte positions so that an edit changes
//! only the bytes it means to and leaves the rest of the file exactly as Steam left it.
use std::ops::Range;

pub type Result<T> = std::result::Result<T, String>;

pub struct Entry {
    pub key: String,
    pub value: Item,
}
pub enum Item {
    /// `span` covers the raw contents between the quotes, still escaped.
    Text { text: String, span: Range<usize> },
    /// `close` is the position of the closing brace.
    Block { entries: Vec<Entry>, close: usize },
}
impl Item {
    pub fn text(&self) -> Option<&str> {
        match self {
            Item::Text { text, .. } => Some(text),
            Item::Block { .. } => None,
        }
    }
    pub fn entries(&self) -> Option<&[Entry]> {
        match self {
            Item::Block { entries, .. } => Some(entries),
            Item::Text { .. } => None,
        }
    }
}

/// The first entry named `key`; Steam's own keys are compared without case.
pub fn child<'a>(entries: &'a [Entry], key: &str) -> Option<&'a Item> {
    entries
        .iter()
        .find(|e| e.key.eq_ignore_ascii_case(key))
        .map(|e| &e.value)
}
pub fn path<'a>(entries: &'a [Entry], keys: &[&str]) -> Option<&'a Item> {
    let (last, parents) = keys.split_last()?;
    let mut at = entries;
    for key in parents {
        at = child(at, key)?.entries()?;
    }
    child(at, last)
}

enum Token {
    Open,
    Close(usize),
    Text(String, Range<usize>),
}
fn tokens(text: &str) -> Result<Vec<Token>> {
    let bytes = text.as_bytes();
    let (mut out, mut i) = (vec![], 0);
    while i < bytes.len() {
        match bytes[i] {
            b'{' => out.push(Token::Open),
            b'}' => out.push(Token::Close(i)),
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'"' => {
                let start = i + 1;
                let mut value = String::new();
                i = start;
                loop {
                    let Some(c) = text[i..].chars().next() else {
                        return Err("Unterminated string".into());
                    };
                    match c {
                        '"' => break,
                        '\\' => {
                            let escaped =
                                text[i + 1..].chars().next().ok_or("Unterminated string")?;
                            value.push(match escaped {
                                'n' => '\n',
                                't' => '\t',
                                other => other,
                            });
                            i += 1 + escaped.len_utf8();
                        }
                        c => {
                            value.push(c);
                            i += c.len_utf8();
                        }
                    }
                }
                out.push(Token::Text(value, start..i));
            }
            c if c.is_ascii_whitespace() => {}
            _ => {
                // Unquoted token, as in hand-edited files.
                let start = i;
                while i < bytes.len()
                    && !bytes[i].is_ascii_whitespace()
                    && !matches!(bytes[i], b'{' | b'}' | b'"')
                {
                    i += 1;
                }
                out.push(Token::Text(text[start..i].into(), start..i));
                continue;
            }
        }
        i += 1;
    }
    Ok(out)
}

pub fn parse(text: &str) -> Result<Vec<Entry>> {
    let tokens = tokens(text)?;
    let mut at = 0;
    let entries = block(&tokens, &mut at, false)?.0;
    Ok(entries)
}
fn block(tokens: &[Token], at: &mut usize, nested: bool) -> Result<(Vec<Entry>, usize)> {
    let mut entries = vec![];
    loop {
        let key = match tokens.get(*at) {
            None if nested => return Err("Unclosed block".into()),
            None => return Ok((entries, usize::MAX)),
            Some(Token::Close(position)) if nested => {
                *at += 1;
                return Ok((entries, *position));
            }
            Some(Token::Text(key, _)) => key.clone(),
            Some(_) => return Err("Unexpected brace".into()),
        };
        *at += 1;
        let value = match tokens.get(*at) {
            Some(Token::Text(text, span)) => {
                *at += 1;
                Item::Text {
                    text: text.clone(),
                    span: span.clone(),
                }
            }
            Some(Token::Open) => {
                *at += 1;
                let (entries, close) = block(tokens, at, true)?;
                Item::Block { entries, close }
            }
            _ => return Err(format!("Key without value: {key}")),
        };
        entries.push(Entry { key, value });
    }
}

/// Where a new line goes before `close`, and the indentation of that closing brace.
fn line_before(text: &str, close: usize) -> (usize, &str) {
    let start = text[..close].rfind('\n').map_or(0, |i| i + 1);
    let indent = &text[start..close];
    if indent.chars().all(|c| c == ' ' || c == '\t') {
        (start, indent)
    } else {
        // Brace shares a line with other text; insert right before it on its own line.
        (close, "")
    }
}
fn newline(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
/// Inserts `lines` (key/value pairs or nested blocks, one indent step deeper) before `close`.
fn insert(text: &str, close: usize, lines: &[(usize, String)]) -> String {
    let (at, indent) = line_before(text, close);
    let nl = newline(text);
    let mut add = String::new();
    if at == close {
        add.push_str(nl);
    }
    for (depth, line) in lines {
        add.push_str(indent);
        add.push_str(&"\t".repeat(depth + 1));
        add.push_str(line);
        add.push_str(nl);
    }
    let mut out = String::with_capacity(text.len() + add.len());
    out.push_str(&text[..at]);
    out.push_str(&add);
    out.push_str(&text[at..]);
    out
}

pub const GSI_FLAG: &str = "-gamestateintegration";
const STEAM: [&str; 4] = ["UserLocalConfigStore", "Software", "Valve", "Steam"];

pub fn has_flag(options: &str) -> bool {
    options
        .split_whitespace()
        .any(|word| word.eq_ignore_ascii_case(GSI_FLAG))
}
/// Dota's launch options in a localconfig.vdf: `None` when the account has no Dota entry,
/// an empty string when the entry has no launch options.
pub fn launch_options(text: &str) -> Result<Option<String>> {
    let root = parse(text)?;
    let steam = path(&root, &STEAM)
        .and_then(Item::entries)
        .ok_or("Not a Steam localconfig.vdf")?;
    let Some(dota) = path(steam, &["apps", "570"]) else {
        return Ok(None);
    };
    let dota = dota.entries().ok_or("Unexpected Dota 2 entry")?;
    Ok(Some(match child(dota, "LaunchOptions") {
        Some(item) => item.text().ok_or("Unexpected launch options")?.to_owned(),
        None => String::new(),
    }))
}
/// The file with the GSI flag appended to Dota's launch options, keeping existing options and
/// every other byte; `None` when the flag is already there.
pub fn with_gsi_flag(text: &str) -> Result<Option<String>> {
    let root = parse(text)?;
    let steam = path(&root, &STEAM).ok_or("Not a Steam localconfig.vdf")?;
    let Item::Block {
        entries: steam,
        close: steam_close,
    } = steam
    else {
        return Err("Not a Steam localconfig.vdf".into());
    };
    let option = |depth| {
        (
            depth,
            format!("{}\t\t{}", quote("LaunchOptions"), quote(GSI_FLAG)),
        )
    };
    let Some(apps) = child(steam, "apps") else {
        return Ok(Some(insert(
            text,
            *steam_close,
            &[
                (0, quote("apps")),
                (0, "{".into()),
                (1, quote("570")),
                (1, "{".into()),
                option(2),
                (1, "}".into()),
                (0, "}".into()),
            ],
        )));
    };
    let Item::Block {
        entries: apps,
        close: apps_close,
    } = apps
    else {
        return Err("Unexpected apps entry".into());
    };
    let Some(dota) = child(apps, "570") else {
        return Ok(Some(insert(
            text,
            *apps_close,
            &[
                (0, quote("570")),
                (0, "{".into()),
                option(1),
                (0, "}".into()),
            ],
        )));
    };
    let Item::Block {
        entries: dota,
        close: dota_close,
    } = dota
    else {
        return Err("Unexpected Dota 2 entry".into());
    };
    match child(dota, "LaunchOptions") {
        None => Ok(Some(insert(text, *dota_close, &[option(0)]))),
        Some(Item::Text {
            text: options,
            span,
        }) => {
            if has_flag(options) {
                return Ok(None);
            }
            let raw = &text[span.clone()];
            let gap = if raw.is_empty() || raw.ends_with(char::is_whitespace) {
                ""
            } else {
                " "
            };
            Ok(Some(format!(
                "{}{gap}{GSI_FLAG}{}",
                &text[..span.end],
                &text[span.end..]
            )))
        }
        Some(Item::Block { .. }) => Err("Unexpected launch options".into()),
    }
}

/// Library folders holding Dota 2, from libraryfolders.vdf in the current or the old format.
pub fn libraries(text: &str) -> Result<Vec<String>> {
    let root = parse(text)?;
    let folders = child(&root, "libraryfolders")
        .and_then(Item::entries)
        .ok_or("Not a libraryfolders.vdf")?;
    let mut out = vec![];
    for entry in folders {
        if !entry.key.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        match &entry.value {
            Item::Text { text, .. } => out.push(text.clone()),
            Item::Block { entries, .. } => {
                if let Some(path) = child(entries, "path").and_then(Item::text) {
                    out.push(path.to_owned());
                }
            }
        }
    }
    Ok(out)
}
pub fn install_dir(manifest: &str) -> Option<String> {
    let root = parse(manifest).ok()?;
    path(&root, &["AppState", "installdir"])
        .and_then(Item::text)
        .filter(|dir| !dir.is_empty() && !dir.contains(['/', '\\']) && !matches!(*dir, ".." | "."))
        .map(String::from)
}
/// Account ID of the Steam login marked as the most recent in loginusers.vdf.
pub fn most_recent_account(text: &str) -> Option<String> {
    let root = parse(text).ok()?;
    let users = child(&root, "users")?.entries()?;
    let mut found = users.iter().filter(|user| {
        user.value
            .entries()
            .and_then(|e| child(e, "MostRecent"))
            .and_then(Item::text)
            == Some("1")
    });
    let user = found.next()?;
    if found.next().is_some() {
        return None;
    }
    crate::store::account_id(&user.key)
        .ok()
        .filter(|_| user.key.parse::<u64>().is_ok_and(|v| v > 76561197960265728))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "\"UserLocalConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"480\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"Playtime\"\t\t\"2108\"\n\t\t\t\t\t}\n\t\t\t\t\t\"570\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"1792714288\"\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"OPTIONS\"\n\t\t\t\t\t\t\"cloud\"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t\"last_sync_state\"\t\t\"synchronized\"\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n";

    fn config(options: &str) -> String {
        CONFIG.replace("OPTIONS", options)
    }

    #[test]
    fn appends_the_flag_and_keeps_every_other_byte() {
        let before = config(r#"env -u LC_ALL %command% -novid -console"#);
        let after = with_gsi_flag(&before).unwrap().unwrap();
        assert_eq!(
            after,
            config("env -u LC_ALL %command% -novid -console -gamestateintegration")
        );
        assert_eq!(
            launch_options(&after).unwrap().as_deref(),
            Some("env -u LC_ALL %command% -novid -console -gamestateintegration")
        );
        assert!(with_gsi_flag(&after).unwrap().is_none());
    }

    #[test]
    fn present_flag_is_matched_as_a_word_without_case() {
        for options in [
            "-GameStateIntegration",
            "-novid -gamestateintegration -console",
        ] {
            assert!(with_gsi_flag(&config(options)).unwrap().is_none());
        }
        // A longer word that only contains the flag is not the flag.
        let similar = config("-gamestateintegrationx");
        assert!(with_gsi_flag(&similar).unwrap().is_some());
    }

    #[test]
    fn escaped_options_stay_escaped() {
        let before = config(r#"-exec \"my cfg\" C:\\path"#);
        assert_eq!(
            launch_options(&before).unwrap().as_deref(),
            Some(r#"-exec "my cfg" C:\path"#)
        );
        let after = with_gsi_flag(&before).unwrap().unwrap();
        assert_eq!(
            after,
            config(r#"-exec \"my cfg\" C:\\path -gamestateintegration"#)
        );
    }

    #[test]
    fn empty_options_get_only_the_flag() {
        let after = with_gsi_flag(&config("")).unwrap().unwrap();
        assert_eq!(after, config("-gamestateintegration"));
    }

    #[test]
    fn missing_launch_options_are_added_inside_the_dota_entry() {
        let before = CONFIG.replace("\t\t\t\t\t\t\"LaunchOptions\"\t\t\"OPTIONS\"\n", "");
        assert_eq!(launch_options(&before).unwrap().as_deref(), Some(""));
        let after = with_gsi_flag(&before).unwrap().unwrap();
        assert!(after.contains(
            "\t\t\t\t\t\t}\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"-gamestateintegration\"\n\t\t\t\t\t}\n\t\t\t\t}"
        ));
        assert_eq!(
            launch_options(&after).unwrap().as_deref(),
            Some("-gamestateintegration")
        );
    }

    #[test]
    fn missing_dota_and_apps_entries_are_created() {
        let start = CONFIG.find("\t\t\t\t\t\"570\"").unwrap();
        let end = CONFIG.find("\t\t\t\t}\n\t\t\t}").unwrap();
        let without_dota = format!("{}{}", &CONFIG[..start], &CONFIG[end..]);
        assert_eq!(launch_options(&without_dota).unwrap(), None);
        let after = with_gsi_flag(&without_dota).unwrap().unwrap();
        assert_eq!(
            launch_options(&after).unwrap().as_deref(),
            Some("-gamestateintegration")
        );
        assert!(after.contains("\t\t\t\t\t\"570\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\""));

        let no_apps = "\"UserLocalConfigStore\"\r\n{\r\n\t\"Software\"\r\n\t{\r\n\t\t\"valve\"\r\n\t\t{\r\n\t\t\t\"Steam\"\r\n\t\t\t{\r\n\t\t\t\t\"x\"\t\t\"1\"\r\n\t\t\t}\r\n\t\t}\r\n\t}\r\n}\r\n";
        let after = with_gsi_flag(no_apps).unwrap().unwrap();
        assert_eq!(
            launch_options(&after).unwrap().as_deref(),
            Some("-gamestateintegration")
        );
        assert!(!after.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn foreign_or_broken_files_are_rejected() {
        assert!(with_gsi_flag("\"Other\"\n{\n}\n").is_err());
        assert!(with_gsi_flag("\"UserLocalConfigStore\"\n{\n\t\"Software\"\n").is_err());
        assert!(launch_options("\"UserLocalConfigStore\" { \"Software\" \"x\" ").is_err());
        assert!(parse("\"a\" \"unterminated").is_err());
        let text_entry = CONFIG.replace(
            "\"570\"\n\t\t\t\t\t{",
            "\"570\"\t\"x\"\n\t\t\t\t\t\"571\"\n\t\t\t\t\t{",
        );
        assert!(with_gsi_flag(&text_entry).is_err());
    }

    #[test]
    fn libraries_manifest_and_recent_account() {
        let current = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"apps\"\n\t\t{\n\t\t\t\"570\"\t\t\"1\"\n\t\t}\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\Games\"\n\t}\n}\n";
        assert_eq!(
            libraries(current).unwrap(),
            ["C:\\Program Files (x86)\\Steam", "D:\\Games"]
        );
        let old = "\"LibraryFolders\"\n{\n\t\"TimeNextStatsReport\"\t\t\"1\"\n\t\"1\"\t\t\"/mnt/games\"\n}\n";
        assert_eq!(libraries(old).unwrap(), ["/mnt/games"]);
        let manifest =
            "\"AppState\"\n{\n\t\"appid\"\t\t\"570\"\n\t\"installdir\"\t\t\"dota 2 beta\"\n}\n";
        assert_eq!(install_dir(manifest).as_deref(), Some("dota 2 beta"));
        assert_eq!(install_dir(&manifest.replace("dota 2 beta", "..")), None);
        let users = "\"users\"\n{\n\t\"76561198816292876\"\n\t{\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n\t\"76561198083722517\"\n\t{\n\t\t\"MostRecent\"\t\t\"0\"\n\t}\n}\n";
        assert_eq!(most_recent_account(users).as_deref(), Some("856027148"));
        assert_eq!(most_recent_account(&users.replace("\"0\"", "\"1\"")), None);
    }
}
