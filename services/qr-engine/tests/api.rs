//! HTTP-level tests for the internal QR engine API.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use qr_engine::generator;
use qr_engine::routes;
use serde_json::{json, Value};
use tower::ServiceExt;

fn fixture_png_b64() -> String {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/golden.json"))
        .unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    generator::render_png_base64(v["static_payload"].as_str().unwrap()).unwrap()
}

async fn post_convert(body: Value) -> (StatusCode, Value) {
    let app = routes::router();
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/qr/convert")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn health_ok() {
    let app = routes::router();
    let res = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn converts_static_qr_to_dynamic() {
    let (status, body) = post_convert(json!({
        "imageBase64": fixture_png_b64(),
        "amount": 2300,
        "note": "TES KEDUA"
    }))
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["meta"]["amount"], 2300);
    assert_eq!(body["meta"]["nmid"], "ID9999999999999");
    assert_eq!(body["meta"]["isDynamic"], true);
    assert!(body["payload"].as_str().unwrap().contains("54072300.00"));
    assert!(!body["qrPngBase64"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn rejects_broken_image_with_structured_error() {
    let (status, body) = post_convert(json!({
        "imageBase64": "bm90LWFuLWltYWdl",
        "amount": 1000
    }))
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["success"], false);
    assert_eq!(body["error"]["code"], "INVALID_FILE_TYPE");
}

#[tokio::test]
async fn rejects_zero_amount() {
    let (status, body) = post_convert(json!({
        "imageBase64": fixture_png_b64(),
        "amount": 0
    }))
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "INVALID_AMOUNT");
}
