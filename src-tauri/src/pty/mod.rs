use base64::Engine;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct PtyState {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    #[allow(dead_code)]
    slave: Mutex<Option<Box<dyn portable_pty::SlavePty + Send>>>,
    child: Mutex<Option<Box<dyn portable_pty::Child + Send>>>,
    reader_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            writer: Mutex::new(None),
            master: Mutex::new(None),
            slave: Mutex::new(None),
            child: Mutex::new(None),
            reader_handle: Mutex::new(None),
        }
    }

    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
        self.kill().ok();

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("{e}"))?;

        // 明确指定 shell 路径
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell，加载完整环境
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // 确保 PATH 包含常用路径
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        } else {
            cmd.env(
                "PATH",
                "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
            );
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", &home);
            cmd.cwd(&home);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("{e}"))?;

        let reader = pair.master.try_clone_reader().map_err(|e| format!("{e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("{e}"))?;

        *self.writer.lock().unwrap() = Some(writer);
        *self.slave.lock().unwrap() = Some(pair.slave);
        *self.master.lock().unwrap() = Some(pair.master);
        *self.child.lock().unwrap() = Some(child);

        let handle = std::thread::spawn(move || {
            read_loop(app, reader);
        });
        *self.reader_handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    pub fn write_data(&self, data: &[u8]) -> Result<(), String> {
        let mut guard = self.writer.lock().unwrap();
        if let Some(ref mut w) = *guard {
            w.write_all(data).map_err(|e| format!("{e}"))?;
            w.flush().map_err(|e| format!("{e}"))?;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.master.lock().unwrap();
        if let Some(ref master) = *guard {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("{e}"))?;
        }
        Ok(())
    }

    pub fn kill(&self) -> Result<(), String> {
        // 先终止子进程
        if let Some(mut child) = self.child.lock().unwrap().take() {
            if let Err(e) = child.kill() {
                log::warn!("终止 PTY 子进程失败: {e}");
            }
        }
        // 释放 writer/slave/master（关闭 fd 使 reader 线程 EOF 退出）
        *self.writer.lock().unwrap() = None;
        *self.slave.lock().unwrap() = None;
        *self.master.lock().unwrap() = None;
        // 等待 reader 线程退出（最多 1s）
        if let Some(handle) = self.reader_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        Ok(())
    }
}

fn read_loop(app: AppHandle, mut reader: Box<dyn Read + Send>) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                let _ = app.emit("pty-output", encoded);
            }
            Err(e) => {
                log::warn!("PTY reader 错误: {e}");
                break;
            }
        }
    }
    let _ = app.emit("pty-exit", ());
}
