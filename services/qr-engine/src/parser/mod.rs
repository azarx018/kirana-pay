pub mod decode_error;
pub mod image_decoder;

pub use decode_error::DecodeError;

/// One EMVCo TLV field. Order is preserved as it appears in the source payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tlv {
    pub tag: String,
    pub value: String,
}

/// Parse an EMVCo TLV string into fields.
///
/// Rejects truncated fields, non numeric lengths and non UTF-8 boundaries.
/// This mirrors the tolerant-but-exact parser used by the proven Python
/// implementation: each field is `tag(2) + length(2) + value(length)`.
pub fn parse(payload: &str) -> Result<Vec<Tlv>, String> {
    if payload.is_empty() {
        return Err("payload is empty".to_string());
    }
    if !payload.is_ascii() {
        return Err("payload contains non-ASCII bytes".to_string());
    }

    let bytes = payload.as_bytes();
    let mut fields = Vec::new();
    let mut i = 0usize;

    while i < bytes.len() {
        if i + 4 > bytes.len() {
            return Err(format!("truncated field header at offset {i}"));
        }
        let tag = &payload[i..i + 2];
        if !tag.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("invalid tag '{tag}' at offset {i}"));
        }
        let len_str = &payload[i + 2..i + 4];
        let len: usize = len_str
            .parse()
            .map_err(|_| format!("invalid length '{len_str}' at offset {i}"))?;
        let start = i + 4;
        let end = start + len;
        if end > bytes.len() {
            return Err(format!("field {tag} overflows payload"));
        }
        fields.push(Tlv {
            tag: tag.to_string(),
            value: payload[start..end].to_string(),
        });
        i = end;
    }

    if fields.is_empty() {
        return Err("payload contains no fields".to_string());
    }
    Ok(fields)
}

/// Serialize fields back to a payload string.
pub fn serialize(fields: &[Tlv]) -> String {
    let mut out = String::new();
    for f in fields {
        out.push_str(&f.tag);
        out.push_str(&format!("{:02}", f.value.len()));
        out.push_str(&f.value);
    }
    out
}

/// Parse the sub-fields of a template tag (26, 51, 62, ...).
pub fn parse_subfields(value: &str) -> Result<Vec<Tlv>, String> {
    parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_reserializes_roundtrip() {
        let payload = "0002010102115204654053033605802ID";
        let fields = parse(payload).unwrap();
        assert_eq!(fields.len(), 5);
        assert_eq!(serialize(&fields), payload);
    }

    #[test]
    fn rejects_truncated_payload() {
        assert!(parse("0002010102115204").is_err());
    }

    #[test]
    fn rejects_bad_length() {
        assert!(parse("00AB01").is_err());
    }
}
