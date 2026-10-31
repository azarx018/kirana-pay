use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, GrayImage, ImageBuffer, Luma};

/// Decode a base64 image and read the first QR payload found.
///
/// Real users upload photographs of printed cards: blurry, low contrast, small.
/// A single pass is not enough, so the image is tried as-is and then through a
/// small set of deterministic pre-processing variants. Every variant is
/// derived from the original pixels — nothing is guessed.
pub fn decode_qr_from_base64(b64: &str, max_bytes: usize) -> Result<String, super::DecodeError> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(b64.trim()))
        .map_err(|_| super::DecodeError::NotBase64)?;

    if data.is_empty() {
        return Err(super::DecodeError::Empty);
    }
    if data.len() > max_bytes {
        return Err(super::DecodeError::TooLarge);
    }

    let img = image::load_from_memory(&data).map_err(|_| super::DecodeError::NotAnImage)?;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err(super::DecodeError::NotAnImage);
    }
    if w > 8000 || h > 8000 {
        return Err(super::DecodeError::TooLarge);
    }

    let luma = img.to_luma8();

    for candidate in candidates(&luma) {
        if let Some(payload) = try_decode(&candidate) {
            return Ok(payload);
        }
    }
    Err(super::DecodeError::NoQr)
}

/// Deterministic pre-processing ladder, cheapest variants first.
fn candidates(src: &GrayImage) -> Vec<GrayImage> {
    let mut out: Vec<GrayImage> = Vec::with_capacity(6);
    let (w, h) = src.dimensions();

    out.push(src.clone());

    // Upscaling helps small or slightly soft photos.
    let up2 = scale(src, 2.0);
    out.push(up2.clone());

    // Contrast stretching + Otsu binarisation fight glare and low-contrast prints.
    out.push(stretch_contrast(src));
    out.push(otsu(src));
    out.push(otsu(&up2));
    out.push(otsu(&stretch_contrast(src)));

    // Very large images: try a downscale too (detector works on module boundaries).
    if w > 2000 || h > 2000 {
        out.push(scale(src, 0.5));
    }

    out
}

fn scale(src: &GrayImage, factor: f32) -> GrayImage {
    let (w, h) = src.dimensions();
    let nw = ((w as f32 * factor) as u32).max(1).min(4000);
    let nh = ((h as f32 * factor) as u32).max(1).min(4000);
    let dyn_img = DynamicImage::ImageLuma8(src.clone());
    dyn_img
        .resize_exact(nw, nh, FilterType::Triangle)
        .to_luma8()
}

fn stretch_contrast(src: &GrayImage) -> GrayImage {
    let mut min = 255u8;
    let mut max = 0u8;
    for p in src.pixels() {
        let v = p.0[0];
        min = min.min(v);
        max = max.max(v);
    }
    if max <= min {
        return src.clone();
    }
    let span = (max - min) as f32;
    ImageBuffer::from_fn(src.width(), src.height(), |x, y| {
        let v = src.get_pixel(x, y).0[0];
        let norm = ((v.saturating_sub(min)) as f32 / span * 255.0) as u8;
        Luma([norm])
    })
}

fn otsu(src: &GrayImage) -> GrayImage {
    let mut hist = [0u32; 256];
    for p in src.pixels() {
        hist[p.0[0] as usize] += 1;
    }
    let total: u32 = src.width() * src.height();
    if total == 0 {
        return src.clone();
    }

    let sum_all: f64 = (0..256).map(|i| i as f64 * hist[i] as f64).sum();
    let mut sum_bg = 0.0f64;
    let mut weight_bg = 0u32;
    let mut best_var = -1.0f64;
    let mut threshold = 127u8;

    for t in 0..256 {
        weight_bg += hist[t];
        if weight_bg == 0 {
            continue;
        }
        let weight_fg = total - weight_bg;
        if weight_fg == 0 {
            break;
        }
        sum_bg += t as f64 * hist[t] as f64;
        let mean_bg = sum_bg / weight_bg as f64;
        let mean_fg = (sum_all - sum_bg) / weight_fg as f64;
        let var = weight_bg as f64 * weight_fg as f64 * (mean_bg - mean_fg).powi(2);
        if var > best_var {
            best_var = var;
            threshold = t as u8;
        }
    }

    ImageBuffer::from_fn(src.width(), src.height(), |x, y| {
        let v = src.get_pixel(x, y).0[0];
        Luma([if v > threshold { 255 } else { 0 }])
    })
}

fn try_decode(img: &GrayImage) -> Option<String> {
    let mut prepared = rqrr::PreparedImage::prepare(img.clone());
    for grid in prepared.detect_grids() {
        if let Ok((_meta, content)) = grid.decode() {
            if !content.is_empty() {
                return Some(content);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otsu_separates_a_synthetic_bimodal_histogram() {
        let img =
            ImageBuffer::from_fn(10, 10, |x, _y| if x < 5 { Luma([20]) } else { Luma([230]) });
        let out = otsu(&img);
        assert_eq!(out.get_pixel(0, 0).0[0], 0);
        assert_eq!(out.get_pixel(9, 9).0[0], 255);
    }

    #[test]
    fn contrast_stretch_spans_full_range() {
        let img = ImageBuffer::from_fn(4, 1, |x, _| Luma([100 + x as u8 * 10]));
        let out = stretch_contrast(&img);
        assert_eq!(out.get_pixel(0, 0).0[0], 0);
        assert_eq!(out.get_pixel(3, 0).0[0], 255);
    }
}
