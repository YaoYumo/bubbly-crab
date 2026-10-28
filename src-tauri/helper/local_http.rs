//! Standalone, std-only blocking loopback client. Never linked into the GUI.
//! Native faults in a third-party Winsock provider terminate this child, not PREVIZ LAB.
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

const MAX_BODY: usize = 1024 * 1024;
const MAX_REQUEST: usize = 512 * 1024;
const MAX_HEADERS: usize = 32768;

fn line<R: BufRead>(r: &mut R, limit: usize) -> Result<String, String> {
    let mut bytes = Vec::new();
    r.take((limit + 3) as u64).read_until(b'\n', &mut bytes).map_err(|e| e.to_string())?;
    if !bytes.ends_with(b"\n") { return Err("invalid or oversized header".into()); }
    bytes.pop();
    if bytes.ends_with(b"\r") { bytes.pop(); }
    if bytes.len() > limit { return Err("invalid or oversized header".into()); }
    String::from_utf8(bytes).map_err(|_| "invalid header encoding".into())
}
fn remaining(deadline: Instant) -> Result<Duration, String> {
    deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()).ok_or_else(|| "loopback request timed out".into())
}
fn read_some(r: &mut BufReader<TcpStream>, dst: &mut [u8], deadline: Instant) -> Result<usize, String> {
    r.get_ref().set_read_timeout(Some(remaining(deadline)?)).map_err(|e| e.to_string())?;
    r.read(dst).map_err(|e| e.to_string())
}
fn read_exact(r: &mut BufReader<TcpStream>, count: usize, body: &mut Vec<u8>, deadline: Instant) -> Result<(), String> {
    if count > MAX_BODY.saturating_sub(body.len()) { return Err("response exceeds 1 MiB".into()); }
    let mut left = count;
    let mut buf = [0u8; 8192];
    while left > 0 {
        let size = left.min(buf.len());
        let n = read_some(r, &mut buf[..size], deadline)?;
        if n == 0 { return Err("truncated HTTP body".into()); }
        body.extend_from_slice(&buf[..n]); left -= n;
    }
    Ok(())
}
fn http_line(r: &mut BufReader<TcpStream>, budget: &mut usize, deadline: Instant) -> Result<String, String> {
    r.get_ref().set_read_timeout(Some(remaining(deadline)?)).map_err(|e| e.to_string())?;
    let s = line(r, 8192.min(*budget))?;
    *budget = budget.checked_sub(s.len() + 2).ok_or("HTTP headers too large")?;
    remaining(deadline)?; Ok(s)
}
fn response(stream: TcpStream, deadline: Instant) -> Result<(u16, Vec<u8>), String> {
    let mut r = BufReader::new(stream);
    let mut budget = MAX_HEADERS;
    let status = http_line(&mut r, &mut budget, deadline)?;
    let mut fields = status.split_whitespace();
    if !matches!(fields.next(), Some("HTTP/1.0" | "HTTP/1.1")) { return Err("invalid HTTP version".into()); }
    let code: u16 = fields.next().ok_or("missing HTTP status")?.parse().map_err(|_| "invalid HTTP status")?;
    if !(200..=599).contains(&code) { return Err("unsupported HTTP status".into()); }
    let mut length = None;
    let mut chunked = false;
    loop {
        let h = http_line(&mut r, &mut budget, deadline)?;
        if h.is_empty() { break; }
        let (key, value) = h.split_once(':').ok_or("malformed HTTP header")?;
        let value = value.trim();
        if key.eq_ignore_ascii_case("Content-Length") {
            if length.is_some() { return Err("duplicate Content-Length".into()); }
            let n: usize = value.parse().map_err(|_| "invalid Content-Length")?;
            if n > MAX_BODY { return Err("response exceeds 1 MiB".into()); } length = Some(n);
        }
        if key.eq_ignore_ascii_case("Transfer-Encoding") {
            if chunked || !value.eq_ignore_ascii_case("chunked") { return Err("unsupported transfer encoding".into()); } chunked = true;
        }
        if key.eq_ignore_ascii_case("Content-Encoding") && !value.eq_ignore_ascii_case("identity") { return Err("compressed responses not accepted".into()); }
    }
    if chunked && length.is_some() { return Err("ambiguous HTTP body framing".into()); }
    let mut body = Vec::new();
    if chunked {
        loop {
            let h = http_line(&mut r, &mut budget, deadline)?;
            let n = usize::from_str_radix(h.split(';').next().unwrap_or("").trim(), 16).map_err(|_| "invalid chunk size")?;
            if n == 0 {
                while !http_line(&mut r, &mut budget, deadline)?.is_empty() {} break;
            }
            read_exact(&mut r, n, &mut body, deadline)?;
            if !http_line(&mut r, &mut budget, deadline)?.is_empty() { return Err("invalid chunk terminator".into()); }
        }
    } else if let Some(n) = length { read_exact(&mut r, n, &mut body, deadline)?; }
    else {
        let mut buf = [0; 8192];
        loop { let n = read_some(&mut r, &mut buf, deadline)?; if n == 0 { break; } if n > MAX_BODY.saturating_sub(body.len()) { return Err("response exceeds 1 MiB".into()); } body.extend_from_slice(&buf[..n]); }
    }
    Ok((code, body))
}
fn request(port: u16, kind: &str, key: &str, body: &[u8], timeout: Duration) -> Result<(u16, Vec<u8>), String> {
    if port == 0 || key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) || body.len() > MAX_REQUEST { return Err("invalid bounded request".into()); }
    let (method, path) = match kind { "health" if body.is_empty() => ("GET", "/health"), "chat" => ("POST", "/v1/chat/completions"), _ => return Err("unsupported operation".into()) };
    let deadline = Instant::now() + timeout;
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), timeout.min(Duration::from_secs(2))).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(remaining(deadline)?)).map_err(|e| e.to_string())?;
    let header = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {key}\r\nContent-Type: application/json\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", body.len());
    stream.write_all(header.as_bytes()).and_then(|_| stream.write_all(body)).map_err(|e| e.to_string())?;
    response(stream, deadline)
}
fn run<R: BufRead, W: Write>(input: &mut R, output: &mut W) -> Result<(), String> {
    if line(input, 32)? != "PREVIZ-LOOPBACK/1" { return Err("invalid helper protocol".into()); }
    let kind = line(input, 32)?;
    if kind == "probe" {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
        writeln!(output, "PORT {}", socket.local_addr().map_err(|e| e.to_string())?.port()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    if !["health", "chat"].contains(&kind.as_str()) { return Err("unsupported operation".into()); }
    let port = line(input, 8)?.parse().map_err(|_| "invalid port")?;
    let ms: u64 = line(input, 8)?.parse().map_err(|_| "invalid timeout")?;
    if !(1..=300000).contains(&ms) { return Err("timeout out of bounds".into()); }
    let key = line(input, 64)?;
    let size: usize = line(input, 12)?.parse().map_err(|_| "invalid request length")?;
    if size > MAX_REQUEST { return Err("request too large".into()); }
    let mut body = vec![0; size]; input.read_exact(&mut body).map_err(|_| "truncated request")?;
    let (code, body) = request(port, &kind, &key, &body, Duration::from_millis(ms))?;
    writeln!(output, "STATUS {code}").and_then(|_| output.write_all(&body)).map_err(|e| e.to_string())
}
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") { println!("PREVIZ loopback helper 1"); return; }
    if let Err(e) = run(&mut io::stdin().lock(), &mut io::stdout().lock()) {
        // Never echo the request/key/model/user prompt into error messages.
        eprintln!("loopback helper: {e}"); std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn serve(data: Vec<u8>) -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let server = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap(); let port = server.local_addr().unwrap().port();
        let thread = std::thread::spawn(move || { let (mut socket, _) = server.accept().unwrap(); socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap(); let mut read = Vec::new(); let mut byte = [0]; while !read.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); read.push(byte[0]); } let _ = socket.write_all(&data); read });
        (port, thread)
    }
    fn fetch(data: &[u8]) -> Result<(u16, Vec<u8>), String> { let (port, thread) = serve(data.to_vec()); let result = request(port,"health", &"a".repeat(64), &[], Duration::from_secs(3)); let _ = thread.join(); result }
    #[test] fn content_length_and_authorization() { let (port, thread) = serve(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec()); assert_eq!(request(port,"health", &"a".repeat(64), &[], Duration::from_secs(3)).unwrap(),(200,b"{}".to_vec())); let text = String::from_utf8(thread.join().unwrap()).unwrap(); assert!(text.starts_with("GET /health HTTP/1.1\r\n")); assert!(text.contains(&format!("Authorization: Bearer {}", "a".repeat(64)))); }
    #[test] fn complete_wire_protocol_accepts_64_byte_key() { let (port, thread)=serve(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec()); let input=format!("PREVIZ-LOOPBACK/1\nhealth\n{port}\n2000\n{}\n0\n", "a".repeat(64)); let mut out=Vec::new();run(&mut input.as_bytes(), &mut out).unwrap(); assert_eq!(out,b"STATUS 200\n{}");thread.join().unwrap(); }
    #[test] fn line_limit_excludes_line_terminator() { for ending in ["\n","\r\n"] { assert_eq!(line(&mut format!("{}{}", "a".repeat(64),ending).as_bytes(),64).unwrap().len(),64); } assert!(line(&mut format!("{}\n", "a".repeat(65)).as_bytes(),64).is_err()); assert!(line(&mut "a".repeat(64).as_bytes(),64).is_err()); }
    #[test] fn chunked() { assert_eq!(fetch(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n").unwrap().1, b"{}"); }
    #[test] fn close_delimited() { assert_eq!(fetch(b"HTTP/1.0 200 OK\r\n\r\n{}").unwrap().1, b"{}"); }
    #[test] fn redirects_not_followed() { assert_eq!(fetch(b"HTTP/1.1 302 Found\r\nLocation: https://example.invalid/\r\nContent-Length: 0\r\n\r\n").unwrap().0, 302); }
    #[test] fn bounds_and_truncation() { for data in [b"HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\n\r\n".as_slice(), b"HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\nx", b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n", b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx", b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n100001\r\n"] { assert!(fetch(data).is_err()); } }
    #[test] fn input_is_bounded_and_not_a_url() { for input in ["BAD\nprobe\n", "PREVIZ-LOOPBACK/1\nhttps://evil\n", "PREVIZ-LOOPBACK/1\nchat\n80\n300001\n", "PREVIZ-LOOPBACK/1\nchat\n80\n1\ninvalid\n524289\n"] { assert!(run(&mut input.as_bytes(),&mut Vec::new()).is_err()); } assert!(request(80,"other","a",&[],Duration::from_millis(1)).is_err()); }
    #[test] fn probe_binds_only_loopback() { let mut out = Vec::new(); run(&mut b"PREVIZ-LOOPBACK/1\nprobe\n".as_slice(), &mut out).unwrap(); let port: u16 = String::from_utf8(out).unwrap().trim().strip_prefix("PORT ").unwrap().parse().unwrap(); assert!(port > 0); }
    #[test] fn io_timeout() { let server = TcpListener::bind((Ipv4Addr::LOCALHOST,0)).unwrap(); let port=server.local_addr().unwrap().port(); let thread=std::thread::spawn(move||{let (_s,_)=server.accept().unwrap();std::thread::sleep(Duration::from_millis(150));}); let start=Instant::now(); assert!(request(port,"health",&"a".repeat(64),&[],Duration::from_millis(30)).is_err()); assert!(start.elapsed()<Duration::from_secs(2));thread.join().unwrap(); }
}
