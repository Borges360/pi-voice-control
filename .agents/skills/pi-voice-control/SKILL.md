---
name: pi-voice-control
description: Maintain Pi Voice Control local dictation, settings, cancellation, privacy and compatibility contracts.
---

# Pi Voice Control

Use this specialization for work in the Pi Voice Control repository. The shared workspace catalog supplies general Harness procedures; this document records the extension's local voice and privacy boundaries.

## Product role

- Pi Voice Control provides local dictation through FFmpeg capture and a separate local Whisper process. Text is pasted into the editor for the person to review; it is not submitted automatically.
- Audio capture requires an explicit shortcut, command or confirmed test action. Opening the menu or reading status must not start capture or download a model.
- The supported Whisper set is tiny, base and small. Inference runs locally. Network is limited to downloading or repairing the selected model during setup; do not add an HTTP transcription provider, cloud fallback or credentials.

## Safety and privacy

- Treat recognized text as untrusted data. Do not execute, rewrite with an LLM, submit, persist in memory, or include it in logs or test fixtures.
- Do not read real audio, transcriptions, microphone input, persistent Pi voice settings or model-cache data during ordinary development.
- Use synthetic offline fixtures. Microphone integration requires the explicit VOICE_MIC_TEST=1 gate and separate authorization.
- Preserve cleanup, cancellation, time/size limits and the rule that callbacks from an invalidated operation cannot write into a newer session.
- This extension has the operating-system privileges of the Pi user and is not an OS sandbox.

## Pi interface and configuration

- /voice opens the panel; /voice settings is an alias. Changes remain drafts until Ctrl+S. Escape returns or discards according to the panel contract. Microphone and dictation checks are separate confirmed actions.
- User and trusted-project settings have distinct scope. Do not alter persistent settings or model selection without explicit user action.
- Read README.md, pi-voice-control-spec.md, docs/ARCHITECTURE.md and docs/EXTENSION_UX.md before behavior changes.
- The declared Pi peer range is >=1.3.0 and <1.4.0. The existing Pi 1.4.0 observation is status-only and does not broaden compatibility.
- No INTEIRO design-system role is selected. Preserve the bundled mark's separate attribution and license notice.
- Context-only work uses tests/agent-context.test.mjs and .harness/project.mjs verify. Real audio, host smoke, model downloads, network, publication and remote changes require separate authorization.
