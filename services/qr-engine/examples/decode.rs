//! Debug helper: decode a QR from an image file.
//! Usage: cargo run --example decode -- /path/to/image.jpg

use qr_engine::parser::image_decoder;

fn main() {
    let path = std::env::args().nth(1).expect("usage: decode <image>");
    let bytes = std::fs::read(&path).expect("read image");
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    match image_decoder::decode_qr_from_base64(&b64, 10 * 1024 * 1024) {
        Ok(payload) => {
            println!("OK {} {}", payload.len(), payload);
        }
        Err(e) => {
            println!("FAIL {e:?}");
            std::process::exit(1);
        }
    }
}
