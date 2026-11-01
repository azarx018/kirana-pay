use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub max_image_bytes: usize,
    pub max_amount: i64,
    pub min_amount: i64,
    /// Max images decoded at the same time (decoding is CPU/memory heavy).
    pub max_concurrent_decodes: usize,
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
            max_concurrent_decodes: env::var("QR_ENGINE_MAX_CONCURRENT_DECODES")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|v: &usize| *v > 0)
                .unwrap_or(4),
        }
    }
}
