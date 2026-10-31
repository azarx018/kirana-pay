pub mod qr;

use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/internal/qr/convert", post(qr::convert))
        .route("/internal/qr/inspect", post(qr::inspect))
        .with_state(qr::AppState::default())
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "qr-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
