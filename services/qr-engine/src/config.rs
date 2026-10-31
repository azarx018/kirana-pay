use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub max_image_bytes: usize,
    pub max_amount: i64,
    pub min_amount: i64,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env::var("QR_ENGINE_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8081),
            max_image_bytes: env::var("QR_ENGINE_MAX_IMAGE_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5 * 1024 * 1024),
            max_amount: env::var("QR_ENGINE_MAX_AMOUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100_000_000),
            min_amount: env::var("QR_ENGINE_MIN_AMOUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1),
        }
    }
}
