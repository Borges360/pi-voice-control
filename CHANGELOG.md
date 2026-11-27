# Changelog

## Unreleased

### Themes

- On load, the extension copies the terminal adapter's color themes to `<agent-dir>/themes/` and lists them in the running session, so they appear in `/settings` without a separate install. It never selects a theme or overwrites an edited one; `PI_DESIGN_THEMES=off` skips the copy.

### Terminal adapter

- The vendored adapter moves to `@inteiro/terminal` 2.0.0-rc.1 (`6a1bd7d`). The focused row gets the host selection background (`selectedBg`) across the width; Save is painted as a real effect (`bashMode`, bold) and the other buttons as choices (`accent`); the empty search line no longer appears above the list and only shows while a filter is active.

### Open source

- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and `SECURITY.md` with private vulnerability reporting.
- README reorganized with the same sections in English and Brazilian Portuguese.
- `package.json` declares `bugs` and `homepage`.

No version bump and no publication yet.

### Changed

- The `/voice` panel now runs on a vendored Pi settings adapter (`src/vendor/inteiro-terminal`,
  provenance and license in `src/vendor/THIRD_PARTY_NOTICES.md`). The hand-written
  `src/ui/settings-panel.ts` was removed.
- Pi peer range is now `>=1.5.2 <1.7.0`; development dependencies use Pi 1.6.0.
- With unsaved changes, the first `Esc` shows a decision (continue / save and close / discard);
  the second `Esc` discards and closes, as before.
- Lists stop at the first and last row instead of wrapping around.
- The microphone is a field whose device list is read when the field is opened.
- The transcription language is validated when the field is confirmed, not only on save.
- Values set by `.pi/voice-control.json`, `PI_VOICE_*` or `--voice-*` show their source, cannot be
  edited in the panel and are no longer copied into the global file on `Ctrl+S`.
- A pending shortcut change shows `(/reload pending)` next to the shortcut; the save message no
  longer repeats the shortcut.
- The panel opens at 85% of the terminal width with a 40-column minimum; below 40×12 it asks you to
  resize.
- `Ctrl+C` belongs to the Pi host while the panel is open (it no longer acts like `Esc`).
- Model download progress messages are written in English and translated to Brazilian Portuguese.

### Added

- `Tab` action bar (save, help, close), `/` search and help (`F1`/`?`) in the panel.
- A save that cannot be confirmed asks to check storage (`Ctrl+S`) before writing again.
- `npm run smoke:host`: loads the extension with the installed Pi loader and renders the panel.
- While the panel is open, the dictation shortcut key reaches the panel instead of being swallowed,
  so `F1` opens the panel help even when `F1` is the dictation shortcut. Dictation still cannot
  start while the panel is open.
- If the global file has a value that is invalid on its own but is masked by a project/env/CLI
  value, the panel warns and `Ctrl+S` writes the default for that key. Project/env/CLI values are
  never copied into the global file.

### Removed

- The unreferenced design-system mark (`docs/assets/inteiro-mark.svg`) and its attribution file are
  no longer shipped.

### Fixed

- Closing the panel (`Esc`, `/reload`, session end, `/voice cancel`) again waits for a running
  check, test, download or save to stop before `/voice` returns, so no FFmpeg, download or Whisper
  work outlives it. 0.3.0 did this; the first adapter migration had dropped it.
- The help screen (`?`/`F1`) shows the field description once (adapter fix, re-vendored).
