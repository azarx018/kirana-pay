//! Golden/parity tests against the proven Python implementation.
//!
//! The vectors in testdata/golden.json were produced by the user's validated
//! Python converter applied to a synthetic (fake) static QRIS fixture.

use qr_engine::generator;
use qr_engine::parser::image_decoder;
use qr_engine::transformer;
use qr_engine::validator;
use serde::Deserialize;

#[derive(Deserialize)]
struct Golden {
    static_payload: String,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    amount: i64,
    note: Option<String>,
    expected_payload: String,
}

fn load() -> Golden {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/golden.json"))
        .expect("golden.json present");
    serde_json::from_str(&raw).expect("golden.json valid")
}

#[test]
fn static_fixture_is_a_valid_qris() {
    let g = load();
    let info = validator::validate_static(&g.static_payload).expect("fixture validates");
    assert_eq!(info.nmid, "ID9999999999999");
    assert_eq!(info.merchant_name, "TOKO CONTOH");
    assert_eq!(info.currency, "360");
}

#[test]
fn transform_matches_python_vectors_byte_for_byte() {
    let g = load();
    for case in &g.cases {
        let out = transformer::transform(&g.static_payload, case.amount, case.note.as_deref())
            .expect("transform succeeds");
        assert_eq!(
            out, case.expected_payload,
            "parity mismatch for amount={} note={:?}",
            case.amount, case.note
        );
        assert!(validator::validate_dynamic(&out, case.amount).is_ok());
    }
}

#[test]
fn crc_of_every_expected_payload_is_valid() {
    let g = load();
    for case in &g.cases {
        let p = &case.expected_payload;
        let (body, crc) = p.split_at(p.len() - 4);
        assert_eq!(
            transformer::crc16(body),
            crc,
            "bad crc for amount {}",
            case.amount
        );
    }
}

#[test]
fn generated_png_decodes_back_to_the_exact_payload() {
    let g = load();
    for case in &g.cases {
        let b64 = generator::render_png_base64(&case.expected_payload).expect("render");
        let decoded = image_decoder::decode_qr_from_base64(&b64, 5 * 1024 * 1024)
            .expect("generated QR must decode");
        assert_eq!(decoded, case.expected_payload, "roundtrip mismatch");
    }
}

#[test]
fn note_does_not_drop_terminal_label() {
    // regression: replacing tag 62 wholesale breaks acquirers
    let merged = transformer::merge_note(Some("0703A01"), "tes");
    assert!(merged.contains("0703A01"));
    assert!(merged.contains("0503TES"));
}

#[test]
fn rejects_non_qris_payload() {
    // arbitrary EMVCo payment payload without the QRIS national block
    let p = "0002010102115204541153033605802ID5907MERCHANT6304ABCD";
    assert!(validator::validate_static(p).is_err());
}

#[test]
fn rejects_zero_amount() {
    let g = load();
    assert!(transformer::transform(&g.static_payload, 0, None).is_err());
}
