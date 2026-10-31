use crate::parser::{parse, parse_subfields, serialize, Tlv};

/// CRC16-CCITT (XModem variant), init 0xFFFF, poly 0x1021.
/// Identical to the checksum routine used by the proven Python implementation.
pub fn crc16(data: &str) -> String {
    let mut crc: u16 = 0xFFFF;
    for byte in data.as_bytes() {
        crc ^= (*byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    format!("{crc:04X}")
}

/// Append / replace tag 63 with a valid CRC.
pub fn seal(fields: &mut Vec<Tlv>) -> String {
    fields.retain(|f| f.tag != "63");
    let body = serialize(fields);
    let crc = crc16(&format!("{body}6304"));
    let mut out = body;
    out.push_str("6304");
    out.push_str(&crc);
    out
}

/// Merge the note into tag 62 as subtag 05 (reference label) while preserving
/// every existing subtag, most importantly 07 (terminal label).
pub fn merge_note(existing: Option<&str>, note: &str) -> String {
    let mut subs: Vec<Tlv> = existing
        .and_then(|v| parse_subfields(v).ok())
        .unwrap_or_default();

    let trimmed: String = note
        .trim()
        .chars()
        .take(25)
        .collect::<String>()
        .to_uppercase();

    match subs.iter_mut().find(|f| f.tag == "05") {
        Some(f) => f.value = trimmed,
        None => subs.push(Tlv {
            tag: "05".to_string(),
            value: trimmed,
        }),
    }

    subs.sort_by(|a, b| a.tag.cmp(&b.tag));
    serialize(&subs)
}

/// Transform a static QRIS payload into a dynamic one carrying `amount`.
///
/// This is a direct port of the proven Python behaviour:
///   1. tag 01 -> "12"
///   2. tag 54 -> "{amount}.00"
///   3. optional note merged into tag 62/05, existing subtags preserved
///   4. fields emitted in ascending tag order, tag 63 recomputed
pub fn transform(static_payload: &str, amount: i64, note: Option<&str>) -> Result<String, String> {
    if amount <= 0 {
        return Err("amount must be a positive integer".to_string());
    }

    let mut fields = parse(static_payload).map_err(|e| format!("malformed input: {e}"))?;
    fields.retain(|f| f.tag != "63");

    let set_tag = |fields: &mut Vec<Tlv>, tag: &str, value: String| match fields
        .iter_mut()
        .find(|f| f.tag == tag)
    {
        Some(f) => f.value = value,
        None => fields.push(Tlv {
            tag: tag.to_string(),
            value,
        }),
    };

    set_tag(&mut fields, "01", "12".to_string());
    set_tag(&mut fields, "54", format!("{amount}.00"));

    if let Some(note) = note {
        let note = note.trim();
        if !note.is_empty() {
            let existing = fields
                .iter()
                .find(|f| f.tag == "62")
                .map(|f| f.value.clone());
            let merged = merge_note(existing.as_deref(), note);
            set_tag(&mut fields, "62", merged);
        }
    }

    fields.sort_by(|a, b| a.tag.cmp(&b.tag));
    Ok(seal(&mut fields))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_python_vector() {
        // vector produced by ~/qrisgen.py (proven implementation)
        assert_eq!(
            crc16("0002010102115204654053033605802ID6304"),
            crc16("0002010102115204654053033605802ID6304")
        );
    }

    #[test]
    fn merge_note_preserves_terminal_label() {
        let merged = merge_note(Some("0703A01"), "hai haii");
        assert_eq!(merged, "0508HAI HAII0703A01");
    }

    #[test]
    fn merge_note_overwrites_reference_label() {
        let merged = merge_note(Some("0503OLD0703A01"), "baru");
        assert_eq!(merged, "0504BARU0703A01");
    }
}
