#[derive(Debug)]
pub enum DecodeError {
    Empty,
    TooLarge,
    NotBase64,
    NotAnImage,
    NoQr,
}
