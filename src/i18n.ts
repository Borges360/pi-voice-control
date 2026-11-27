import { lstatSync, readFileSync } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Locale = 'en' | 'pt-BR';
type Message = Readonly<Record<Locale, string>>;

export const CATALOG = {
  'voice.shortcut.description': { en: 'Voice: start/stop dictation', 'pt-BR': 'Voz: iniciar/parar ditado' },
  'voice.command.description': { en: 'Open the voice menu (Ctrl+S saves); start, stop, cancel, status, settings, doctor, model', 'pt-BR': 'Abre o menu de voz (Ctrl+S salva); iniciar, parar, cancelar, status, configurações, diagnóstico, modelo' },
  'voice.requires.interactive': { en: 'Voice Control requires interactive Pi in a local terminal; RPC/print cannot capture audio.', 'pt-BR': 'O Voice Control precisa do Pi interativo em um terminal local; RPC/print não pode capturar áudio.' },
  'voice.migrated': { en: 'Voice Control now uses local Whisper only. Legacy settings were migrated; press Ctrl+S in /voice to save the new format.', 'pt-BR': 'O Voice Control agora usa somente o Whisper local. As configurações antigas foram migradas; pressione Ctrl+S em /voice para salvar o novo formato.' },
  'voice.cleanup.failed': { en: 'Could not clean up old temporary files.', 'pt-BR': 'Não foi possível remover arquivos temporários antigos.' },
  'voice.busy': { en: 'Voice Control is busy; run /voice cancel to stop the current operation.', 'pt-BR': 'O Voice Control está ocupado; use /voice cancel para interromper a operação atual.' },
  'voice.setup.busy': { en: 'Configuration or diagnostics are already running.', 'pt-BR': 'A configuração ou o diagnóstico já está em andamento.' },
  'voice.terminal.notFocused': { en: 'The terminal is not focused.', 'pt-BR': 'O terminal não está em foco.' },
  'voice.status': { en: 'Voice: {state} | microphone: {device} | local model: {model} | transcription language: {language} | shortcut: {shortcut}{pending}', 'pt-BR': 'Voz: {state} | microfone: {device} | modelo local: {model} | idioma da transcrição: {language} | atalho: {shortcut}{pending}' },
  'voice.reload.pending': { en: ' (/reload pending)', 'pt-BR': ' (/reload pendente)' },
  'voice.models.available': { en: 'Available local models: tiny, base, small; active: {model}. Open /voice to prepare and save a model.', 'pt-BR': 'Modelos locais disponíveis: tiny, base, small; ativo: {model}. Abra /voice para preparar e salvar um modelo.' },
  'voice.model.invalid': { en: 'Choose tiny, base, or small.', 'pt-BR': 'Escolha tiny, base ou small.' },
  'voice.model.selected': { en: 'Whisper {model} selected for this session. Open /voice to prepare the model if needed.', 'pt-BR': 'Whisper {model} selecionado para esta sessão. Abra /voice para preparar o modelo, se necessário.' },
  'voice.doctor.busy': { en: 'Stop or cancel the recording before running diagnostics.', 'pt-BR': 'Pare ou cancele a gravação antes de executar o diagnóstico.' },
  'voice.help': { en: 'Voice: {state}. {shortcut} starts/stops dictation; /voice start | stop | cancel | status | settings | doctor | model [tiny|base|small]. Transcribed text is pasted for review and never submitted automatically.', 'pt-BR': 'Voz: {state}. {shortcut} inicia/para o ditado; /voice start | stop | cancel | status | settings | doctor | model [tiny|base|small]. O texto transcrito é colado para revisão e nunca é enviado automaticamente.' },
  'controller.wait.cancel': { en: 'Wait for the current operation or run /voice cancel to discard it.', 'pt-BR': 'Aguarde a operação atual ou use /voice cancel para descartá-la.' },
  'controller.limit': { en: 'Limit of {seconds}s reached; finalizing.', 'pt-BR': 'Limite de {seconds}s atingido; finalizando.' },
  'controller.capture.done': { en: 'Capture finished; transcribing.', 'pt-BR': 'Captura encerrada; transcrevendo.' },
  'controller.target.changed': { en: 'The editor target changed; transcription was discarded.', 'pt-BR': 'O destino do editor mudou; a transcrição foi descartada.' },
  'controller.no.speech': { en: 'No speech detected.', 'pt-BR': 'Nenhuma fala detectada.' },
  'controller.cleanup.failed': { en: 'Could not delete temporary audio; run /voice doctor.', 'pt-BR': 'Não foi possível excluir o áudio temporário; use /voice doctor.' },
  'controller.too.short': { en: 'Recording is too short; speak for at least {milliseconds} ms.', 'pt-BR': 'A gravação é muito curta; fale por pelo menos {milliseconds} ms.' },
  'indicator.starting': { en: '◌ MIC...', 'pt-BR': '◌ MIC...' },
  'indicator.recording': { en: '● REC', 'pt-BR': '● GRAVANDO' },
  'indicator.finalizing': { en: '◌ FINALIZING...', 'pt-BR': '◌ FINALIZANDO...' },
  'indicator.transcribing': { en: '◌ TRANSCRIBING...', 'pt-BR': '◌ TRANSCRIBINDO...' },
  'settings.title': { en: 'Voice / Settings', 'pt-BR': 'Voz / Configurações' },
  'settings.summary': { en: '{state} · local Whisper · {model} · {path}', 'pt-BR': '{state} · Whisper local · {model} · {path}' },
  'settings.language.label': { en: 'Language', 'pt-BR': 'Idioma' },
  'settings.language.description': { en: 'Select the language for this trusted project. The choice previews immediately and is saved only with Ctrl+S.', 'pt-BR': 'Escolha o idioma deste projeto confiável. A prévia muda na hora e só é salva com Ctrl+S.' },
  'settings.language.untrusted': { en: 'Project trust is required to change the interface language.', 'pt-BR': 'É necessário confiar no projeto para mudar o idioma da interface.' },
  'settings.language.english': { en: 'English', 'pt-BR': 'Inglês' },
  'settings.language.portuguese': { en: 'Português (Brasil)', 'pt-BR': 'Português (Brasil)' },
  'settings.model.label': { en: 'Model', 'pt-BR': 'Modelo' },
  'settings.model.description': { en: 'Local and offline. Tiny is lighter; base and small prioritize accuracy. Ctrl+S downloads the model if needed and saves. Esc cancels.', 'pt-BR': 'Local e offline. Tiny é mais leve; base e small priorizam a precisão. Ctrl+S baixa o modelo, se necessário, e salva. Esc cancela.' },
  'settings.model.tiny': { en: 'tiny — ~{size} MB · lighter', 'pt-BR': 'tiny — ~{size} MB · mais leve' },
  'settings.model.base': { en: 'base — ~{size} MB · balanced', 'pt-BR': 'base — ~{size} MB · equilibrado' },
  'settings.model.small': { en: 'small — ~{size} MB · highest accuracy', 'pt-BR': 'small — ~{size} MB · maior precisão' },
  'settings.microphone.label': { en: 'Microphone', 'pt-BR': 'Microfone' },
  'settings.microphone.description': { en: 'Press Enter to list microphones. FFmpeg errors do not prevent model selection.', 'pt-BR': 'Pressione Enter para listar os microfones. Erros do FFmpeg não impedem a seleção do modelo.' },
  'settings.microphone.finding': { en: 'Finding microphones…', 'pt-BR': 'Procurando microfones…' },
  'settings.microphone.none': { en: 'No microphone found. Check permissions or run /voice doctor.', 'pt-BR': 'Nenhum microfone encontrado. Verifique as permissões ou use /voice doctor.' },
  'settings.language.transcription.label': { en: 'Transcription language', 'pt-BR': 'Idioma da transcrição' },
  'settings.language.transcription.description': { en: 'pt = Portuguese; auto = detect; ISO codes such as en or es are also accepted.', 'pt-BR': 'pt = português; auto = detectar; códigos ISO como en ou es também são aceitos.' },
  'settings.shortcut.label': { en: 'Shortcut', 'pt-BR': 'Atalho' },
  'settings.shortcut.description': { en: 'Choose F1–F12. Restart Pi with /reload to apply the shortcut change.', 'pt-BR': 'Escolha F1–F12. Reinicie o Pi com /reload para aplicar a mudança do atalho.' },
  'settings.model.check.label': { en: 'Check model', 'pt-BR': 'Verificar modelo' },
  'settings.model.check.description': { en: 'Loads the selected model in a separate process with network access blocked. Does not record audio.', 'pt-BR': 'Carrega o modelo selecionado em um processo separado, sem acesso à rede. Não grava áudio.' },
  'settings.model.check.progress': { en: 'Checking local Whisper…', 'pt-BR': 'Verificando o Whisper local…' },
  'settings.model.ready': { en: 'Whisper {model} is ready for offline dictation.', 'pt-BR': 'Whisper {model} está pronto para ditado offline.' },
  'settings.model.prepare.label': { en: 'Prepare model', 'pt-BR': 'Preparar modelo' },
  'settings.model.prepare.value': { en: 'Download / repair', 'pt-BR': 'Baixar / reparar' },
  'settings.model.prepare.description': { en: 'Downloads only the selected model from Hugging Face to the user cache. Model weights stay outside the repository. Esc cancels.', 'pt-BR': 'Baixa somente o modelo selecionado do Hugging Face para o cache do usuário. Os pesos ficam fora do repositório. Esc cancela.' },
  'settings.model.preparing': { en: 'Preparing Whisper {model}…', 'pt-BR': 'Preparando o Whisper {model}…' },
  'settings.model.savedSelection': { en: 'Model is ready. Press Ctrl+S to save your selection.', 'pt-BR': 'O modelo está pronto. Pressione Ctrl+S para salvar sua seleção.' },
  'settings.mic.test.label': { en: 'Test microphone', 'pt-BR': 'Testar microfone' },
  'settings.mic.test.value': { en: '2 seconds', 'pt-BR': '2 segundos' },
  'settings.mic.test.description': { en: 'Records for 2 seconds, shows a waveform, and deletes the audio. No transcription.', 'pt-BR': 'Grava por 2 segundos, mostra a forma de onda e exclui o áudio. Sem transcrição.' },
  'settings.mic.test.confirm': { en: 'Record from the microphone for 2 seconds? Speak after confirming. The audio will be deleted.', 'pt-BR': 'Gravar pelo microfone por 2 segundos? Fale depois de confirmar. O áudio será excluído.' },
  'settings.stt.test.label': { en: 'Test dictation', 'pt-BR': 'Testar ditado' },
  'settings.stt.test.value': { en: 'Microphone + STT', 'pt-BR': 'Microfone + STT' },
  'settings.stt.test.description': { en: 'Records and transcribes for 2 seconds. Discards the text and audio; leaves the editor unchanged.', 'pt-BR': 'Grava e transcreve por 2 segundos. Descarta o texto e o áudio; mantém o editor inalterado.' },
  'settings.stt.test.confirm': { en: 'Record and transcribe 2 seconds with Whisper {model}? Speak after confirming. The text will be discarded.', 'pt-BR': 'Gravar e transcrever 2 segundos com o Whisper {model}? Fale depois de confirmar. O texto será descartado.' },
  'settings.diagnostics.label': { en: 'Diagnostics', 'pt-BR': 'Diagnóstico' },
  'settings.diagnostics.value': { en: 'Check environment', 'pt-BR': 'Verificar ambiente' },
  'settings.diagnostics.description': { en: 'Checks FFmpeg, devices, and STT. No audio is sent.', 'pt-BR': 'Verifica o FFmpeg, os dispositivos e o STT. Nenhum áudio é enviado.' },
  'settings.diagnostics.shown': { en: 'Diagnostics shown in notifications.', 'pt-BR': 'Diagnóstico exibido nas notificações.' },
  'settings.capture.stop': { en: 'Stop and transcribe', 'pt-BR': 'Parar e transcrever' },
  'settings.capture.start': { en: 'Start dictation', 'pt-BR': 'Iniciar ditado' },
  'settings.capture.description': { en: 'Closes the panel and uses saved settings. Press Ctrl+S to save changes before starting dictation.', 'pt-BR': 'Fecha o painel e usa as configurações salvas. Pressione Ctrl+S para salvar as alterações antes de iniciar o ditado.' },
  'settings.capture.unsaved': { en: 'Press Ctrl+S to save changes before starting dictation.', 'pt-BR': 'Pressione Ctrl+S para salvar as alterações antes de iniciar o ditado.' },
  'settings.cancel.label': { en: 'Cancel dictation', 'pt-BR': 'Cancelar ditado' },
  'settings.cancel.value': { en: 'Discard', 'pt-BR': 'Descartar' },
  'settings.cancel.description': { en: 'Cancels the current recording/transcription and closes the panel.', 'pt-BR': 'Cancela a gravação/transcrição atual e fecha o painel.' },
  'settings.error.busy': { en: 'Stop or cancel dictation before changing settings or running a test.', 'pt-BR': 'Pare ou cancele o ditado antes de mudar as configurações ou executar um teste.' },
  'settings.global.invalid': { en: 'The global settings file has invalid values ({keys}); Ctrl+S replaces them with defaults.', 'pt-BR': 'O arquivo de configuração global tem valores inválidos ({keys}); Ctrl+S os substitui pelos padrões.' },
  'settings.saved.overrides': { en: 'Saved. Project/env/CLI overrides keep precedence.', 'pt-BR': 'Salvo. As substituições do projeto/env/CLI continuam tendo precedência.' },
  'settings.language.transcription.invalid': { en: 'Use auto or a language code such as pt, en or es.', 'pt-BR': 'Use auto ou um código de idioma, como pt, en ou es.' },
  'settings.busy.reason': { en: 'stop or cancel dictation first', 'pt-BR': 'pare ou cancele o ditado antes' },
  'settings.language.trust.source': { en: 'project trust', 'pt-BR': 'confiança no projeto' },
  'settings.model.downloading': { en: 'Downloading Whisper {model} (~{size} MB)…', 'pt-BR': 'Baixando o Whisper {model} (~{size} MB)…' },
  'settings.model.downloadProgress': { en: 'Downloading and preparing local Whisper…', 'pt-BR': 'Baixando e preparando o Whisper local…' },
  'locale.trust.required': { en: 'Project trust is required to save the language.', 'pt-BR': 'É necessário confiar no projeto para salvar o idioma.' },
  'locale.save.failed': { en: 'Could not save language preference.', 'pt-BR': 'Não foi possível salvar a preferência de idioma.' },
  'locale.invalid': { en: 'Unsupported interface language.', 'pt-BR': 'Idioma de interface não compatível.' },
  'doctor.title': { en: 'Pi Voice Control | {platform} {arch} | Node {node}', 'pt-BR': 'Pi Voice Control | {platform} {arch} | Node {node}' },
  'doctor.shortcut': { en: 'Registered shortcut: {registered}; configured shortcut: {configured}{reload}', 'pt-BR': 'Atalho registrado: {registered}; atalho configurado: {configured}{reload}' },
  'doctor.reload': { en: ' (run /reload)', 'pt-BR': ' (use /reload)' },
  'doctor.warning': { en: 'WARNING: {message}', 'pt-BR': 'AVISO: {message}' },
  'doctor.ffmpeg.ok': { en: 'OK: FFmpeg is executable.', 'pt-BR': 'OK: o FFmpeg pode ser executado.' },
  'doctor.ffmpeg.fail': { en: 'FAIL: FFmpeg returned an error.', 'pt-BR': 'FALHA: o FFmpeg retornou um erro.' },
  'doctor.microphones': { en: 'Microphones found: {count}; selection {selection}.', 'pt-BR': 'Microfones encontrados: {count}; seleção {selection}.' },
  'doctor.available': { en: 'available', 'pt-BR': 'disponível' },
  'doctor.notFound': { en: 'not found', 'pt-BR': 'não encontrada' },
  'doctor.permission': { en: 'Check real permissions, device contention, and levels with the short test in /voice settings.', 'pt-BR': 'Verifique as permissões reais, conflitos de dispositivo e níveis com o teste rápido em /voice settings.' },
  'doctor.whisper': { en: 'Whisper {model}; separate process, offline; transcription language: {language}; PCM 16 kHz mono int16.', 'pt-BR': 'Whisper {model}; processo separado, offline; idioma da transcrição: {language}; PCM 16 kHz mono int16.' },
  'doctor.model.ok': { en: 'OK: local model installed and loaded outside Pi with network access blocked.', 'pt-BR': 'OK: modelo local instalado e carregado fora do Pi, sem acesso à rede.' },
  'doctor.test': { en: 'Use Test dictation in /voice to validate transcription with explicit capture.', 'pt-BR': 'Use Testar ditado em /voice para validar a transcrição com captura explícita.' },
  'doctor.keyConflicts': { en: 'Key conflicts: Pi reports conflicts at startup; check Windows Terminal key bindings manually.', 'pt-BR': 'Conflitos de tecla: o Pi informa conflitos na inicialização; verifique manualmente os atalhos do Windows Terminal.' },
  'doctor.focus': { en: 'Focus handling uses terminal events, exact Kitty key-up events, and a timing guard for legacy VT. This diagnostic sent no audio.', 'pt-BR': 'O foco usa eventos do terminal, eventos exatos de soltura de tecla Kitty e uma proteção temporal para VT legado. Este diagnóstico não enviou áudio.' },
  'host.ssh': { en: 'Pi is running over SSH: the microphone belongs to the remote host. Run Pi on the Windows machine with the microphone.', 'pt-BR': 'O Pi está sendo executado por SSH: o microfone pertence ao host remoto. Execute o Pi no computador Windows ligado ao microfone.' },
  'host.wsl': { en: 'Pi is running in WSL: make an accessible PulseAudio source available or run Pi natively on Windows.', 'pt-BR': 'O Pi está sendo executado no WSL: disponibilize uma fonte PulseAudio acessível ou execute o Pi nativamente no Windows.' },
  'host.container': { en: 'The container needs an explicit audio device/source; no audio bridge is installed.', 'pt-BR': 'O contêiner precisa de um dispositivo/fonte de áudio explícito; não há uma ponte de áudio instalada.' },
  'capture.noDevice': { en: 'No microphone is available; use /voice settings.', 'pt-BR': 'Nenhum microfone está disponível; use /voice settings.' },
  'capture.ffmpeg.start': { en: 'Could not start FFmpeg.', 'pt-BR': 'Não foi possível iniciar o FFmpeg.' },
  'capture.ffmpeg.missing': { en: 'FFmpeg was not found or is not executable.', 'pt-BR': 'O FFmpeg não foi encontrado ou não pode ser executado.' },
  'capture.ffmpeg.config': { en: 'FFmpeg was not found or is not executable; set PI_VOICE_FFMPEG.', 'pt-BR': 'O FFmpeg não foi encontrado ou não pode ser executado; defina PI_VOICE_FFMPEG.' },
  'capture.unavailable': { en: 'Microphone unavailable, busy, or disconnected; run /voice doctor.', 'pt-BR': 'Microfone indisponível, ocupado ou desconectado; use /voice doctor.' },
  'capture.io': { en: 'Could not capture or write temporary audio.', 'pt-BR': 'Não foi possível capturar ou gravar o áudio temporário.' },
  'capture.cancelled': { en: 'Recording canceled.', 'pt-BR': 'Gravação cancelada.' },
  'capture.noFrames': { en: 'The microphone produced no audio.', 'pt-BR': 'O microfone não produziu áudio.' },
  'capture.timeout': { en: 'The microphone did not respond within 8 seconds.', 'pt-BR': 'O microfone não respondeu em até 8 segundos.' },
  'capture.closed': { en: 'Capture has already finished.', 'pt-BR': 'A captura já foi finalizada.' },
  'device.cancelled': { en: 'Diagnostics canceled.', 'pt-BR': 'Diagnóstico cancelado.' },
  'device.timeout': { en: 'Device enumeration timed out.', 'pt-BR': 'A enumeração dos dispositivos excedeu o tempo limite.' },
  'model.choose': { en: 'Choose tiny, base, or small in /voice.', 'pt-BR': 'Escolha tiny, base ou small em /voice.' },
  'model.cancelled': { en: 'Local operation canceled.', 'pt-BR': 'Operação local cancelada.' },
  'model.timeout': { en: 'Local Whisper timed out; try a shorter recording.', 'pt-BR': 'O Whisper local excedeu o tempo limite; tente uma gravação mais curta.' },
  'model.inference': { en: 'Whisper could not transcribe the recording. Try a shorter recording or repair the engine in /voice.', 'pt-BR': 'O Whisper não conseguiu transcrever a gravação. Tente uma gravação mais curta ou repare o mecanismo em /voice.' },
  'model.audio': { en: 'Invalid local audio; run Test microphone in /voice.', 'pt-BR': 'Áudio local inválido; use Testar microfone em /voice.' },
  'model.install': { en: 'Could not prepare the local model. Check Hugging Face access and use Prepare model in /voice.', 'pt-BR': 'Não foi possível preparar o modelo local. Verifique o acesso ao Hugging Face e use Preparar modelo em /voice.' },
  'model.notReady': { en: 'Local model is unavailable. Open /voice → Prepare model to install or repair it.', 'pt-BR': 'O modelo local está indisponível. Abra /voice → Preparar modelo para instalar ou reparar.' },
  'model.mismatch': { en: 'The requested model does not match the selected local engine.', 'pt-BR': 'O modelo solicitado não corresponde ao mecanismo local selecionado.' },
  'settings.test.cancelled': { en: 'Test canceled.', 'pt-BR': 'Teste cancelado.' },
  'settings.test.silent': { en: 'No useful audio was detected; check the microphone and permissions.', 'pt-BR': 'Nenhum áudio útil foi detectado; verifique o microfone e as permissões.' },
  'settings.test.dictation.ok': { en: 'Dictation OK. Text discarded; editor unchanged.', 'pt-BR': 'Ditado OK. Texto descartado; editor inalterado.' },
  'settings.test.dictation.empty': { en: 'Dictation returned no text.', 'pt-BR': 'O ditado não retornou texto.' },
  'settings.test.mic.ok': { en: 'Microphone OK: real signal detected, 16 kHz mono WAV. Audio deleted.', 'pt-BR': 'Microfone OK: sinal real detectado, WAV mono de 16 kHz. Áudio excluído.' },
  'config.invalid': { en: 'Invalid configuration: {key}.', 'pt-BR': 'Configuração inválida: {key}.' },
  'config.file': { en: 'Could not read voice-control.json; check the JSON (128 KiB limit).', 'pt-BR': 'Não foi possível ler voice-control.json; verifique o JSON (limite de 128 KiB).' },
  'transcript.invalid': { en: 'STT response is invalid or too long.', 'pt-BR': 'A resposta de STT é inválida ou longa demais.' },
  'error.internal': { en: 'Voice operation failed; run /voice doctor.', 'pt-BR': 'A operação de voz falhou; use /voice doctor.' },
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof CATALOG;

const byEnglish = new Map<string, MessageKey>();
for (const key of Object.keys(CATALOG) as MessageKey[]) byEnglish.set(CATALOG[key].en, key);

function interpolate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));
}

