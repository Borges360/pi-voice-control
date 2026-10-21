# Arquitetura e segurança

`index.ts` é a fábrica nativa Pi: registra comando, flags, atalho e lifecycle.
Não registra ferramentas para o agente e não depende de extensões irmãs.
Contratos públicos do Pi 1.3.0 foram conferidos no pacote instalado, tipos e
código de `pasteToEditor`, widgets e teardown de `/reload`.

## Componentes

- `core/controller.ts`: uma operação, geração monotônica, estados, snapshot de
  configuração, invalidação antes de abort, lock até captura atrasada ser limpa.
- `audio/ffmpeg-recorder.ts`: spawn sem shell, pipe PCM separado de stderr,
  confirmação de início por frames reais, timeout 8s, `q` e kill após 1s.
- `audio/wav-writer.ts`: escrita assíncrona com backpressure, limite de bytes,
  cabeçalho WAV finalizado, permissões POSIX 0600, diretório exclusivo por sessão.
- `audio/audio-meter.ts`: RMS em janelas de 320 amostras (20ms), sem armazenar
  áudio em RAM; UI usa buffer fixo 14–20 valores, ganho visual para fala baixa,
  escala até -18 dBFS e ataque 0,90/decaimento 0,65 para acompanhar sílabas.
- `providers/transcription.ts`: contrato independente do motor STT; factory somente local, com escolha
  entre Whisper tiny, base e small.
- `local/`: processo Node descartável com Transformers.js/ONNX CPU e Whisper tiny/base/small.
  Biblioteca ML só é importada no processo filho. IPC transmite um resultado;
  stdout/stderr são ignorados e não herda credenciais, NODE_OPTIONS ou flags Pi.
  Modelo/revisão fixos; download apenas na instalação/reparo. Inferência carrega
  os arquivos do cache e bloqueia fetch. Encerramento espera close do processo.
- `config/`: merge estrito/validação, modelo tiny/base/small, migração legada, env/CLI e save atômico.
- `security/`: sanitização de controles de terminal, sem correção semântica.
- `ui/`: widget/status na chave `pi-voice-control`, painel transacional Ctrl+S e diagnóstico.

O painel genérico em `settings-panel.ts` usa somente APIs Pi e recebe callbacks
do produto. Não enumera dispositivos nem acessa rede ao abrir. Rascunho, save,
discard, abort e drenagem de ações são explícitos. Nenhuma extensão irmã é necessária.

## Estados e concorrência

Fluxo: `IDLE → STARTING → RECORDING → FINALIZING → TRANSCRIBING → SUCCESS → IDLE`.
Erro: `ERROR → IDLE`. Cancelamento: `CANCELLED → IDLE` depois da limpeza.
Nenhum resultado de geração inválida pode inserir ou limpar UI da próxima sessão.
`stop()` é idempotente; flags de inserção são marcadas antes do paste.
Nenhum callback externo é interpretado como código ou comando de shell.
Antes do microfone, `prepare` verifica o marcador da revisão do modelo local selecionado. Cancelamento durante essa fase invalida a abertura tardia da captura.

O controller inicia um timer de duração apenas em RECORDING. O widget tem seu
próprio timer de no máximo 10Hz somente em RECORDING. O backend também limita a
duração de mídia com `-t` e os bytes do arquivo; o controller limita tempo de
parede, inclusive quando o dispositivo deixa de fornecer frames.

`session_shutdown` é emitido pelo Pi antes de invalidar contexto no `/reload`.
Ele aborta wizard/diagnóstico, aguarda sua limpeza, remove listener de input,
dispõe controller/widget e desativa focus reporting. Hooks de troca/fork/árvore
também limpam antes de mudar o destino do texto. Listener de `process.exit` só
existe enquanto há FFmpeg ativo; encerra os filhos sincronamente em saída abrupta.
SIGKILL do próprio Pi não pode executar cleanup; diretórios de mais de 24h são
limpos no próximo início apenas se o processo dono não existir e o conteúdo tiver
nomes conhecidos. PID reutilizado preserva diretório por precaução.

## Editor e atalhos

Somente `ctx.ui.pasteToEditor(text)` altera o editor, depois de sucesso e teste de
geração. Não há `setEditorText`, `sendUserMessage`, `setFooter` ou custom editor.
O paste usa tratamento bracketed-paste do Pi: respeita cursor, texto existente,
undo e collapse de texto longo. Não se promete suporte a seleção em custom
editors que alterem o contrato; testes cobrem o Editor oficial e composição de UI.

`onTerminalInput` só acompanha foco e o binding da voz. Para Kitty, normaliza
F1–F12 sem modificadores para os pacotes legados reconhecidos pelo Pi 1.3, depois
de filtrar repeat/release. Todas as outras teclas passam intactas. O binding é
registrado por `pi.registerShortcut`; conflitos são diagnosticados pelo Pi.
O VT legado não contém key-up; o fallback temporal é uma limitação explícita.

## Confiança, rede e dados

Áudio só é produzido em start por input humano/comando, ou teste confirmado do
painel. Não existe caminho de upload ou solicitação de chave.

Transcrição exclusivamente local. Não há adapter HTTP, API externa, credencial,
consentimento remoto ou resolução de endpoint. `local/models.mjs` permite apenas
três repositórios/revisões fixos: tiny, base, small. Configuração usa nomes curtos.
A inferência desativa downloads e bloqueia fetch. Instalação/reparo, sem captura de
áudio, pode baixar somente o modelo escolhido do Hugging Face. Pesos nunca são
incluídos no Git nem no pacote; ficam no cache do usuário. Cada modelo/revisão tem
seu próprio marcador de preparo. Arquivos parciais não tornam o modelo pronto.
O marcador tiny antigo continua válido. Ctrl+S garante o preparo antes do save
atômico; abort/falha de download não altera a seleção salva.

Configurações 0.1/0.2 são migradas em memória: seleção local reconhecida é
preservada; seleção externa passa a tiny. Perfis/consentimentos antigos são
removidos do valor efetivo e não chegam ao provider. O arquivo só muda no save.

Processo terminado à força pode deixar arquivo até o TTL; não há promessa de
apagamento forense. No Windows, ACL segue o diretório temporário da conta.

## Compatibilidade e referências

Código próprio sob MIT; nenhuma implementação de extensão de terceiros foi
copiada. Referências de produto constam em `pi-voice-control-spec.md`.
API oficial: [extensões Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
[keybindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md),
[Kitty](https://sw.kovidgoyal.net/kitty/keyboard-protocol/).
O nome histórico `@mariozechner/pi-coding-agent` da especificação foi substituído
pelo pacote atual usado pelo host e pelos projetos locais: `@earendil-works/*`.
A faixa peer é estreita (1.3.x); ampliar requer repetir os testes de integração.
