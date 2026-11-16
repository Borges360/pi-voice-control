# Pi Voice Control

Local voice dictation for Pi Coding Agent. Press F8 to record and press it again to stop; the resulting text is pasted into the editor for review and is not submitted automatically.

**Package:** `@borges360/pi-voice-control` · **version:** `0.3.0`

**Status:** development release; registry availability and publication have not been verified.

**Compatibility:** Node.js `>=22.19.0`; the package declares Pi SDK peer dependencies `>=1.3.0 <1.4.0`. CT52 records one offline `/voice status` observation on Pi CLI `1.4.0`; that status-only observation does not expand the declared compatibility range.

## English

### What it does

Pi Voice Control adds local dictation to the Pi editor. FFmpeg captures audio, and a separate local Whisper process transcribes it with one of the `tiny`, `base`, or `small` models. The text is pasted into the current editor so you can review it. The extension does not submit the text, execute it as a command, or rewrite it with an LLM.

### Install

The repository documents this Pi Git installation command:

~~~powershell
pi install git:github.com/Borges360/pi-voice-control
~~~

This installs from Git, not from the npm registry. Setup downloads the selected local model (by default `tiny`, about 45 MB) from Hugging Face into `<agent-dir>/cache/voice-control`. `<agent-dir>` is `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. Model weights are not included in Git or the package. Model download requires network access during install or repair; after the model is prepared, transcription runs locally and blocks network fetches. Set `PI_VOICE_SKIP_LOCAL_SETUP=1` to defer model setup, then use **Prepare model** in the settings panel.

Requirements: Node.js `>=22.19.0`, a Pi host in the declared peer range, and FFmpeg available on `PATH`. On Windows, desktop-app microphone access must be enabled. A terminal may intercept F8; `/voice start` and `/voice stop` remain available.

### Use

| Command or key | Action |
| --- | --- |
| `F8` | Start or stop dictation (default shortcut) |
| `/voice` or `/voice settings` | Open the settings panel; edits are a draft until `Ctrl+S` |
| `/voice start` | Start recording |
| `/voice stop` | Stop, transcribe, and paste once |
| `/voice cancel` | Cancel the active operation and preserve the editor |
| `/voice status` | Show state, model, microphone, language, and shortcut |
| `/voice doctor` | Check FFmpeg, devices, and local model readiness |
| `/voice model [tiny\|base\|small]` | List or switch the model for this session; use the panel to prepare and save it |

In the panel, choose a model and press `Ctrl+S` to prepare it before saving. `Esc` returns or discards the current draft. Merely opening the panel or moving through its options does not start recording or download a model. Confirm before using **Test microphone** or **Test dictation**; those panel actions are separate from ordinary status and settings commands.

### Configuration and state

Global configuration is `<agent-dir>/voice-control.json` (`~/.pi/agent/voice-control.json` by default; `PI_CODING_AGENT_DIR` selects an alternate Pi profile). A project override can be placed at `.pi/voice-control.json` (ignored by Git). The files contain partial JSON and are checked against the [configuration schema](schemas/voice-control.schema.json):

~~~json
{
  "language": "pt",
  "transcription": { "model": "base" }
}
~~~

Precedence is command flags, environment variables, project configuration, global configuration, the installation-selected model, then the `tiny` default. `--voice-model` and `--voice-language` override settings for the Pi session; `/voice model` changes the active model for the current session. `PI_CODING_AGENT_DIR`, `PI_VOICE_MODEL`, `PI_VOICE_LANGUAGE`, `PI_VOICE_SHORTCUT`, `PI_VOICE_FFMPEG`, and `PI_VOICE_SKIP_LOCAL_SETUP` provide environment overrides. The speech language defaults to `pt` and accepts `auto` or language codes supported by Whisper.

### Language

This README is available in English and Brazilian Portuguese. The speech-language setting controls transcription, not the interface locale. Open `/voice settings` and choose **Language** to preview English or Brazilian Portuguese. The choice is saved only when you press `Ctrl+S` in a trusted project, at `.pi/pi-voice-control.locale.json`; untrusted projects remain in English. `Esc` discards an unsaved language preview.

### Privacy and security

The extension runs with the operating-system privileges of the Pi user; it is not an OS sandbox. Audio capture starts only after an explicit shortcut or command. Recording is limited to 120 seconds; temporary audio is capped at 3.84 MB and is removed after use or cancellation. The extension does not persist audio or transcripts in its model cache; normal file deletion is not a forensic-erasure guarantee. The pasted text remains in the editor for you to review.

Transcription uses only local Whisper and has no HTTP provider, API key, or cloud fallback. Network access is used only to download or repair the selected model. Model files are stored in the user cache, outside the extension and project.

### Troubleshooting and limits

Run `/voice doctor` for diagnostics, or open `/voice` and use **Verify model**. If F8 is intercepted by the terminal, use `/voice start` followed by `/voice stop`. Linux uses PulseAudio/PipeWire-Pulse with ALSA fallback; macOS uses AVFoundation. WSL, SSH, and containers require a microphone source accessible to the Pi host. Physical-device behavior depends on the host and is not established by the documentation package checks.

For implementation and recovery details, see [architecture](docs/ARCHITECTURE.md), [extension UX](docs/EXTENSION_UX.md), and [acceptance notes](docs/ACCEPTANCE.md).

### License

The extension is MIT licensed; see [LICENSE](LICENSE). The bundled INTEIRO mark has separate attribution and license terms in the [asset notice](docs/assets/INTEIRO-MARK-LICENSE.txt).

## Português (Brasil)

### O que faz

O Pi Voice Control adiciona ditado local ao editor do Pi. O FFmpeg captura o áudio e um processo separado executa a transcrição com um dos modelos Whisper locais `tiny`, `base` ou `small`. O texto é colado no editor atual para revisão. A extensão não envia o texto, não o executa como comando e não o reescreve com um LLM.

### Instalação

O repositório documenta este comando de instalação Git no Pi:

~~~powershell
pi install git:github.com/Borges360/pi-voice-control
~~~

Essa instalação usa Git, não a registry npm. A configuração baixa o modelo local selecionado (por padrão `tiny`, cerca de 45 MB) do Hugging Face para `<agent-dir>/cache/voice-control`. `<agent-dir>` é `PI_CODING_AGENT_DIR` quando definido, ou `~/.pi/agent` por padrão. Os pesos não estão no Git nem no pacote. O download exige rede durante a instalação ou reparo; depois de preparado, o modelo transcreve localmente e bloqueia chamadas de rede. Defina `PI_VOICE_SKIP_LOCAL_SETUP=1` para adiar a preparação e use **Preparar modelo** no painel.

Requisitos: Node.js `>=22.19.0`, um host Pi na faixa declarada pelas peer dependencies e FFmpeg em `PATH`. No Windows, habilite o acesso de aplicativos da área de trabalho ao microfone. Um terminal pode interceptar F8; `/voice start` e `/voice stop` continuam disponíveis.

### Uso

| Comando ou tecla | Ação |
| --- | --- |
| `F8` | Inicia ou encerra o ditado (atalho padrão) |
| `/voice` ou `/voice settings` | Abre o painel; alterações ficam em rascunho até `Ctrl+S` |
| `/voice start` | Inicia a gravação |
| `/voice stop` | Encerra, transcreve e cola uma vez |
| `/voice cancel` | Cancela a operação ativa e preserva o editor |
| `/voice status` | Mostra estado, modelo, microfone, idioma e atalho |
| `/voice doctor` | Verifica FFmpeg, dispositivos e prontidão do modelo local |
| `/voice model [tiny\|base\|small]` | Lista ou troca o modelo na sessão; use o painel para preparar e salvar |

No painel, escolha o modelo e pressione `Ctrl+S` para prepará-lo antes de salvar. `Esc` volta ou descarta o rascunho atual. Apenas abrir o painel ou navegar pelas opções não inicia uma gravação nem baixa um modelo. **Testar microfone** e **Testar ditado** pedem confirmação e são ações separadas dos comandos comuns de estado e configuração.

### Configuração e estado

A configuração global fica em `<agent-dir>/voice-control.json` (`~/.pi/agent/voice-control.json` por padrão; `PI_CODING_AGENT_DIR` seleciona outro perfil Pi). Uma substituição por projeto pode ficar em `.pi/voice-control.json` (ignorado pelo Git). Os arquivos aceitam JSON parcial e são validados pelo [schema de configuração](schemas/voice-control.schema.json):

~~~json
{
  "language": "pt",
  "transcription": { "model": "base" }
}
~~~

A precedência é: flags do comando, variáveis de ambiente, configuração do projeto, configuração global, modelo selecionado na instalação e, por fim, o default `tiny`. `--voice-model` e `--voice-language` substituem configurações na sessão do Pi; `/voice model` troca o modelo ativo somente na sessão atual. As variáveis disponíveis são `PI_CODING_AGENT_DIR`, `PI_VOICE_MODEL`, `PI_VOICE_LANGUAGE`, `PI_VOICE_SHORTCUT`, `PI_VOICE_FFMPEG` e `PI_VOICE_SKIP_LOCAL_SETUP`. O idioma do ditado é `pt` por padrão e aceita `auto` ou códigos de idioma reconhecidos pelo Whisper.

### Idioma

Este README está em inglês e português brasileiro. A configuração de idioma controla a transcrição, não o idioma da interface. Abra `/voice settings` e escolha **Idioma** para pré-visualizar inglês ou português brasileiro. A escolha só é salva ao pressionar `Ctrl+S` em um projeto confiável, em `.pi/pi-voice-control.locale.json`; projetos não confiáveis permanecem em inglês. `Esc` descarta uma prévia de idioma não salva.

### Privacidade e segurança

A extensão executa com os privilégios do sistema operacional do usuário do Pi; ela não é um sandbox do sistema. A captura começa somente após atalho ou comando explícito. A gravação tem limite de 120 segundos; o áudio temporário fica limitado a 3,84 MB e é removido depois do uso ou do cancelamento. A extensão não persiste áudio ou transcrições no cache do modelo; a exclusão normal de arquivos não garante apagamento forense. O texto colado permanece no editor para sua revisão.

A transcrição usa apenas Whisper local, sem provedor HTTP, chave de API ou fallback em nuvem. A rede é usada somente para baixar ou reparar o modelo selecionado. Os arquivos do modelo ficam no cache do usuário, fora da extensão e do projeto.

### Diagnóstico e limites

Execute `/voice doctor` para diagnóstico ou abra `/voice` e use **Verificar modelo**. Se o terminal interceptar F8, use `/voice start` e depois `/voice stop`. Linux usa PulseAudio/PipeWire-Pulse com fallback ALSA; macOS usa AVFoundation. WSL, SSH e contêineres exigem uma fonte de microfone acessível ao host do Pi. O comportamento do dispositivo físico depende do host e não é comprovado pelas verificações deste pacote documental.

Para detalhes de implementação e recuperação, consulte [arquitetura](docs/ARCHITECTURE.md), [UX da extensão](docs/EXTENSION_UX.md) e [notas de aceite](docs/ACCEPTANCE.md).

### Licença

A extensão usa licença MIT; consulte [LICENSE](LICENSE). A marca INTEIRO incluída tem atribuição e termos de licença separados no [aviso do asset](docs/assets/INTEIRO-MARK-LICENSE.txt).
