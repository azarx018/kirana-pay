use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub image_base64: String,
    pub amount: i64,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResponse {
    pub payload: String,
    pub qr_png_base64: String,
    pub meta: ConvertMeta,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertMeta {
    pub nmid: String,
    pub merchant_name: String,
    pub currency: String,
    pub country: String,
    pub amount: i64,
    pub is_dynamic: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectRequest {
    pub image_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectResponse {
    pub meta: InspectMeta,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectMeta {
    pub nmid: String,
    pub merchant_name: String,
    pub currency: String,
    pub country: String,
    pub is_dynamic: bool,
    pub has_amount: bool,
}

#[derive(Debug, Serialize)]
pub struct EngineErrorBody {
    pub success: bool,
    pub error: EngineErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct EngineErrorDetail {
    pub code: String,
    pub message: String,
}
