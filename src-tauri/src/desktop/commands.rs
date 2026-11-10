//! The page's commands, one module per group. `desktop_call` checks the caller and routes
//! each command here by the group before its colon. Each module parses its own arguments.
pub(super) mod app;
mod args;
pub(super) mod export;
pub(super) mod provider;
pub(super) mod state;
pub(super) mod stats;
pub(super) mod steam;
pub(super) mod test;
pub(super) mod window;
