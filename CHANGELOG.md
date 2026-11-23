# Changelog

## Unreleased

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
