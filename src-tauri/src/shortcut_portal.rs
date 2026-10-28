//! The desktop's GlobalShortcuts portal. On Wayland it is the only way a shortcut reaches this
//! app while another window, such as the game, has the keyboard: the X11 key grab of the
//! global-shortcut plugin only sees keys while an X11 window is focused, so it never sees the
//! press that should hide this (native Wayland) window again.
use std::collections::HashMap;
use zbus::{
    blocking::{Connection, Proxy},
    zvariant::{OwnedObjectPath, OwnedValue, Value},
};

const DESTINATION: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
const INTERFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
pub const SHORTCUT_ID: &str = "toggle";
/// Alt with the numpad 5 key while Num Lock is off (keysym KP_Begin), in the portal's format.
/// The desktop asks the user to confirm it once and lets them choose another one.
const PREFERRED_TRIGGER: &str = "ALT+NUM+KP_Begin";

type Results = HashMap<String, OwnedValue>;

fn token() -> String {
    format!("ancientlens{}", rand::random::<u32>())
}
/// Calls a portal method that answers through a Request object and waits for that answer.
fn request(
    connection: &Connection,
    token: &str,
    call: impl FnOnce() -> zbus::Result<OwnedObjectPath>,
) -> Result<Results, String> {
    let sender = connection
        .unique_name()
        .ok_or("No D-Bus name")?
        .trim_start_matches(':')
        .replace('.', "_");
    // Subscribe before calling, at the path the portal derives from the token.
    let path = format!("{PATH}/request/{sender}/{token}");
    let expected = Proxy::new(
        connection,
        DESTINATION,
        path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .map_err(|e| e.to_string())?;
    let responses = expected
        .receive_signal("Response")
        .map_err(|e| e.to_string())?;
    let returned = call().map_err(|e| e.to_string())?;
    // Old portal versions choose their own path.
    let mut responses = if returned.as_str() == path {
        responses
    } else {
        Proxy::new(
            connection,
            DESTINATION,
            returned.as_str(),
            "org.freedesktop.portal.Request",
        )
        .map_err(|e| e.to_string())?
        .receive_signal("Response")
        .map_err(|e| e.to_string())?
    };
    let message = responses.next().ok_or("The portal closed the request")?;
    let (code, results): (u32, Results) =
        message.body().deserialize().map_err(|e| e.to_string())?;
    match code {
        0 => Ok(results),
        1 => Err("cancelled by the user".into()),
        _ => Err("refused by the desktop".into()),
    }
}
fn text(value: &OwnedValue) -> Option<String> {
    match &**value {
        Value::Str(s) => Some(s.to_string()),
        Value::ObjectPath(p) => Some(p.to_string()),
        _ => None,
    }
}

/// A bound shortcut; keep it alive for as long as the shortcut should work.
pub struct Binding {
    connection: Connection,
    session: String,
    /// The key the desktop assigned, as it describes it (e.g. "Alt+Num+Clear").
    pub trigger: String,
}
impl Binding {
    pub fn bind(description: &str) -> Result<Self, String> {
        let connection = Connection::session().map_err(|e| e.to_string())?;
        // Apps started outside their desktop file have no ID the portal could use for them.
        if let Ok(registry) = Proxy::new(
            &connection,
            DESTINATION,
            PATH,
            "org.freedesktop.host.portal.Registry",
        ) {
            let options: HashMap<&str, Value> = HashMap::new();
            let _: zbus::Result<()> = registry.call("Register", &("org.ancientlens", options));
        }
        let portal = Proxy::new(&connection, DESTINATION, PATH, INTERFACE)
            .map_err(|e| format!("No GlobalShortcuts portal: {e}"))?;
        let handle = token();
        let session_token = token();
        let created = request(&connection, &handle, || {
            let options: HashMap<&str, Value> = HashMap::from([
                ("handle_token", Value::from(handle.as_str())),
                ("session_handle_token", Value::from(session_token.as_str())),
            ]);
            portal.call("CreateSession", &(options,))
        })?;
        let session = created
            .get("session_handle")
            .and_then(text)
            .ok_or("The portal returned no session")?;
        let session_path =
            zbus::zvariant::ObjectPath::try_from(session.as_str()).map_err(|e| e.to_string())?;
        let handle = token();
        let bound = request(&connection, &handle, || {
            let shortcut: HashMap<&str, Value> = HashMap::from([
                ("description", Value::from(description)),
                ("preferred_trigger", Value::from(PREFERRED_TRIGGER)),
            ]);
            let options: HashMap<&str, Value> =
                HashMap::from([("handle_token", Value::from(handle.as_str()))]);
            portal.call(
                "BindShortcuts",
                &(&session_path, vec![(SHORTCUT_ID, shortcut)], "", options),
            )
        })?;
        let shortcuts = bound
            .get("shortcuts")
            .ok_or("The desktop bound no shortcut")?;
        let Value::Array(list) = &**shortcuts else {
            return Err("Unexpected portal answer".into());
        };
        let mut trigger = None;
        for item in list.iter() {
            let Value::Structure(entry) = item else {
                continue;
            };
            let [Value::Str(id), Value::Dict(details)] = entry.fields() else {
                continue;
            };
            if id.as_str() == SHORTCUT_ID {
                trigger = Some(
                    details
                        .get::<&str, String>(&"trigger_description")
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                );
            }
        }
        Ok(Self {
            connection,
            session,
            trigger: trigger.ok_or("The desktop bound no shortcut")?,
        })
    }
    /// Calls `pressed` for each press until the connection ends.
    pub fn listen(&self, pressed: impl Fn()) -> Result<(), String> {
        let portal = Proxy::new(&self.connection, DESTINATION, PATH, INTERFACE)
            .map_err(|e| e.to_string())?;
        for message in portal
            .receive_signal("Activated")
            .map_err(|e| e.to_string())?
        {
            let Ok((session, id, _, _)) = message
                .body()
                .deserialize::<(OwnedObjectPath, String, u64, Results)>()
            else {
                continue;
            };
            if session.as_str() == self.session && id == SHORTCUT_ID {
                pressed();
            }
        }
        Err("The shortcut portal connection ended".into())
    }
}
