use base64::Engine;
use image::Luma;

/// Render a QR code for `payload` and return PNG bytes.
pub fn render_png(payload: &str) -> Result<Vec<u8>, String> {
    let code = qrcode::QrCode::new(payload.as_bytes()).map_err(|e| e.to_string())?;
    let image: image::ImageBuffer<Luma<u8>, Vec<u8>> = code
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .module_dimensions(10, 10)
        .build();

    let mut buf = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

pub fn render_png_base64(payload: &str) -> Result<String, String> {
    let png = render_png(payload)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}
