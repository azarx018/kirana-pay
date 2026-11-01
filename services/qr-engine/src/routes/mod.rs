pub mod qr;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router {
    let state = qr::AppState::default();
    // base64 inflates by 4/3; axum's implicit 2 MB limit rejected valid images >1.5 MB.
    let body_limit = state.config.max_image_bytes / 3 * 4 + 64 * 1024;
    Router::new()
        .route("/health", get(health))
        .route("/internal/qr/convert", post(qr::convert))
        .route("/internal/qr/inspect", post(qr::inspect))
        .layer(DefaultBodyLimit::max(body_limit))
        .with_state(state)
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "qr-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
