use crate::parser::{parse, parse_subfields, Tlv};

/// Result of structural validation of a QRIS payload.
#[derive(Debug, Clone)]
pub struct StaticQrisInfo {
    pub nmid: String,
    pub merchant_name: String,
    pub currency: String,
    pub country: String,
}

/// Validate the decoded static QRIS payload.
///
/// Only structural, verifiable facts are checked here. No assumed provider
/// rules: we require the EMVCo root tag, the QRIS national identifier (tag 51)
/// and the mandatory merchant/currency fields.
pub fn validate_static(payload: &str) -> Result<StaticQrisInfo, String> {
    let fields = parse(payload).map_err(|e| format!("malformed payload: {e}"))?;

    let get = |tag: &str| {
        fields
            .iter()
            .find(|f| f.tag == tag)
            .map(|f| f.value.clone())
    };

    let root = get("00").ok_or("missing payload format indicator (tag 00)")?;
    if root != "01" {
        return Err(format!("unsupported payload format indicator '{root}'"));
    }

    let currency = get("53").ok_or("missing transaction currency (tag 53)")?;
    if currency != "360" {
        return Err(format!(
            "unsupported currency '{currency}', expected 360 (IDR)"
        ));
    }

    let country = get("58").ok_or("missing country code (tag 58)")?;
    if country != "ID" {
        return Err(format!("unsupported country '{country}', expected ID"));
    }

    let merchant_name = get("59").ok_or("missing merchant name (tag 59)")?;

    // QRIS national block: tag 51 with subtag 00 = ID.CO.QRIS.WWW and 02 = NMID.
    let qris_block = get("51").ok_or("missing QRIS national block (tag 51)")?;
    let subs = parse_subfields(&qris_block).map_err(|e| format!("invalid tag 51: {e}"))?;
    let find_sub = |tag: &str| subs.iter().find(|f| f.tag == tag).map(|f| f.value.clone());

    let domain = find_sub("00").unwrap_or_default();
    if domain != "ID.CO.QRIS.WWW" {
        return Err(format!(
            "tag 51 subtag 00 is '{domain}', expected ID.CO.QRIS.WWW"
        ));
    }
    let nmid = find_sub("02").ok_or("missing NMID in tag 51 subtag 02")?;
    if !nmid.starts_with("ID") || nmid.len() < 5 {
        return Err(format!("invalid NMID '{nmid}'"));
    }

    // Merchant account template must exist (26-45 range) for a routable QRIS.
    let has_account = fields.iter().any(|f| {
        f.tag
            .parse::<u8>()
            .map(|t| (26..=45).contains(&t))
            .unwrap_or(false)
    });
    if !has_account {
        return Err("missing merchant account information template".to_string());
    }

    Ok(StaticQrisInfo {
        nmid,
        merchant_name,
        currency,
        country,
    })
}

/// Validate the transformed payload: structure intact, dynamic flag + amount set.
pub fn validate_dynamic(payload: &str, amount: i64) -> Result<(), String> {
    let fields: Vec<Tlv> = parse(payload).map_err(|e| format!("malformed output: {e}"))?;
    let get = |tag: &str| {
        fields
            .iter()
            .find(|f| f.tag == tag)
            .map(|f| f.value.clone())
    };

    if get("01").as_deref() != Some("12") {
        return Err("point of initiation method must be 12 (dynamic)".to_string());
    }
    let amount_tag = get("54").ok_or("missing transaction amount (tag 54)")?;
    let expected = format!("{}.00", amount);
    if amount_tag != expected {
        return Err(format!(
            "amount tag is '{amount_tag}', expected '{expected}'"
        ));
    }
    Ok(())
}
