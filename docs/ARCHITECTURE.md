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
  áudio em RAM; UI usa buffer fixo 14–20 valores, ataque 0,35/decaimento 0,18.
- `providers/transcription.ts`: contrato independente do motor STT; adapter
  `openai-compatible.ts` implementa fetch multipart e catálogo opcional.
- `config/`: merge estrito/validação, perfil default local, env/CLI, save atômico.
- `security/`: política de endpoint, consentimento SHA-256 dos campos autorizados,
  sanitização de controles de terminal, sem correção semântica.
- `ui/`: widget/status na chave `pi-voice-control`, setup e diagnóstico.

## Estados e concorrência

Fluxo: `IDLE → STARTING → RECORDING → FINALIZING → TRANSCRIBING → SUCCESS → IDLE`.
Erro: `ERROR → IDLE`. Cancelamento: `CANCELLED → IDLE` depois da limpeza.
Nenhum resultado de geração inválida pode inserir ou limpar UI da próxima sessão.
`stop()` é idempotente; flags de inserção são marcadas antes do paste.
Nenhum callback externo é interpretado como código ou comando de shell.

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
wizard. O adapter exige autorização antes de abrir microfone/POST externo.
Catálogo autenticado externo também exige autorização, para evitar que um
override de projeto redirecione credenciais para outro host através de doctor.

Consentimento é global, por endpoint/modelo/env/política HTTP, e nunca herdado de
um projeto. Variáveis de chave são consultadas no request; valores nunca entram
em JSON, erros ou notificações. Corpo de erro e stderr FFmpeg não são mostrados.
O nome do modelo/idioma/microfone podem aparecer em status; áudio e transcrição
não são registrados nem persistidos. Texto fica apenas no editor que o usuário
decidiu preencher. A chave de consentimento é um registro de escolha, não uma
assinatura de segurança contra alguém com controle da conta do SO.

Sem redirect, retries, headers arbitrários ou fallback. Resposta limitada a
256 KiB; texto limitado a 100.000 caracteres. Upload WAV limitado a 3.840.044
bytes (até 120s); buffer multipart é limitado pelo mesmo teto. JSON de configuração
limitado a 128 KiB; unknown fields, prototype pollution e opções fora do P0 são
recusados. Serviços que precisem query de autenticação, formato não JSON ou outras
rotas precisam de adapter futuro, não de um bypass automático.

Loopback é a fronteira local do MVP. Não há proxy de microfone nem resolução DNS
customizada para prometer isolamento adicional contra um SO/DNS comprometido.
Processo terminado à força pode deixar arquivo até o TTL; não há promessa de
apagamento forense. No Windows, ACL segue o diretório temporário da conta.

## Compatibilidade e referências

Código próprio sob MIT; nenhuma implementação de extensão de terceiros foi
copiada. Referências de produto constam em `pi-voice-control-spec.md`.
API oficial: [extensões Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
[keybindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md),
[Kitty](https://sw.kovidgoyal.net/kitty/keyboard-protocol/),
[Speaches STT](https://speaches.ai/usage/speech-to-text/).
O nome histórico `@mariozechner/pi-coding-agent` da especificação foi substituído
pelo pacote atual usado pelo host e pelos projetos locais: `@earendil-works/*`.
A faixa peer é estreita (1.3.x); ampliar requer repetir os testes de integração.
