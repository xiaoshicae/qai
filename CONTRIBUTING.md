# Contributing to QAI

Thank you for your interest in contributing to QAI! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- **Rust** 1.77+ (install via [rustup](https://rustup.rs/))
- **Node.js** 22+ (install via [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm))
- **npm** (comes with Node.js)

### Getting Started

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/qai.git
cd qai

# Install frontend dependencies
npm install

# Run in development mode (hot reload enabled)
cargo tauri dev
```

## Project Structure

```
qai/
├── src/                    # React frontend (TypeScript)
│   ├── components/         # UI components
│   ├── stores/             # Zustand state management
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions
│   └── views/              # Page-level components
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── commands/       # Tauri IPC commands
│   │   ├── db/             # Database operations
│   │   ├── http/           # HTTP client logic
│   │   └── lib.rs          # Main entry point
│   └── Cargo.toml          # Rust dependencies
├── .claude/                # AI assistant rules & skills
└── doc/                    # Documentation
```

## Code Style

### Frontend (TypeScript/React)

- Use **ESLint** and **Prettier** for code formatting
- Run linting: `npm run lint`
- Fix lint issues: `npm run lint:fix`
- Format code: `npm run format`

Key conventions:
- Use functional components with hooks
- Prefer `const` over `let`
- Use semantic variable names
- Add comments for complex logic

### Backend (Rust)

- Run `cargo fmt` before committing
- Run `cargo clippy` and fix all warnings
- Follow standard Rust naming conventions

```bash
cd src-tauri
cargo fmt -- --check
cargo clippy -- -D warnings
```

## Testing

### Frontend Tests

```bash
npm run test
```

### Backend Tests

```bash
cd src-tauri
cargo test
```

### Run All Tests

```bash
npm run test && cd src-tauri && cargo test
```

## Pull Request Process

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/amazing-feature
   ```

2. **Make your changes** following the code style guidelines above.

3. **Run tests** to ensure nothing is broken:
   ```bash
   npm run test
   cd src-tauri && cargo test
   ```

4. **Run linting**:
   ```bash
   npm run lint
   cd src-tauri && cargo clippy -- -D warnings
   ```

5. **Commit your changes** with a clear message:
   ```bash
   git commit -m "feat: add amazing feature"
   ```

   Commit message prefixes:
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `docs:` — Documentation changes
   - `refactor:` — Code refactoring
   - `test:` — Adding/updating tests
   - `chore:` — Maintenance tasks

6. **Push and create a Pull Request**:
   ```bash
   git push origin feat/amazing-feature
   ```

7. **Ensure CI passes** — All checks must pass before merging.

## Development Tips

### Debugging

- Use browser DevTools in dev mode (Cmd+Option+I on macOS)
- Check Tauri console output for backend logs
- Use `console.warn` / `console.error` for frontend debugging

### Database

The SQLite database is stored at:
- macOS: `~/Library/Application Support/com.qai.app/qai.db`
- Windows: `%APPDATA%\com.qai.app\qai.db`
- Linux: `~/.config/com.qai.app/qai.db`

### Useful Commands

```bash
# Build for production
cargo tauri build

# Check Rust code without building
cd src-tauri && cargo check

# Update Rust dependencies
cd src-tauri && cargo update

# Clean build artifacts
cargo clean
```

## Questions?

Feel free to open an issue for questions or discussions before starting work on a significant change.

---

Thank you for contributing to QAI!
