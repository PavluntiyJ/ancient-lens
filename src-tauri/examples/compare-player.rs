//! Read-only diagnostic for comparing one public profile with a captured table.
//! Usage: cargo run --no-default-features --example compare-player -- <DotaID> [days]
use ancient_lens::{api::Api, stats::Filter};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let id = args.next().ok_or("Dota ID required")?;
    let days = args.next().unwrap_or("14".into()).parse()?;
    let cache = dirs::config_dir()
        .ok_or("No config directory")?
        .join("Ancient Lens")
        .join("cache");
    let api = Api::new(cache, None)?;
    let value = api.summary(&id, days, Filter::default()).await?;
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}
