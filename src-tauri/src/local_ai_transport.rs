//! GUI-side stdio transport. No Winsock, reqwest or Tokio network objects live here.
//! Even an access violation in a provider injected into the helper cannot unwind the GUI.
use super::{lock, LocalAI};
use std::{io::{Read, Write}, process::{Child, Command, Stdio}, sync::{mpsc, Arc, Mutex}, time::{Duration, Instant}};
use tauri::Manager;

const MAX_RESPONSE: u64 = 1024 * 1024 + 128;
struct OwnedHelper(Arc<Mutex<Child>>);
impl Drop for OwnedHelper {
    fn drop(&mut self) { if let Ok(mut child) = self.0.lock() { let _ = child.kill(); let _ = child.wait(); } }
}
pub struct Reply { pub status: u16, pub body: Vec<u8> }

fn run(app: &tauri::AppHandle, ai: &LocalAI, epoch: u64, input: Vec<u8>, timeout: Duration) -> Result<Vec<u8>, String> {
    if input.len() > 512 * 1024 + 256 { return Err("本机请求超过限额".into()); }
    let helper = app.path().resource_dir().map_err(|_| "找不到应用资源")?.join("runtime").join("loopback").join("previz-loopback.exe");
    if !helper.is_file() { return Err("安装包缺少隔离通信组件，请安装完整版本".into()); }
    let mut command = Command::new(&helper);
    command.current_dir(helper.parent().ok_or("隔离组件路径无效")?).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|_| "本机通信辅助进程无法启动")?;
    let stdin = child.stdin.take(); let stdout = child.stdout.take();
    let owned = OwnedHelper(Arc::new(Mutex::new(child)));
    { let mut e = lock(ai)?; if e.epoch != epoch { return Err("本次通信已取消".into()); } if e.helper.is_some() { return Err("本机通信组件正忙".into()); } e.helper = Some(owned.0.clone()); }
    let result = (|| {
        let mut stdin = stdin.ok_or("本机通信输入管道不可用")?;
        let stdout = stdout.ok_or("本机通信输出管道不可用")?;
        // Drain stdout concurrently: a reply must never block on a full Windows pipe.
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new().name("local-ai-pipe-reader".into()).spawn(move || {
            let mut bytes = Vec::new();
            let result = stdout.take(MAX_RESPONSE + 1).read_to_end(&mut bytes).map(|_| bytes);
            let _ = tx.send(result);
        }).map_err(|_| "无法读取通信辅助进程")?;
        std::thread::Builder::new().name("local-ai-pipe-writer".into()).spawn(move || { let _ = stdin.write_all(&input); }).map_err(|_| "无法提交本机通信请求")?;
        let deadline = Instant::now() + timeout + Duration::from_secs(2);
        loop {
            let status = { owned.0.lock().map_err(|_| "通信进程状态异常")?.try_wait().map_err(|_| "无法检查通信进程")? };
            if let Some(status) = status {
                if !status.success() {
                    let code = status.code().unwrap_or(-1) as u32;
                    return Err(format!("本机通信辅助进程退出（0x{code:08X}）。如 Windows 故障模块是 ASProxy64.dll，属于网络拦截组件兼容问题；本次不会修改场景。请保留错误码反馈。"));
                }
                break;
            }
            if lock(ai)?.epoch != epoch { return Err("本次通信已停止".into()); }
            if Instant::now() >= deadline { return Err("本机通信超时，辅助进程已停止".into()); }
            std::thread::sleep(Duration::from_millis(20));
        }
        let bytes = rx.recv_timeout(Duration::from_secs(1)).map_err(|_| "读取本机回复超时")?.map_err(|_| "读取本机回复失败")?;
        if bytes.len() as u64 > MAX_RESPONSE { return Err("本机回复超过大小限制".into()); }
        if lock(ai)?.epoch != epoch { return Err("本次通信已取消，结果不应用".into()); }
        Ok(bytes)
    })();
    if let Ok(mut e) = ai.0.lock() { if e.helper.as_ref().is_some_and(|h| Arc::ptr_eq(h, &owned.0)) { e.helper = None; } }
    result
}
async fn exchange(app: &tauri::AppHandle, epoch: u64, input: Vec<u8>, timeout: Duration) -> Result<Vec<u8>, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || { let ai = app.state::<LocalAI>(); run(&app, &ai, epoch, input, timeout) }).await.map_err(|_| "本机通信工作线程异常")?
}
fn split(bytes: &[u8]) -> Result<(&str, &[u8]), String> {
    let end = bytes.iter().position(|b| *b == b'\n').filter(|n| *n <= 64).ok_or("通信回复格式错误")?;
    let header = std::str::from_utf8(&bytes[..end]).map_err(|_| "通信回复编码错误")?;
    Ok((header, &bytes[end + 1..]))
}
pub async fn probe(app: &tauri::AppHandle, epoch: u64) -> Result<u16, String> {
    let bytes = exchange(app, epoch, b"PREVIZ-LOOPBACK/1\nprobe\n".to_vec(), Duration::from_secs(5)).await?;
    let (header, body) = split(&bytes)?;
    if !body.is_empty() { return Err("端口分配回复无效".into()); }
    header.strip_prefix("PORT ").ok_or("端口分配失败")?.parse::<u16>().ok().filter(|p| *p != 0).ok_or_else(|| "端口无效".into())
}
pub async fn request(app: &tauri::AppHandle, epoch: u64, kind: &str, port: u16, key: &str, body: Vec<u8>, timeout_ms: u64) -> Result<Reply, String> {
    if !["health", "chat"].contains(&kind) || key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) || port == 0 || !(1..=300000).contains(&timeout_ms) { return Err("无效本机通信参数".into()); }
    let mut input = format!("PREVIZ-LOOPBACK/1\n{kind}\n{port}\n{timeout_ms}\n{key}\n{}\n", body.len()).into_bytes(); input.extend(body);
    let bytes = exchange(app, epoch, input, Duration::from_millis(timeout_ms)).await?;
    let (header, body) = split(&bytes)?;
    let status = header.strip_prefix("STATUS ").and_then(|v| v.parse::<u16>().ok()).filter(|s| (200..=599).contains(s)).ok_or("通信回复状态无效")?;
    if body.len() > 1024 * 1024 { return Err("模型回复过大".into()); }
    Ok(Reply { status, body: body.to_vec() })
}
