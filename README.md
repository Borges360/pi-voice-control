# Pi Voice Control

Local voice dictation for Pi Coding Agent: press `F8` to record, press it again to stop, and the transcribed text is pasted into the editor for review.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![validate](https://github.com/Borges360/pi-voice-control/actions/workflows/validate.yml/badge.svg)](https://github.com/Borges360/pi-voice-control/actions/workflows/validate.yml)

**English** · [Português (Brasil)](#português-brasil)

| | |
| --- | --- |
| Package | `@borges360/pi-voice-control` · `0.3.0` |
| Status | Development release, not published to npm yet. Install from Git. |
| Compatibility | Node.js `>=22.19.0` · Pi SDK peer dependencies `>=1.5.2 <1.7.0` · developed and smoke-tested with Pi `1.6.0` |

## English

### What it does

Pi Voice Control adds local dictation to the Pi editor. FFmpeg captures the audio, and a separate local Whisper process transcribes it with the `tiny`, `base` or `small` model. The text is pasted into the current editor.

> The extension never submits the text, runs it as a command or rewrites it with an LLM. You review it in the editor before doing anything with it.

### Install

~~~powershell
pi install git:github.com/Borges360/pi-voice-control
~~~

This installs from Git, not from the npm registry.

Requirements:

- Node.js `>=22.19.0`.
- A Pi host in the declared peer range.
- FFmpeg on `PATH`.
- On Windows, microphone access for desktop apps must be enabled.

Setup downloads the selected model from Hugging Face into `<agent-dir>/cache/voice-control`. The default is `tiny`, about 45 MB. `<agent-dir>` is `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. Model weights are not included in Git or in the package.

The download needs network access during install or repair. Once the model is prepared, transcription runs locally and blocks network fetches. To defer setup, set `PI_VOICE_SKIP_LOCAL_SETUP=1` and later use **Prepare model** in the settings panel.

### Use

| Command or key | Action |
| --- | --- |
| `F8` | Start or stop dictation (default shortcut) |
| `/voice` or `/voice settings` | Open the settings panel; edits stay a draft until `Ctrl+S` |
| `/voice start` | Start recording |
| `/voice stop` | Stop, transcribe and paste once |
| `/voice cancel` | Cancel the active operation and keep the editor as it is |
| `/voice status` | Show state, model, microphone, language and shortcut |
| `/voice doctor` | Check FFmpeg, devices and local model readiness |
| `/voice model [tiny\|base\|small]` | List models or switch the model for this session; use the panel to prepare and save it |

In the settings panel:

- `↑`/`↓` move, `Enter` edits a field or runs an action, and `Ctrl+S` saves while the panel stays open.
- To change the model, choose it and press `Ctrl+S`; the model is prepared before the setting is saved.
- `Esc` leaves a field without applying it. With unsaved changes, the first `Esc` warns and the second discards them and closes the panel.
- `Esc` during a check, test, download or save cancels it.
- The microphone list is read only when you open the **Microphone** field.
- Values set by the project file, `PI_VOICE_*` or `--voice-*` show their source and are not written to the global file.
- Opening the panel or moving through it never starts a recording or downloads a model.
- **Test microphone** and **Test dictation** ask for confirmation first. **Start dictation** asks you to save pending changes first.

### Configuration and state

| File | Scope |
| --- | --- |
| `<agent-dir>/voice-control.json` | Global (`~/.pi/agent/voice-control.json` by default; `PI_CODING_AGENT_DIR` selects another Pi profile) |
| `.pi/voice-control.json` | Project override, ignored by Git |

Both files take partial JSON and are checked against the [configuration schema](schemas/voice-control.schema.json):

~~~json
{
  "language": "pt",
  "transcription": { "model": "base" }
}
~~~

Precedence, highest first:

1. Command flags: `--voice-model`, `--voice-language` (for the Pi session).
2. Environment variables: `PI_VOICE_MODEL`, `PI_VOICE_LANGUAGE`, `PI_VOICE_SHORTCUT`.
3. Project configuration.
4. Global configuration.
5. The model selected at install time.
6. The `tiny` default.

`/voice model` changes the active model for the current session only. Other environment variables: `PI_CODING_AGENT_DIR` (Pi profile directory), `PI_VOICE_FFMPEG` (FFmpeg executable) and `PI_VOICE_SKIP_LOCAL_SETUP` (defer model setup). The speech language defaults to `pt` and accepts `auto` or any language code Whisper supports.

Themes: on load, the extension copies the color themes of its terminal adapter to `<agent-dir>/themes/`, so they are listed in `/settings` → **Theme**. It never changes the selected theme and never overwrites a theme file you edited. Set `PI_DESIGN_THEMES=off` to skip the copy.

### Language

The speech-language setting controls transcription, not the interface. To change the interface language, open `/voice settings`, choose **Language** and preview English or Brazilian Portuguese. The choice is saved only when you press `Ctrl+S` in a trusted project, to `.pi/pi-voice-control.locale.json`. Untrusted projects stay in English. `Esc` discards an unsaved preview.

### Privacy and security

- The extension runs with the operating-system privileges of the Pi user. It is not an OS sandbox.
- Audio capture starts only after an explicit shortcut or command.
- Recording stops at 120 seconds. Temporary audio is capped at 3.84 MB and removed after use or cancellation.
- Audio and transcripts are not stored in the model cache. Normal file deletion does not guarantee forensic erasure.
- Transcription uses only local Whisper: no HTTP provider, API key or cloud fallback. Network access is used only to download or repair the selected model.
- Model files live in the user cache, outside the extension and the project.

### Troubleshooting and limits

- Run `/voice doctor`, or open `/voice` and use **Check model**.
- If the terminal intercepts `F8`, use `/voice start` and then `/voice stop`.
- Windows uses DirectShow. Linux uses PulseAudio/PipeWire-Pulse with ALSA fallback. macOS uses AVFoundation.
- WSL, SSH and containers need a microphone source the Pi host can reach.
- Behavior with a physical microphone depends on the host; automated checks do not prove it.

Implementation and recovery details: [architecture](docs/ARCHITECTURE.md), [extension UX](docs/EXTENSION_UX.md), [acceptance notes](docs/ACCEPTANCE.md).

### Contributing

Set up with `npm ci --ignore-scripts` (skips the model download), then run `npm run lint`, `npm test` and `npm run smoke:host`. The host smoke needs Pi `1.6` installed. Open pull requests against `develop`. See [CONTRIBUTING.md](CONTRIBUTING.md); report vulnerabilities as described in [SECURITY.md](SECURITY.md).

### License

MIT; see [LICENSE](LICENSE). Third-party code in `src/vendor/` keeps its own license and provenance, listed in [src/vendor/THIRD_PARTY_NOTICES.md](src/vendor/THIRD_PARTY_NOTICES.md).

## Português (Brasil)

### O que faz

O Pi Voice Control adiciona ditado local ao editor do Pi. O FFmpeg captura o áudio e um processo Whisper local separado faz a transcrição com o modelo `tiny`, `base` ou `small`. O texto é colado no editor atual.

> A extensão nunca envia o texto, não o executa como comando e não o reescreve com um LLM. Você revisa o texto no editor antes de fazer qualquer coisa com ele.

### Instalação

~~~powershell
pi install git:github.com/Borges360/pi-voice-control
~~~

A instalação usa Git, não a registry npm.

Requisitos:

- Node.js `>=22.19.0`.
- Um host Pi na faixa declarada pelas peer dependencies.
- FFmpeg no `PATH`.
- No Windows, o acesso de aplicativos da área de trabalho ao microfone precisa estar habilitado.

A configuração baixa o modelo selecionado do Hugging Face para `<agent-dir>/cache/voice-control`. O padrão é `tiny`, com cerca de 45 MB. `<agent-dir>` é `PI_CODING_AGENT_DIR` quando definido; caso contrário, `~/.pi/agent`. Os pesos do modelo não estão no Git nem no pacote.

O download exige rede durante a instalação ou o reparo. Depois que o modelo é preparado, a transcrição roda localmente e bloqueia chamadas de rede. Para adiar a preparação, defina `PI_VOICE_SKIP_LOCAL_SETUP=1` e depois use **Preparar modelo** no painel.

### Uso

| Comando ou tecla | Ação |
| --- | --- |
| `F8` | Inicia ou encerra o ditado (atalho padrão) |
| `/voice` ou `/voice settings` | Abre o painel; alterações ficam em rascunho até `Ctrl+S` |
| `/voice start` | Inicia a gravação |
| `/voice stop` | Encerra, transcreve e cola uma vez |
| `/voice cancel` | Cancela a operação ativa e mantém o editor como está |
| `/voice status` | Mostra estado, modelo, microfone, idioma e atalho |
| `/voice doctor` | Verifica FFmpeg, dispositivos e prontidão do modelo local |
| `/voice model [tiny\|base\|small]` | Lista os modelos ou troca o modelo nesta sessão; use o painel para preparar e salvar |

No painel:

- `↑`/`↓` navegam, `Enter` edita um campo ou executa uma ação e `Ctrl+S` salva com o painel aberto.
- Para trocar o modelo, escolha-o e pressione `Ctrl+S`; o modelo é preparado antes de a configuração ser salva.
- `Esc` sai de um campo sem aplicar. Com alterações não salvas, o primeiro `Esc` avisa e o segundo descarta as alterações e fecha o painel.
- `Esc` durante verificação, teste, download ou salvamento cancela a operação.
- A lista de microfones só é lida ao abrir o campo **Microfone**.
- Valores definidos pelo arquivo do projeto, por `PI_VOICE_*` ou por `--voice-*` mostram a origem e não são gravados no arquivo global.
- Abrir o painel ou navegar por ele nunca inicia uma gravação nem baixa um modelo.
- **Testar microfone** e **Testar ditado** pedem confirmação antes. **Iniciar ditado** pede que as alterações pendentes sejam salvas antes.

### Configuração e estado

| Arquivo | Escopo |
| --- | --- |
| `<agent-dir>/voice-control.json` | Global (`~/.pi/agent/voice-control.json` por padrão; `PI_CODING_AGENT_DIR` seleciona outro perfil Pi) |
| `.pi/voice-control.json` | Substituição por projeto, ignorada pelo Git |

Os dois arquivos aceitam JSON parcial e são validados pelo [schema de configuração](schemas/voice-control.schema.json):

~~~json
{
  "language": "pt",
  "transcription": { "model": "base" }
}
~~~

Precedência, da maior para a menor:

1. Flags do comando: `--voice-model`, `--voice-language` (na sessão do Pi).
2. Variáveis de ambiente: `PI_VOICE_MODEL`, `PI_VOICE_LANGUAGE`, `PI_VOICE_SHORTCUT`.
3. Configuração do projeto.
4. Configuração global.
5. Modelo selecionado na instalação.
6. Padrão `tiny`.

`/voice model` troca o modelo ativo somente na sessão atual. Outras variáveis de ambiente: `PI_CODING_AGENT_DIR` (diretório do perfil Pi), `PI_VOICE_FFMPEG` (executável do FFmpeg) e `PI_VOICE_SKIP_LOCAL_SETUP` (adia a preparação do modelo). O idioma do ditado é `pt` por padrão e aceita `auto` ou qualquer código de idioma reconhecido pelo Whisper.

Temas: ao carregar, a extensão copia os temas de cores do seu adaptador de terminal para `<agent-dir>/themes/`, e eles aparecem em `/settings` → **Theme**. Ela nunca troca o tema escolhido nem sobrescreve um arquivo de tema que você editou. Defina `PI_DESIGN_THEMES=off` para não copiar.

### Idioma

A configuração de idioma do ditado controla a transcrição, não a interface. Para mudar o idioma da interface, abra `/voice settings`, escolha **Idioma** e pré-visualize inglês ou português brasileiro. A escolha só é salva ao pressionar `Ctrl+S` em um projeto confiável, em `.pi/pi-voice-control.locale.json`. Projetos não confiáveis permanecem em inglês. `Esc` descarta uma prévia não salva.

### Privacidade e segurança

- A extensão roda com os privilégios do sistema operacional do usuário do Pi. Ela não é um sandbox do sistema.
- A captura de áudio começa somente após um atalho ou comando explícito.
- A gravação para em 120 segundos. O áudio temporário fica limitado a 3,84 MB e é removido depois do uso ou do cancelamento.
- Áudio e transcrições não são guardados no cache do modelo. A exclusão normal de arquivos não garante apagamento forense.
- A transcrição usa apenas Whisper local: sem provedor HTTP, chave de API ou fallback em nuvem. A rede é usada somente para baixar ou reparar o modelo selecionado.
- Os arquivos do modelo ficam no cache do usuário, fora da extensão e do projeto.

### Diagnóstico e limites

- Execute `/voice doctor`, ou abra `/voice` e use **Verificar modelo**.
- Se o terminal interceptar `F8`, use `/voice start` e depois `/voice stop`.
- Windows usa DirectShow. Linux usa PulseAudio/PipeWire-Pulse com fallback para ALSA. macOS usa AVFoundation.
- WSL, SSH e contêineres precisam de uma fonte de microfone acessível ao host do Pi.
- O comportamento com um microfone físico depende do host; as verificações automatizadas não o comprovam.

Detalhes de implementação e recuperação: [arquitetura](docs/ARCHITECTURE.md), [UX da extensão](docs/EXTENSION_UX.md), [notas de aceite](docs/ACCEPTANCE.md).

### Contribuição

Prepare o ambiente com `npm ci --ignore-scripts` (não baixa o modelo) e rode `npm run lint`, `npm test` e `npm run smoke:host`. O smoke do host exige um Pi `1.6` instalado. Abra pull requests para `develop`. Consulte [CONTRIBUTING.md](CONTRIBUTING.md); para relatar vulnerabilidades, siga [SECURITY.md](SECURITY.md).

### Licença

MIT; consulte [LICENSE](LICENSE). O código de terceiros em `src/vendor/` mantém sua própria licença e procedência, descritas em [src/vendor/THIRD_PARTY_NOTICES.md](src/vendor/THIRD_PARTY_NOTICES.md).
