# pi-voice-control — Especificação de Produto e Engenharia

**Versão:** 1.0 · **Status:** pronta para implementação · **Prioridade:** P0 para todos os requisitos do MVP
**Produto-alvo:** Pi Coding Agent (terminal/TUI) · **Tecnologia:** TypeScript, extensão nativa do Pi

> Este documento descreve o produto a construir. As APIs e comportamentos devem ser verificados contra a versão efetivamente instalada de `@mariozechner/pi-coding-agent` antes de codificar. Referências de terceiros servem como padrões de estudo, não como autorização para copiar código sem verificar licenças.

## 1. Objetivo e contrato do produto

Construir uma extensão que converta ditado de voz em texto no editor atual do Pi Coding Agent, sem introduzir um agente conversacional, sem substituir o modelo de programação e sem executar automaticamente o conteúdo transcrito.

**Fluxo obrigatório:** pressionar `F8` → capturar áudio → mostrar indicador compacto e animado no canto inferior direito da área de entrada → pressionar `F8` novamente → encerrar captura → transcrever com provedor local ou remoto → inserir texto no editor sem submetê-lo.

**Princípios invariantes:** privacy-first; integração nativa; configuração simples; transcrição não é comando; nenhuma mudança automática do modelo de LLM; recursos liberados ao encerrar; outro código de extensão não pode perder estado ou IU por causa deste.

## 2. Discovery e decisões reutilizadas

