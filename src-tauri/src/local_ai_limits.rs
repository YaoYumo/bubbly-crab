// Pure bounds used by the real bridge; runnable with rustc --test (no Tauri linking).
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 240
        && name.to_ascii_lowercase().ends_with(".gguf")
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':'))
        && !name.starts_with('.')
}

pub fn shard_names(name: &str) -> Result<Vec<String>, String> {
    if !name.contains("-of-") {
        return Ok(vec![name.into()]);
    }
    let (prefix, suffix) = name.rsplit_once("-00001-of-").ok_or("分片模型请选择第一片")?;
    let total: u32 = suffix.to_ascii_lowercase().strip_suffix(".gguf")
        .ok_or("分片文件名无效")?.parse().map_err(|_| "分片数量无效")?;
    if !(1..=64).contains(&total) {
        return Err("模型分片数量超出限制".into());
    }
    Ok((1..=total).map(|n| format!("{prefix}-{n:05}-of-{total:05}.gguf")).collect())
}

pub fn validate_messages<'a>(messages: impl IntoIterator<Item = (&'a str, &'a str)>) -> Result<(), String> {
    let mut count = 0;
    let mut bytes = 0;
    for (role, content) in messages {
        count += 1;
        if count > 12 { return Err("对话消息数量超出限制".into()); }
        if !["system", "user", "assistant"].contains(&role) { return Err("消息角色无效".into()); }
        bytes += content.len();
        if bytes > 64000 { return Err("场景或对话过长，请缩小场景后再试".into()); }
    }
    if count == 0 { return Err("对话消息数量超出限制".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_names_are_not_paths() {
        assert!(safe_name("Qwen2.5-7B-Instruct-Q4_K_M.gguf"));
        for n in ["../model.gguf", "C:\\x.gguf", "x.exe", ".hidden.gguf", "x/y.gguf", "", "x.gguf:payload"] {
            assert!(!safe_name(n));
        }
        assert!(!safe_name(&format!("{}.gguf", "x".repeat(240))));
    }
    #[test]
    fn shards_require_first_file_and_bounded_count() {
        assert_eq!(shard_names("q-00001-of-00002.gguf").unwrap(), vec!["q-00001-of-00002.gguf", "q-00002-of-00002.gguf"]);
        assert_eq!(shard_names("single.gguf").unwrap(), vec!["single.gguf"]);
        for n in ["q-00002-of-00002.gguf", "q-00001-of-00000.gguf", "q-00001-of-00065.gguf", "q-00001-of-garbage.gguf"] {
            assert!(shard_names(n).is_err());
        }
    }
    #[test]
    fn messages_require_allowed_roles_and_nonempty_conversation() {
        assert!(validate_messages([("system", "只返回JSON"), ("user", "搭建庭院")]).is_ok());
        assert!(validate_messages([("tool", "x")]).is_err());
        assert!(validate_messages([]).is_err());
    }
    #[test]
    fn message_count_and_utf8_bytes_are_bounded() {
        assert!(validate_messages(vec![("user", "x"); 12]).is_ok());
        assert!(validate_messages(vec![("user", "x"); 13]).is_err());
        assert!(validate_messages([("user", "x".repeat(64000).as_str())]).is_ok());
        assert!(validate_messages([("user", "x".repeat(64001).as_str())]).is_err());
        assert!(validate_messages([("user", "中".repeat(22000).as_str())]).is_err());
    }
}
