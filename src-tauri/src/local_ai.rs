//! Application-owned local inference only. No arbitrary URL, command or model path.
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, net::TcpListener, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex, time::Duration};
use tauri::Manager;
use crate::local_ai_limits::{safe_name, shard_names};

#[derive(Default)]
struct Engine { child: Option<Child>, port: u16, key: String, model: String, cpu: bool, loading: bool, busy: bool, epoch: u64 }
impl Engine {
    fn stop(&mut self) {
        self.epoch += 1;
        if let Some(mut child) = self.child.take() { let _ = child.kill(); let _ = child.wait(); }
        self.loading = false; self.busy = false; self.model.clear(); self.key.clear();
    }
}
impl Drop for Engine { fn drop(&mut self) { self.stop(); } }
#[derive(Default)]
pub struct LocalAI(Mutex<Engine>);
impl LocalAI { pub fn stop(&self) { if let Ok(mut e) = self.0.lock() { e.stop(); } } }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model { name: String, bytes: u64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { models: Vec<Model>, folder: String, engine_present: bool, loaded_model: String, loading: bool, busy: bool }
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Message { role: String, content: String }

fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法验证本地窗口")?;
    let packaged = url.scheme() == "tauri" || (url.scheme() == "https" && url.host_str() == Some("tauri.localhost"));
    let development = cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(5180);
    if window.label() != "main" || (!packaged && !development) { return Err("仅应用本地主窗口可访问模型".into()); }
    Ok(())
}
fn model_folder() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "找不到安装目录")?;
    let folder = exe.parent().ok_or("找不到安装目录")?.join("models");
    fs::create_dir_all(&folder).map_err(|_| "无法创建模型文件夹，请检查安装目录权限")?;
    folder.canonicalize().map_err(|_| "无法读取模型文件夹".into())
}
fn resolve_model(name: &str) -> Result<PathBuf, String> {
    if !safe_name(name) { return Err("请选择 models 文件夹里的 GGUF 模型，不接受任意路径".into()); }
    let folder = model_folder()?;
    let path = folder.join(name).canonicalize().map_err(|_| "模型文件不存在或尚未下载完成")?;
    if path.parent() != Some(folder.as_path()) { return Err("模型不能链接到 models 目录之外".into()); }
    let mut file = fs::File::open(&path).map_err(|_| "无法读取模型")?;
    let mut header = [0; 4];
    file.read_exact(&mut header).map_err(|_| "模型文件不完整")?;
    if &header != b"GGUF" || file.metadata().map_err(|_| "无法读取模型信息")?.len() < 1024 * 1024 {
        return Err("不是有效的完整 GGUF 文件，请确认下载已完成".into());
    }
    Ok(path)
}
fn check_shards(name: &str) -> Result<(), String> {
    for shard in shard_names(name)? {
        resolve_model(&shard).map_err(|_| "模型分片缺失或链接到了 models 文件夹之外，请将所有分片完整放在一起")?;
    }
    Ok(())
}
fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().resource_dir().map_err(|_| "找不到应用资源")?.join("runtime").join("llama");
    let path = root.join("llama-server.exe");
    if !path.is_file() { return Err("安装包缺少本地推理引擎，请重新安装完整版本".into()); }
    Ok(path)
}
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(300)).build().map_err(|_| "无法创建本机连接".into())
}
fn lock(ai: &LocalAI) -> Result<std::sync::MutexGuard<'_, Engine>, String> { ai.0.lock().map_err(|_| "本地引擎状态异常".into()) }

