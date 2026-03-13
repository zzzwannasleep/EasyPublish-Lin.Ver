# Nexus Publish Desktop

Electron + Vue 3 desktop publishing workstation for PT and NexusPHP workflows.

## Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
npm run build:win
npm run build:mac
```

## Project Layout

- `src/main`: privileged main-process services, storage, site adapters
- `src/preload`: typed renderer bridge contracts
- `src/renderer`: desktop UI shell, views, features, shared presentation
- `docs`: redesign plan and implementation backlog

## Notes

- The Electron app now lives at the repository root.
- The old Tauri/Rust prototype has been removed from the root workspace.