| Fonte | Prática aproveitada | Decisão |
|---|---|---|
| [`cgarrot/pi-voice-stt`](https://github.com/cgarrot/pi-voice-stt) | Toggle, gravação via FFmpeg, providers intercambiáveis, `doctor`, indicador na borda do prompt, cancelamento e inserção no editor | **Base arquitetural principal**, sem copiar a implementação cegamente |
| [`earendil-works/pi-voice`](https://github.com/earendil-works/pi-voice) | Setup interativo de idioma, microfone, modelo e atalho; transcrição local | Usar fluxo de onboarding e descoberta de dispositivos |
| [`mngad/pi-voice`](https://github.com/mngad/pi-voice) | Atalho `F5`, captura local multiplataforma, confirmação | Confirmar precedente de teclas de função e revisão antes de envio |
| [`iurysza/pi-voice`](https://github.com/iurysza/pi-voice) | Isolamento entre interface e processamento de áudio, testes com fake media | Aproveitar desacoplamento/testes, **não** implementar Realtime, TTS ou conversa |
| [Documentação de extensões do Pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) | `pi.registerShortcut`, `pi.registerCommand`, `ctx.ui.pasteToEditor`, `setWidget`, `setStatus`, `setEditorComponent` | APIs oficiais; testar assinatura exata na versão instalada |
| [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) | Eventos avançados e teclas modificadoras | Shift isolado **não** integra o fluxo obrigatório |
| [Speaches STT](https://speaches.ai/usage/speech-to-text/) | API local `/v1/audio/transcriptions` compatível com OpenAI | Provedor local recomendado sem acoplar o Pi ao motor de inferência |

Nenhuma implementação é adotada integralmente. Comparar licença, compatibilidade, qualidade do código e testes antes de reutilizar qualquer trecho.

## 3. Limites de escopo

### P0 — obrigatório na primeira release

1. Atalho `F8` configurável, **toggle** com debounce e detecção de colisões.
2. Comandos `/voice`, `/voice start`, `/voice stop`, `/voice cancel`, `/voice status`, `/voice settings`, `/voice doctor`.
3. Gravação local do microfone do host em PCM mono, 16 kHz, 16 bits, com conversão para WAV.
4. Indicador **discreto e não modal** na parte inferior direita do editor: estado, waveform dinâmica e duração.
5. Níveis reais de áudio (RMS), não animação fictícia aleatória; alternativa estática quando captura de nível não estiver disponível.
6. Transcrição local através de API OpenAI-compatible; transcrição remota através do mesmo contrato; configurações de perfis.
7. Inserção no editor sem disparar envio automático, preservando integralmente o texto existente.
8. Setup interativo, seleção e validação de microfone, idioma `pt`, provedor e modelo.
9. Tratamento determinístico de estados, cancelamentos, timesouts, falhas de áudio/rede e limpeza de arquivos/processos temporários.
10. Segurança básica (segredos por env vars, URL segura, limites, telemetria desativada) e testes automatizados.
11. Compatibilidade prioritária Windows nativo + teste manual Windows Terminal/PowerShell; arquitetura compatível com Linux/macOS mediante FFmpeg.

### Fora do MVP

- Conversa contínua, respostas faladas, TTS, WebRTC, wake word, transcrição parcial em streaming, VAD/auto-stop, múltiplos speakers.
- Modelo de linguagem para reescrever prompt; chamar modelo conversacional para melhorar texto.
- MCP, hooks globais de teclado, escuta quando a janela não está em foco.
- Gravação iniciada pelo agente, ferramenta de transcrição de arquivos, upload automático, fallback automático da voz local para a nuvem.
- Suporte garantido a Shift sozinho ou Shift mantido como push-to-talk.

## 4. Experiência de uso e comandos

### Fluxo padrão

1. Em `IDLE`, `F8` inicia a gravação, após validar dispositivo e capturador; áudio só é coletado após a ação explícita.
2. Enquanto captura, editor, mensagens e ferramentas funcionam normalmente. Um indicador pequeno fica visível perto do canto inferior direito do editor, com barras verdes responsivas ao RMS e tempo `mm:ss`.
3. Segundo `F8` interrompe captura e inicia transcrição. Indicador muda de `GRAVANDO` para `TRANSCREVENDO`; nenhum modelo conversacional é invocado.
4. Ao terminar, `ctx.ui.pasteToEditor()` acrescenta transcrição conforme o contrato de preservação. O usuário pode revisar e pressionar Enter normalmente.
5. `Esc` cancela uma gravação em curso **somente quando** a extensão consegue interceptar a tecla com segurança e sem impedir a semântica de abortar do Pi; `/voice cancel` é a alternativa garantida.
6. Durante transcrição, `F8` não inicia nova gravação; emitir aviso curto sem enfileirar novos pedidos. `/voice cancel` deve abortar request e preservar o editor.

### Comandos

| Comando | Resultado |
|---|---|
| `/voice` | Exibe ajuda contextual e estado atual; não inicia captura inadvertidamente |
| `/voice start` | Começa gravação, mesmo sem atalho disponível |
| `/voice stop` | Para, transcreve e insere sem enviar |
| `/voice cancel` | Interrompe gravação/transcrição e descarta conteúdo da operação |
| `/voice status` | Mostra estado, dispositivo, provider, modelo, idioma e atalhos; nunca mostra segredos |
| `/voice settings` | Assistente interativo para entrada de áudio, idioma, provedor, modelo, teste e atalho |
| `/voice doctor` | Verifica SO, FFmpeg, dispositivo, atalho, permissões, serviço STT e formato de resposta |
| `/voice profile [nome]` | Lista/troca perfil, efetivo na próxima gravação |

### Atalho

- **Default `f8`**, tecla declarada na referência oficial de keybindings do Pi (`f1`–`f12`).
- `pi.registerShortcut('f8', { description, handler })` na inicialização. Verificar previamente colisão com atalho do terminal/harness; orientar configuração se houver.
- Toggle **press-release**: `F8` inicia; outro `F8` encerra. Autorrepetição deve ser ignorada; debounce de aproximadamente 250 ms configurável.
- Tecla sem foco no terminal **não** inicia gravação.
- `Shift` isolado: não configurar como binding comum. Somente considerar modo experimental posterior se um helper específico do SO puder capturar keydown/keyup e encaminhar evento com foco comprovado da janela. Jamais hook global sem consentimento.

## 5. Indicador visual — especificação detalhada

### Referência e posição

Reproduzir em caracteres TUI a linguagem do SVG fornecido pelo solicitante: **14 a 20 barras verticais verde-esmeralda com alturas variáveis**, compactas e suaves, sem gráficos externos e sem ocupar o editor.

**Posição-alvo:** extremidade direita da borda/área inferior do prompt. A extensão `cgarrot/pi-voice-stt` demonstra um indicador na borda direita do prompt por wrapper de editor, mas tal técnica pode conflitar com outras extensões que substituem o editor.

**Estratégia de renderização, por prioridade:**

1. **Preferencial se for composável e houver API/renderer confiável na versão instalada:** indicador na borda direita do editor (estudar `src/ui` de `cgarrot/pi-voice-stt` e validar com as extensões instaladas).
2. **Fallback seguro padrão:** `ctx.ui.setWidget('pi-voice-control', renderer, { placement: 'belowEditor' })`, uma linha alinhada à direita via cálculo de largura visível; limpar com `setWidget(..., undefined)`.
3. **Fallback de terminal incompatível ou estreito:** `ctx.ui.setStatus('pi-voice-control', '● REC 00:12')`, mantendo rodapé original.

**Não fazer:** ANSI com posicionamento de cursor arbitrário, `console.log` por frame, `ctx.ui.setFooter()` para substituir todo o rodapé, modal com `ctx.ui.custom()` preso durante a gravação, ou substituição agressiva de custom editor já presente.

### Layout normativo

```text
┌─ Pi editor ─────────────────────────────────────────────────────────────┐
│ Analise o serviço de autenticação e identifique pontos críticos...    │
└────────────────────────────────────── ● REC 00:12 ▂▅▃▇▄▆▂▅▄▇▃ ─────────┘
```

Representação textual (a composição exata depende do tema/terminal). Não adicionar uma janela flutuante que oculte resultados do Pi.

### Estados visuais

| Estado | Exibição | Comportamento |
|---|---|---|
| `IDLE` | Invisível | Zero timers de animação |
| `STARTING` | `◌ MICROFONE...` | Curta indicação enquanto valida |
| `RECORDING` | `● REC 00:12 ▂▅▃▇▄▆...` | Barras seguem nível real + duração |
| `FINALIZING` | `◌ FINALIZANDO...` | Deixa de animar RMS |
| `TRANSCRIBING` | `◌ TRANSCREVENDO...` | Spinner discreto, não waveform artificial |
| `SUCCESS` | `✓ TRANSCRITO` | Exibe por curto tempo e desaparece |
| `ERROR` | `! ERRO — /voice doctor` | Notificação sem revelar dados pessoais |
| `CANCELLED` | Invisível | Limpa imediatamente |

### Algoritmo e parâmetros

- Capturar PCM bruto em blocos de ~20 a 100 ms; gerar níveis a cada 80–125 ms; limite **10 frames/s**.
- Calcular `RMS = sqrt(sum(sample²)/N)` sobre amostras normalizadas para [-1, 1]. Converter em amplitude de barra por curva logarítmica com piso de ruído calibrável.
- Suavizar ataque (~0,35) e decaimento (~0,18); exibir janela deslizante com 14 barras, altura quantizada 0–8 (`▁▂▃▄▅▆▇█`).
- Cores do tema: preferir `success`/verde ou alternativa de alto contraste; modo monocromático automático se não suportar cor.
- Tempo baseado em clock monotônico desde confirmação de início; não no número de atualizações de frame.
- Truncar de forma adaptativa: largura ≥80 colunas (ondas + contador), 40–79 (`● REC 00:12`), <40 (`● REC`). O comprimento visível não pode exceder a área disponível.
- Os buffers de visualização têm limite fixo. A cada redesenho, invalidar **somente o componente**; não repintar histórico do chat desnecessariamente.
- Pausa/silêncio mostra barras baixas, sem inventar atividade.
- Operação a 0 FPS quando IDLE. Limpar timer em todos os estados terminais.

## 6. Captura de áudio

### Contrato

```ts
interface AudioCapture {
  listDevices(): Promise<AudioDevice[]>;
  start(options: CaptureOptions, signal: AbortSignal): Promise<CaptureSession>;
}
interface CaptureSession {
  readonly samples: AsyncIterable<Int16Array>;  // observação para RMS, cópia controlada
  stop(): Promise<RecordedAudio>;             // idempotente, produz WAV válido
  cancel(): Promise<void>;                    // idempotente, não produz áudio
}
interface RecordedAudio {
  path: string; mimeType: 'audio/wav'; durationMs: number; bytes: number;
}
```

A implementação pode usar eventos/callbacks em vez de `AsyncIterable`; o contrato funcional é obrigatório, a assinatura é proposta.

### Backend preferencial

- **FFmpeg** como processo-filho sob supervisão. Usar `spawn(executable, args, { shell: false, stdio: ... })`; nunca interpolar parâmetros em shell.
- Windows: entrada DirectShow (`dshow`), nomes reais de dispositivo obtidos da enumeração; Linux: ALSA/PulseAudio/PipeWire conforme disponibilidade; macOS: AVFoundation.
- Capturar e resamplear para **PCM little-endian, mono, 16 kHz, 16-bit**. Ler `stdout` binário, enviar amostras para detector RMS, gravar em arquivo temporário seguro e finalizar WAV com cabeçalho correto.
- Não misturar logs de FFmpeg ao áudio. Consumir `stderr` de forma limitada para diagnóstico e descartar informações sensíveis.
- Não bloquear event loop durante gravação ou processamento das barras. Processar chunks incrementalmente.
- Implementar parada graciosa, timeout curto para encerrar processo, e kill como último recurso; verificar comportamento real de FFmpeg no Windows.
- Padrão: máximo 120 segundos, mínimo de áudio útil 350 ms; máximo de bytes derivado de sample rate/duração; configuração aceita limites até teto definido pelo produto.
- Se nenhum dispositivo de entrada estiver acessível, informar claramente e oferecer `/voice settings`/`doctor`.
- Tratar gravações silenciosas e falhas de captura como operação sem texto; não enviar silêncio desnecessariamente à nuvem.
- Arquivos temporários exclusivos por sessão, permissão restrita quando disponível; excluir sempre ao finalizar/cancelar/erro.
- Não persistir áudio nem texto transcrito por padrão.

### Quando Pi roda em WSL/SSH

Se o microfone estiver no Windows mas Pi for executado em WSL, contêiner ou SSH, captura local do processo remoto pode não enxergar o hardware. O MVP precisa detectar esse cenário e apresentar erro acionável; **não** instalar helpers automaticamente. Uma versão posterior pode incluir um bridge no host Windows com autorização explícita, bind somente em loopback quando possível e autenticação por token.

## 7. Transcrição — adapter único para serviço local ou remoto

```ts
interface TranscriptionProvider {
  readonly id: string;
  healthcheck(signal: AbortSignal): Promise<ProviderHealth>;
  transcribe(audio: RecordedAudio, options: {
    model: string; language?: string; timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ text: string; durationMs?: number }>;
}
```

- **Adapter P0:** `openai-compatible` via HTTP `POST /v1/audio/transcriptions` com `multipart/form-data`: arquivo `audio.wav`, `model`, `language` opcional; ler campo `text` da resposta JSON. Tratar variantes de erro do serviço sem supor compatibilidade plena de todos os endpoints.
- **Local recomendado:** [Speaches](https://speaches.ai/usage/speech-to-text/) com `faster-whisper` multilíngue já baixado e iniciado pelo usuário, endpoint por padrão `http://127.0.0.1:8000/v1/audio/transcriptions`.
- **Remoto:** endpoints OpenAI, Groq ou qualquer API que implemente o contrato com o mesmo adapter. Modelos **não** são hardcoded em código; configuração nomeia modelo exato informado pelo servidor.
- `language` default `pt` (Português); `auto` significa omitir parâmetro se o serviço suportar autodetecção.
- Padrão **local-first**, sem fallback para a nuvem sem aprovação expressa. Trocar de perfil só para a próxima gravação.
- Timeout padrão de transcrição 30 s; cancelamento com `AbortController`; sem retries automáticos de requisições que enviam áudio (evitar duplicação/custos).
- HTTP não seguro somente para `127.0.0.1`, `localhost`, `::1`; para host remoto exigir HTTPS e validação de certificado. Serviços LAN via HTTP requerem explícito override com aviso, proibido como default.
- Chaves exclusivamente por env vars (e no futuro stores do SO), nunca salvas em JSON, logs ou prompt.
- Resposta deve ser texto válido, comprimento limitado e sem tags de controle ANSI; texto de transcrição é dado do usuário, não comando do terminal.

## 8. Integração com o editor

- Usar API pública `ctx.ui.pasteToEditor(transcript)` preferencialmente; **não** sobrescrever tudo via `setEditorText()`.
- O texto transcrito entra na posição suportada pela API de paste; validar empiricamente a interação com cursor/seleção, undo, editor multilinha, texto existente e outra extensão que personalize o editor.
- Não executar `pi.sendUserMessage()` no fluxo padrão.
- `Esc` durante transcrição somente cancela se o handler for explicitamente seguro; comando `/voice cancel` sempre disponível. Não sequestrar `Esc`, `Enter`, `Ctrl+C` em estados em que o Pi espera usá-los.
- Remover bytes de controle, normalizar CR/LF, preservar palavras, caixa, números, nomes técnicos e semântica. **Não** realizar limpeza por LLM.
- Se texto estiver vazio, não inserir e informar `Nenhuma fala detectada`.
- Inserir transcrição uma única vez, incluindo sob callbacks repetidos/resposta atrasada; usar `sessionId` e estado para invalidar conclusões antigas.

## 9. Máquina de estados e concorrência

```text
IDLE --F8/start--> STARTING --> RECORDING --F8/stop--> FINALIZING
 ^                   |             |                  |
 |---erro/cancel-----+-------------+------------------+
 ^                                                        |
 |<--- cancel/error <--- TRANSCRIBING <--- áudio válido ---+
 |                            |
 +---------- sucesso + paste -+
```

Estados: `IDLE`, `STARTING`, `RECORDING`, `FINALIZING`, `TRANSCRIBING`, `CANCELLED`, `ERROR`, `SUCCESS` (estes três transitórios). Só **uma operação ativa** por instância do Pi.

- Controlar com ID de geração monotônico para ignorar eventos tardios após cancelamento/reload.
- `start` em `RECORDING` não cria outra captura; no atalho é toggle para stop. `stop` em `IDLE` não faz nada além de orientação discreta.
- `cancel` idempotente em qualquer estado. Finalização, limpeza e remoção de indicador obrigatórias em bloco `finally`.
- `session_shutdown`, reload/teardown e falha abrupta encerram timers, processo FFmpeg e requisição HTTP. Validar hook real da versão utilizada para descarregar extensão.
- Não impor lock global entre processos independentes do Pi, mas permitir opcionalmente detectar conflitos de dispositivo exclusivo e apresentar erro claro.
- Ao cancelar durante transcrição: invalidar resultado antes de abortar, evitando inserção tardia.

## 10. Configuração e onboarding

**Local sugerido:** `~/.pi/agent/voice-control.json` (perfis globais). Overrides opcionais por projeto em `.pi/voice-control.json` **sem segredos**, com precedência `CLI/env > projeto > global > defaults`, documentada e testada.

```json
{
  "shortcut": "f8",
  "language": "pt",
  "capture": {
    "backend": "ffmpeg",
    "deviceId": "default",
    "sampleRate": 16000,
    "channels": 1,
    "maxSeconds": 120
  },
  "ui": {
    "placement": "auto",
    "waveform": true,
    "bars": 14,
    "fps": 8,
    "showDuration": true
  },
  "transcription": {
    "profile": "local",
    "timeoutMs": 30000,
    "autoSubmit": false,
    "cloudFallback": false,
    "profiles": {
      "local": {
        "type": "openai-compatible",
        "endpoint": "http://127.0.0.1:8000/v1/audio/transcriptions",
        "model": "Systran/faster-whisper-small"
      },
      "remote": {
        "type": "openai-compatible",
        "endpoint": "https://api.openai.com/v1/audio/transcriptions",
        "model": "gpt-4o-mini-transcribe",
        "apiKeyEnv": "OPENAI_API_KEY"
      }
    }
  },
  "privacy": {
    "retainAudio": false,
    "retainTranscripts": false,
    "telemetry": false
  }
}
```

> O pacote deve versionar um JSON Schema real em `schemas/voice-control.schema.json`; o JSON de usuário não precisa de `$schema`. O perfil local só estará operacional depois da instalação/download de modelo e início do Speaches.

### Assistente de configuração

1. Detectar SO, terminal, caminho FFmpeg e dispositivo padrão; indicar requisitos faltantes.
2. Escolher microfone a partir de lista de dispositivos reais (não supor que o nome é igual entre execuções).
3. Testar captura curta com consentimento explícito; visualizar movimento das barras e confirmar áudio não silencioso.
4. Escolher `Local` ou `API`; se local, testar endpoint e listar modelos **apenas se o servidor expuser catálogo**; senão solicitar ID do modelo. Se remoto, solicitar nome da variável de ambiente para o segredo.
5. Escolher idioma, atalho; informar colisão com recursos conhecidos antes de salvar.
6. Validar e salvar configurações atômicas (arquivo temporário + rename) sem segredos. Mudanças no shortcut podem exigir `/reload` por ser registrado durante carregamento.
7. Mostrar instruções sucintas de início: `F8 para gravar; F8 para transcrever; /voice cancel para cancelar`.

## 11. Segurança e privacidade

- Gravador apenas inicia mediante interação humana explícita com Pi; sem wake-word, observação passiva ou gravação em background.
- Preferir perfil local e deixar claro ao trocar para API que **áudio será enviado para terceiros**. Exigir opt-in uma vez por perfil remoto, persistir decisão sem segredos.
- Não tentar escolher API automaticamente diante de indisponibilidade local.
- Configuração de URL validada contra SSRF básico: impedir `file://`, credenciais embutidas na URL, redirecionamentos a destinos não permitidos e cabeçalhos arbitrários não confiáveis; limitar tamanho/tempo da resposta.
- Captura de áudio em arquivo temporário com nome aleatório gerado por mecanismo criptográfico; arquivos `0600` em SOs compatíveis; exclusão em success, cancel, error, reload e shutdown; cleanup órfão no próximo início mediante prefixo conhecido e TTL.
- Não imprimir áudio, transcrição, tokens ou URL contendo credenciais em logs; redigir `Authorization`.
- Sem histórico de transcrições ou telemetria por padrão.
- Identificar a fonte como **entrada do usuário**, sem dar privilégios de instrução de sistema ao texto; nunca interpretar frases faladas como comandos do shell automaticamente.

## 12. Organização proposta de código

```text
pi-voice-control/
├── index.ts                    # fábrica e registro do Pi
├── package.json
├── README.md
├── LICENSE
├── schemas/voice-control.schema.json
├── src/
│   ├── core/controller.ts      # FSM, idempotência, cancelamento
│   ├── core/types.ts
│   ├── config/load.ts
│   ├── config/validate.ts
│   ├── audio/ffmpeg-recorder.ts
│   ├── audio/device-discovery.ts
│   ├── audio/wav-writer.ts
│   ├── audio/audio-meter.ts
│   ├── providers/transcription.ts
│   ├── providers/openai-compatible.ts
│   ├── ui/voice-indicator.ts   # widget/renderer compatível
│   ├── ui/settings.ts
│   ├── ui/doctor.ts
│   └── security/endpoint-policy.ts
├── examples/voice-control.local.json
├── examples/voice-control.remote.json
└── tests/
    ├── controller.test.ts
    ├── capture.test.ts
    ├── meter.test.ts
    ├── provider.test.ts
    ├── editor.test.ts
    ├── security.test.ts
    └── ui.test.ts
```

Evitar dependências de áudio nativas em Node.js no MVP. Preferir FFmpeg externo, `fetch`, `AbortController`, `spawn` e APIs já incluídas no runtime. Não criar MCP ou daemon dedicado na primeira versão. Publicar módulo TypeScript carregável por `pi -e .` e empacotável por `pi install`.

## 13. Requisitos não funcionais — metas de aceite

As metas abaixo são **objetivos de engenharia a medir**, não benchmarks já obtidos:

| Área | Meta de aceite |
|---|---|
| Startup do Pi | acréscimo < 100 ms no warm start, sem carregar modelo STT |
| Captura | sinal visual de início em ≤ 300 ms após confirmação de microfone acessível |
| UI | máximo 10 atualizações/s; ausência de flicker perceptível no terminal de referência |
| CPU extensão | não realizar inferência no processo Pi; processamento incremental dos samples |
| Memória | buffers RAM limitados, arquivos temporários em disco para áudio prolongado |
| Duração | gravação até 120 s; término automático ao atingir limite, informando a causa |
| Requisição | timeout 30 s configurável; cancelamento honrado pelo cliente |
| Integridade | 0 alterações de texto em erro/cancelamento e 1 inserção exata em sucesso |
| Compatibilidade | Windows Terminal + PowerShell P0; Linux/macOS testes de integração condicionais |
| Segurança | 0 segredos em logs e configurações; 0 fallback cloud não consentido |

**Indicadores de observabilidade local sem conteúdo sensível:** número de tentativas, tempos de inicialização/captura/transcrição, código de erro, provedor sem chave/token e volume aproximado de áudio; coleta opt-in em modo debug apenas em memória ou log local explicitamente ativado.

## 14. Plano de testes de aceitação P0

**Entrada/atalho:** F8 liga/desliga; autorepeat não duplica; foco fora do terminal impede acionamento; shortcut remapeado; conflito mostra diagnóstico; `Esc` não bloqueia cancelamento de resposta do Pi.

**Visuais:** som faz barras reagirem; silêncio fica próximo do mínimo; relógio correto; transcrição mostra spinner; widget some ao final; sem quebra em terminais de 32, 40, 80, 120 e 200 colunas; tema claro/escuro; terminal sem cor; mensagens continuam visíveis.

**Áudio:** dispositivo ausente, desconectado, negado, ocupado; sem frames; gravação de 100 ms; 15 s; 120 s; arquivo WAV válido; kill/reload; nomes com acentos e aspas no Windows; caminhos com espaços.

**Provider:** sucesso local e remoto via mocks; HTTP 401/403/429/500; timeout; JSON inválido; texto vazio; audio grande demais; endpoint http remoto bloqueado; cancelamento; sem reenvio automático.

**Editor:** vazio, texto existente, multilinha, cursor intermediário, Unicode, diacríticos, pontuação, termos técnicos, colagem de texto longo, undo. Se uma API pública não preservar seleção/cursor em determinada versão, documentar e adotar fallback não destrutivo em vez de substituir conteúdo.

**FSM:** duplo F8 rápido; iniciar durante TRANSCRIBING; cancelar durante STARTING/RECORDING/FINALIZING/TRANSCRIBING; resultados atrasados; mudança de sessão; reload e shutdown; teste por sequência aleatória de eventos assegurando que nenhum estado mantém timers/processos órfãos.

**Privacidade:** modelo local não faz requisição externa; API só recebe áudio mediante consentimento explícito; arquivos temporários removidos em todos os caminhos; chaves redigidas em erro e `doctor`.

**Qualidade de transcrição — avaliação manual:** amostras PT-BR com sotaque, ruído leve e nomes `Kafka`, `Kubernetes`, `OAuth2`, `Spring Boot`, `MCP`, caminhos de arquivo e símbolos de programação; documentar resultados, comparar candidatos sem prometer uma taxa de acerto não medida.

## 15. Sequência de implementação e Definition of Done

1. **Prova de compatibilidade** com Pi instalado: verificar versão, API de atalho F8, renderizador e eventual custom editor já instalado. Entregar teste manual documentado.
2. **Captura e FSM:** implementação com fake recorder e FFmpeg real; cleanup completo e testes de corrida.
3. **STT:** adapter OpenAI-compatible local/remote, profile e validação de segurança.
4. **UI:** meter RMS, indicador compatível e degradê para status; render responsivo e sem interferência no editor.
5. **Onboarding:** menu `/voice settings`, diagnóstico `/voice doctor`, documentação e exemplos.
6. **Release:** testes, lint/typecheck, `npm pack --dry-run`, compatibilidade Windows real, documentação sobre WSL/SSH e licenças.

A release está pronta apenas quando: F8 inicia/encerra; waveform reage ao microfone; STT local e remoto são alternáveis; texto é inserido exatamente uma vez; cancel/erro preservam editor; `doctor` detecta falhas; hot reload e encerramento não deixam processos; não há custo de API ou upload sem seleção explícita.

## 16. Riscos e decisões abertas antes da implementação

| Risco | Mitigação |
|---|---|
| F8 interceptado pelo terminal/harness | `/voice doctor` + remapeamento, `/voice start/stop` sempre acessíveis |
| Custom editor já utilizado por outra extensão | Não sobrescrever por padrão; usar widget abaixo do editor e fallback status |
| Entrada Pi em WSL/SSH, microfone no host | Detectar, diagnosticar e oferecer bridge em release futura |
| Animar onda sem acesso aos frames reais | Exibir pulsação estática e informar modo fallback; não fingir nível real |
| Extensão gera polling excessivo na TUI | Limite 8 FPS default, atualização incremental e pausa ao parar |
| Transcrição errada de identificadores de código | Não autoexecutar; permitir revisão; glossário determinístico P1 |
| Provedor local indisponível | Mensagem acionável; proibir troca silenciosa para API |
| Compatibilidade entre versões Pi | Faixa de versões suportadas testada; dependência `peer`/semver clara; evitar APIs privadas |

## 17. Referências primárias

- Pi — documentação de extensões: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
- Pi — keybindings, inclusive `f1` a `f12`: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md
- Pi Voice STT: https://github.com/cgarrot/pi-voice-stt
- Pi Voice local: https://github.com/earendil-works/pi-voice
- Pi Voice de alternância por função: https://github.com/mngad/pi-voice
- Pi Voice com Realtime (referência de organização, **não escopo**): https://github.com/iurysza/pi-voice
- Kitty keyboard protocol: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- Speaches: https://github.com/speaches-ai/speaches
- Documentação do Speaches STT: https://speaches.ai/usage/speech-to-text/