#[tauri::command]
pub fn local_ai_status(app: tauri::AppHandle, window: tauri::WebviewWindow, ai: tauri::State<'_, LocalAI>) -> Result<Status, String> {
    authorize(&window)?;
    let folder = model_folder()?;
    let mut models = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|_| "无法读取模型目录")?.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            // Only first shards are selectable; llama.cpp resolves the other shards.
            if safe_name(name) && (!name.contains("-of-") || name.contains("-00001-of-")) && resolve_model(name).is_ok() {
                models.push(Model { name: name.into(), bytes: entry.metadata().map(|m| m.len()).unwrap_or(0) });
            }
        }
    }
    models.sort_by(|a,b| a.name.cmp(&b.name));
    let mut engine = lock(&ai)?;
    if engine.child.as_mut().and_then(|c| c.try_wait().ok().flatten()).is_some() { engine.stop(); }
    Ok(Status { models, folder: folder.to_string_lossy().into(), engine_present: engine_path(&app).is_ok(), loaded_model: engine.model.clone(), loading: engine.loading, busy: engine.busy })
}
#[tauri::command]
pub fn local_ai_open_folder(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let folder = model_folder()?;
    let explorer = PathBuf::from(std::env::var_os("WINDIR").ok_or("找不到系统资源管理器")?).join("explorer.exe");
    Command::new(explorer).arg(folder).spawn().map_err(|_| "无法打开模型目录")?;
    Ok(())
}
#[tauri::command]
pub fn local_ai_stop(window: tauri::WebviewWindow, ai: tauri::State<'_, LocalAI>) -> Result<(), String> { authorize(&window)?; ai.stop(); Ok(()) }

async fn ensure_loaded(app: &tauri::AppHandle, ai: &LocalAI, name: &str, cpu: bool) -> Result<(u16, String, u64), String> {
    let path = resolve_model(name)?;
    check_shards(name)?;
    let (port, key, epoch) = {
        let mut e = lock(ai)?;
        if e.busy || e.loading { return Err("模型正在处理上一条请求，请等待或停止".into()); }
        if e.child.as_mut().and_then(|c| c.try_wait().ok().flatten()).is_some() { e.stop(); }
        if e.child.is_some() && e.model == name && e.cpu == cpu { return Ok((e.port, e.key.clone(), e.epoch)); }
        e.stop();
        let binary = engine_path(app)?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "无法分配本机推理端口")?;
        let port = listener.local_addr().map_err(|_| "无法读取本机端口")?.port();
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|_| "无法生成本机访问口令")?;
        let key: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let log_dir = app.path().app_log_dir().map_err(|_| "找不到日志目录")?;
        fs::create_dir_all(&log_dir).map_err(|_| "无法创建引擎日志目录")?;
        let log = fs::File::create(log_dir.join("local-model.log")).map_err(|_| "无法创建引擎日志")?;
        let mut command = Command::new(&binary);
        command.current_dir(binary.parent().ok_or("引擎路径无效")?).args(["--host", "127.0.0.1", "--port", &port.to_string(), "--alias", "previz-local", "--ctx-size", "16384", "--parallel", "1", "--n-gpu-layers", if cpu { "0" } else { "99" }, "--api-key", &key, "--jinja", "--model"]).arg(path).stdin(Stdio::null()).stdout(Stdio::from(log.try_clone().map_err(|_| "无法写入日志")?)).stderr(Stdio::from(log));
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        drop(listener);
        e.child = Some(command.spawn().map_err(|_| "引擎启动失败；请重新安装完整版本并检查显卡驱动")?);
        e.port = port; e.key = key.clone(); e.model = name.into(); e.cpu = cpu; e.loading = true;
        (port, key, e.epoch)
    };
    let client = http()?;
    for _ in 0..360 {
        {
            let mut e = lock(ai)?;
            if e.epoch != epoch { return Err("模型加载已停止".into()); }
            if e.child.as_mut().and_then(|c| c.try_wait().ok().flatten()).is_some() {
                e.stop(); return Err("模型进程退出。请确认 GGUF 文件完整；显存不足或驱动不兼容时可勾选 CPU 模式重试，详细信息见应用日志 local-model.log".into());
            }
        }
        if let Ok(response) = client.get(format!("http://127.0.0.1:{port}/health")).bearer_auth(&key).timeout(Duration::from_secs(1)).send().await {
            if response.status().is_success() {
                let mut e = lock(ai)?;
                if e.epoch != epoch { return Err("模型加载已停止".into()); }
                e.loading = false;
                return Ok((port,key,epoch));
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if let Ok(mut e) = ai.0.lock() { if e.epoch == epoch { e.stop(); } }
    Err("首次模型加载超时，已停止本次引擎；可检查日志或使用较小模型 / CPU 模式重试".into())
}
fn validate_messages(messages: &[Message]) -> Result<(), String> {
    crate::local_ai_limits::validate_messages(messages.iter().map(|m| (m.role.as_str(), m.content.as_str())))
}
#[tauri::command]
pub async fn local_ai_chat(app: tauri::AppHandle, window: tauri::WebviewWindow, ai: tauri::State<'_, LocalAI>, model: String, messages: Vec<Message>, cpu_only: bool) -> Result<String, String> {
    authorize(&window)?; validate_messages(&messages)?;
    let (port,key,epoch) = ensure_loaded(&app, &ai, &model, cpu_only).await?;
    { let mut e = lock(&ai)?; if e.epoch != epoch || e.busy { return Err("本地模型忙或请求已取消".into()); } e.busy = true; }
    let result: Result<String,String> = async {
        let mut response = http()?.post(format!("http://127.0.0.1:{port}/v1/chat/completions")).bearer_auth(key).json(&serde_json::json!({"model":"previz-local","messages":messages,"temperature":0.2,"max_tokens":3072,"stream":false,"response_format":{"type":"json_object"}})).send().await.map_err(|_| "本地推理连接失败或超时；可停止后重试，不会自动重复生成")?;
        if !response.status().is_success() { return Err(format!("本地模型返回 HTTP {}，可能是上下文过长或模型不兼容",response.status().as_u16())); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "读取模型回复失败")? { if bytes.len()+chunk.len() > 1024*1024 { return Err("模型回复过大，未应用".into()); } bytes.extend_from_slice(&chunk); }
        let json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "模型接口返回无效 JSON")?;
        let content = json["choices"][0]["message"]["content"].as_str().ok_or("模型没有返回文本")?;
        if lock(&ai)?.epoch != epoch { return Err("本次对话已停止，结果不应用".into()); }
        Ok(content.into())
    }.await;
    if let Ok(mut e) = ai.0.lock() { if e.epoch == epoch { e.busy = false; } }
    result
}
