use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::config::Config;
use crate::errors::QrError;
use crate::generator;
use crate::models::{
    ConvertMeta, ConvertRequest, ConvertResponse, EngineErrorBody, EngineErrorDetail,
};
use crate::parser::image_decoder;
use crate::transformer;
use crate::validator;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: Config::from_env(),
        }
    }
}

fn error_response(err: QrError) -> axum::response::Response {
    let status = StatusCode::from_u16(err.http_status()).unwrap_or(StatusCode::BAD_REQUEST);
    let body = EngineErrorBody {
        success: false,
        error: EngineErrorDetail {
            code: err.code().to_string(),
            message: err.to_string(),
        },
    };
    (status, Json(body)).into_response()
}

fn decode_error_to_qr_error(e: crate::parser::DecodeError) -> QrError {
    use crate::parser::DecodeError::*;
    match e {
        Empty | NotBase64 => QrError::EmptyImage,
        TooLarge => QrError::ImageTooLarge,
        NotAnImage => QrError::InvalidImageType,
        NoQr => QrError::QrNotReadable,
    }
}

pub async fn convert(
    State(state): State<AppState>,
    Json(req): Json<ConvertRequest>,
) -> axum::response::Response {
    let cfg = state.config.clone();

    if req.amount < cfg.min_amount || req.amount > cfg.max_amount {
        return error_response(QrError::InvalidAmount);
    }

    let payload = match image_decoder::decode_qr_from_base64(&req.image_base64, cfg.max_image_bytes)
    {
        Ok(p) => p,
        Err(e) => return error_response(decode_error_to_qr_error(e)),
    };

    let info = match validator::validate_static(&payload) {
        Ok(i) => i,
        Err(msg) => {
            // Distinguish "not QRIS at all" from "structurally broken QRIS".
            let err = if msg.contains("tag 51") || msg.contains("ID.CO.QRIS.WWW") {
                QrError::UnsupportedQrFormat
            } else {
                QrError::ValidationFailed(msg)
            };
            return error_response(err);
        }
    };

    let transformed = match transformer::transform(&payload, req.amount, req.note.as_deref()) {
        Ok(p) => p,
        Err(msg) => return error_response(QrError::TransformationFailed(msg)),
    };

    if let Err(msg) = validator::validate_dynamic(&transformed, req.amount) {
        return error_response(QrError::ValidationFailed(msg));
    }

    let png_b64 = match generator::render_png_base64(&transformed) {
        Ok(b) => b,
        Err(msg) => return error_response(QrError::TransformationFailed(msg)),
    };

    tracing::info!(
        amount = req.amount,
        nmid = %info.nmid,
        payload_len = transformed.len(),
        "qr transformed"
    );

    Json(ConvertResponse {
        payload: transformed,
        qr_png_base64: png_b64,
        meta: ConvertMeta {
            nmid: info.nmid,
            merchant_name: info.merchant_name,
            currency: info.currency.clone(),
            country: info.country.clone(),
            amount: req.amount,
            is_dynamic: true,
        },
    })
    .into_response()
}
