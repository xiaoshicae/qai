use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, MasterPty};
use tauri::{AppHandle, Emitter};
use base64::Engine;

pub struct PtyState {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            writer: Mutex::new(None),
            master: Mutex::new(None),
        }
    }

    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
        self.kill().ok();

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("{e}"))?;

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let _child = pair.slave.spawn_command(cmd).map_err(|e| format!("{e}"))?;
        // slave 端在 spawn 后可以 drop
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| format!("{e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("{e}"))?;

        *self.writer.lock().unwrap() = Some(writer);
        *self.master.lock().unwrap() = Some(pair.master);

        // 后台线程读取 PTY 输出
        std::thread::spawn(move || {
            read_loop(app, reader);
        });

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
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| format!("{e}"))?;
        }
        Ok(())
    }

    pub fn kill(&self) -> Result<(), String> {
        *self.writer.lock().unwrap() = None;
        *self.master.lock().unwrap() = None;
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
            Err(_) => break,
        }
    }
    let _ = app.emit("pty-exit", ());
}
