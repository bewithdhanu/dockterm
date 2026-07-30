# DockTerm

Multi-tab SSH terminal with splits, snippets, and session restore.

## Desktop app (install)

Requires **Node.js 20–22** on your PATH (used for the PTY/SSH backend).

```bash
npm install
npm run dist:mac
```

Installers land in `release/`:

- `DockTerm-1.0.0-arm64.dmg` — drag into Applications
- `DockTerm.app` — also under `release/mac-arm64/`

Run without packaging:

```bash
npm run desktop
```

## Web / development

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run dev
```

Open http://localhost:5173

## Notes

- Unsigned macOS builds: right-click → Open the first time (Gatekeeper).
- Drop a logo into the project later and set `build.mac.icon` / favicon.
- Snippets live in `~/.ssh/shippets`.