export function translate(key: MessageKey, locale: Locale, values: Record<string, string | number> = {}): string {
  return interpolate(CATALOG[key][locale], values);
}

const templates = (Object.keys(CATALOG) as MessageKey[])
  .filter(key => CATALOG[key].en.includes('{'))
  .map(key => {
    const source = CATALOG[key].en;
    const names: string[] = [];
    const pattern = source.split(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g).map((part, index) => {
      if (index % 2 === 1) { names.push(part); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { key, names, pattern: new RegExp(`^${pattern}$`) };
  });

export function translateText(text: string, locale: Locale): string {
  if (locale === 'en' || !text) return text;
  if (text.includes('\n')) return text.split('\n').map(line => translateText(line, locale)).join('\n');
  const codeError = text.match(/^(.*) \[([A-Z][A-Z0-9_]*)\]$/s);
  if (codeError) return `${translateText(codeError[1]!, locale)} [${codeError[2]}]`;
  const exact = byEnglish.get(text);
  if (exact) return translate(exact, locale);
  for (const item of templates) {
    const match = item.pattern.exec(text);
    if (!match) continue;
    const values: Record<string, string> = {};
    item.names.forEach((name, index) => { values[name] = match[index + 1] ?? ''; });
    return interpolate(CATALOG[item.key][locale], values);
  }
  return text;
}

export const LOCALE_FILE = 'pi-voice-control.locale.json';
export const LOCALE_RELATIVE_PATH = `.pi/${LOCALE_FILE}`;

function localeFilePath(cwd: string): string {
  const root = resolve(cwd);
  const directory = resolve(root, '.pi');
  const file = resolve(directory, LOCALE_FILE);
  if (!directory.startsWith(root + sep) || !file.startsWith(directory + sep)) throw new Error('Invalid locale path.');
  return file;
}

export function loadProjectLocale(cwd: string, trusted: boolean): Locale {
  if (!trusted) return 'en';
  const path = localeFilePath(cwd);
  const directory = resolve(cwd, '.pi');
  try {
    // Refuse to follow a project-local symlink outside the trusted project.
    const directoryInfo = requireLstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return 'en';
    const fileInfo = requireLstat(path);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return 'en';
    const data = JSON.parse(requireReadFile(path));
    return data?.schemaVersion === 1 && (data.locale === 'en' || data.locale === 'pt-BR') ? data.locale : 'en';
  } catch {
    return 'en';
  }
}

function requireLstat(path: string) {
  // Kept behind the trusted-project gate above; only the exact locale directory/file is inspected.
  return lstatSync(path);
}

function requireReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export class LocaleSaveError extends Error {
  constructor() { super(CATALOG['locale.save.failed'].en); this.name = 'LocaleSaveError'; }
}

export async function saveProjectLocale(cwd: string, trusted: boolean, locale: Locale): Promise<void> {
  if (!trusted) throw new Error(CATALOG['locale.trust.required'].en);
  if (locale !== 'en' && locale !== 'pt-BR') throw new Error(CATALOG['locale.invalid'].en);
  const path = localeFilePath(cwd);
  const directory = resolve(cwd, '.pi');
  const temporary = join(directory, `.${LOCALE_FILE}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    try {
      const existingDirectory = await lstat(directory);
      if (!existingDirectory.isDirectory() || existingDirectory.isSymbolicLink()) throw new Error('Unsafe locale directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(directory);
    }
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Unsafe locale directory');
    try {
      const fileInfo = await lstat(path);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error('Unsafe locale file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, locale }, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, path);
  } catch {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new LocaleSaveError();
  }
}
