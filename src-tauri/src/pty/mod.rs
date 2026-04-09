use base64::Engine;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::errors::AppError;

/// PTY 内部状态，所有相关资源由单个 Mutex 保护，保证状态一致性
struct PtyInner {
    writer: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn MasterPty + Send>>,
    #[allow(dead_code)]
    slave: Option<Box<dyn portable_pty::SlavePty + Send>>,
    child: Option<Box<dyn portable_pty::Child + Send>>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
}

pub struct PtyState(Mutex<PtyInner>);

impl Default for PtyState {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyState {
    pub fn new() -> Self {
        Self(Mutex::new(PtyInner {
            writer: None,
            master: None,
            slave: None,
            child: None,
            reader_handle: None,
        }))
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, PtyInner>, AppError> {
        self.0.lock().map_err(|e| AppError::Generic(e.to_string()))
    }

    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16) -> Result<(), AppError> {
        self.kill().ok();

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Generic(format!("{e}")))?;

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

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Generic(format!("{e}")))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Generic(format!("{e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Generic(format!("{e}")))?;

        let handle = std::thread::spawn(move || {
            read_loop(app, reader);
        });

        let mut inner = self.lock_inner()?;
        inner.writer = Some(writer);
        inner.slave = Some(pair.slave);
        inner.master = Some(pair.master);
        inner.child = Some(child);
        inner.reader_handle = Some(handle);

        Ok(())
    }

    pub fn write_data(&self, data: &[u8]) -> Result<(), AppError> {
        let mut inner = self.lock_inner()?;
        if let Some(ref mut w) = inner.writer {
            w.write_all(data)
                .map_err(|e| AppError::Generic(format!("{e}")))?;
            w.flush().map_err(|e| AppError::Generic(format!("{e}")))?;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        let inner = self.lock_inner()?;
        if let Some(ref master) = inner.master {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| AppError::Generic(format!("{e}")))?;
        }
        Ok(())
    }

    pub fn kill(&self) -> Result<(), AppError> {
        let mut inner = self.lock_inner()?;
        // 先终止子进程
        if let Some(mut child) = inner.child.take() {
            if let Err(e) = child.kill() {
                log::warn!("终止 PTY 子进程失败: {e}");
            }
        }
        // 释放 writer/slave/master（关闭 fd 使 reader 线程 EOF 退出）
        inner.writer = None;
        inner.slave = None;
        inner.master = None;
        // 等待 reader 线程退出
        if let Some(handle) = inner.reader_handle.take() {
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
