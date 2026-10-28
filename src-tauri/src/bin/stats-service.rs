use ancient_lens::broker::{router, Broker};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("STRATZ_API_TOKEN").map_err(|_| {
        "STRATZ_API_TOKEN is required on the server; never bundle it in the desktop app"
    })?;
    let hourly = std::env::var("ANCIENT_UPSTREAM_HOURLY_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let broker = Broker::new(token, hourly)?;
    let address = std::env::var("ANCIENT_SERVICE_BIND").unwrap_or("127.0.0.1:8787".into());
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!(
        "Ancient Lens statistics service listening on {}",
        listener.local_addr()?
    );
    axum::serve(
        listener,
        router(broker).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
