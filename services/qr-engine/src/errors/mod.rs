use thiserror::Error;

#[derive(Debug, Error)]
pub enum QrError {
    #[error("image data is empty")]
    EmptyImage,
    #[error("image exceeds the configured size limit")]
    ImageTooLarge,
    #[error("image format is not supported")]
    InvalidImageType,
    #[error("no readable QR code found in the image")]
    QrNotReadable,
    #[error("QR format is not supported")]
    UnsupportedQrFormat,
    #[error("QR payload is malformed: {0}")]
    #[allow(dead_code)] // kept for callers that surface raw parser errors
    MalformedPayload(String),
    #[error("QR validation failed: {0}")]
    ValidationFailed(String),
    #[error("amount is invalid")]
    InvalidAmount,
    #[error("transformation failed: {0}")]
    TransformationFailed(String),
    #[error("internal error")]
    #[allow(dead_code)] // reserved for unexpected engine failures
    Internal,
}

impl QrError {
    /// Stable machine-readable code exposed outside the engine.
    pub fn code(&self) -> &'static str {
        match self {
            QrError::EmptyImage => "INVALID_FILE_TYPE",
            QrError::ImageTooLarge => "FILE_TOO_LARGE",
            QrError::InvalidImageType => "INVALID_FILE_TYPE",
            QrError::QrNotReadable => "QR_NOT_READABLE",
            QrError::UnsupportedQrFormat => "UNSUPPORTED_QR_FORMAT",
            QrError::MalformedPayload(_) => "QR_NOT_READABLE",
            QrError::ValidationFailed(_) => "QR_VALIDATION_FAILED",
            QrError::InvalidAmount => "INVALID_AMOUNT",
            QrError::TransformationFailed(_) => "TRANSFORMATION_FAILED",
            QrError::Internal => "INTERNAL_ERROR",
        }
    }

    pub fn http_status(&self) -> u16 {
        match self {
            QrError::ImageTooLarge => 413,
            QrError::InvalidAmount => 400,
            QrError::Internal => 500,
            _ => 422,
        }
    }
}
