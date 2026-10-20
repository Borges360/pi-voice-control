# Evidências P0 — 20/10/2026

**Status: implementação disponível; aceite manual de hardware/STT pendente.**
Não marcar todos os critérios P0 como concluídos até validar o roteiro abaixo
no Windows Terminal com voz e motor de transcrição real.

## Ambiente observado

- Windows x64, Node 24.14.0, Pi instalado 1.3.0 (`@earendil-works/*`).
- FFmpeg executável no PATH; enumeração DirectShow encontrou 1 entrada de áudio.
- Nenhuma captura de microfone físico feita pelo agente durante implementação.
- `/voice doctor` no Pi real encontrou STT loopback padrão indisponível
  (`STT_NETWORK` em `127.0.0.1:8000`); não houve troca de provedor.
- Nenhum request com áudio para provedor externo; testes remotos usam fetch mock.

## Validação automatizada

`npm test`: **61 testes aprovados**. FSM, lock, cancelamento STARTING/RECORDING/FINALIZING/TRANSCRIBING,
resultado tardio, stop idempotente, troca de geração, erro/silêncio sem paste,
configuração/schema/preferências, consentimento e wizard, HTTP multipart real em
loopback, catálogo opcional, 401/403/429/500, JSON malformado, corpo excessivo,
timeout, cancelamento de body stream, redirect bloqueado e redação de erros.

Editor oficial do Pi: vazio/texto existente/multilinha/Unicode, cursor no meio,
paste longo/collapse, undo e zero submissões. UI: 0/1/4/32/40/80/120/200 colunas,
alinhamento, composição de chaves de outras extensões, limite de frames,
zero frames em IDLE e filtro de foco/repeat/press/release.

Subprocessos Node substituindo apenas a entrada FFmpeg exercitam supervisão real:
saída normal, falha de spawn, falta de frames, processo ignorando `q`, desconexão,
aborto e confirmação de PID encerrado. WAV válido e diretório apagado são
verificados; logs sensíveis de processo não aparecem no erro.

`npm run test:integration`: FFmpeg real (`lavfi` seno 440Hz) → PCM mono 16kHz
int16 → RMS → WAV → HTTP STT loopback de fixture → cleanup. O texto de fixture
valida o contrato HTTP, **não** a qualidade de inferência. Microfone real é um
teste separado, ignorado por padrão; `VOICE_MIC_TEST=1` é opt-in explícito e
não envia áudio ao STT.

Pi real no PTY Windows (PowerShell, TUI regular), sem agente/model request:
`pi --offline -ne --no-mcp -ns -np -nc --no-session -nt --tui-mode regular -e .`.
Carregamento da extensão, `/voice status`, `/voice doctor`, `/reload` e novo
`/voice status` verificados. Essa automação não é validação humana do Windows
Terminal nem teste de reload durante gravação física.

Benchmark local observado (uma execução; não garantia de latência da TUI):

| Medida | Resultado |
| --- | --- |
| Import ESM frio (inclui Pi TUI) | 62,51 ms |
| Fábrica warm mediana / p95 (100 execuções) | 0,04 / 0,10 ms |
| Processamento incremental de PCM equivalente a 120s | 6,40 ms |
| Buffer de waveform | 14 valores fixos |

O loader oficial TypeScript/Jiti também é testado. O tempo frio do loader inclui
transpilação e não deve ser confundido com o benchmark da fábrica warm.

Comandos adicionais de entrega: `npm run lint`, `npm pack --dry-run`, `npm audit`,
`node .harness/project.mjs verify` e `harness doctor` (path do projeto).
CI versionado para Windows/Linux com Node 22/24; execução remota depende do host.

O marker ai-memory está alinhado ao harness (`homelab/pi-voice-control`, sem
fallback `default`). O servidor ainda não possui esse projeto; a consulta de
status retornou "project not found". Nenhuma página foi escrita e a extensão
não depende desse serviço.

## Roteiro humano — Windows Terminal / PowerShell

1. Inicie um STT local multilíngue compatível; confira seu modelo e endpoint.
   Abra `pi -e C:\Users\felip\Desenvolvimento\pi-voice-control`.
2. `/voice settings`: escolha o microfone, `pt`, Local, endpoint/modelo exatos.
   Autorize teste de captura curta; fale; confira waveform real e feedback RMS.
   Autorize STT de teste; confirme sucesso sem mudança no editor. Salve.
3. `/voice doctor`: confirme FFmpeg, seleção e catálogo (se disponível).
4. Digite texto multilinha com acentos e posicione cursor no meio. F8 → fale
   "Kafka, Kubernetes, OAuth2, Spring Boot, MCP" → F8. Confira inserção única,
   conteúdo anterior intacto, nenhum envio ao agente, widget removido. Teste undo.
5. Segure F8 e pressione em duplicidade; confirme ausência de toggle acidental.
   Remapeie para F9, `/reload`, teste. Confira colisão no terminal e avisos do Pi.
   Em VT legado, observe a limitação temporal documentada no README.
6. Tire foco do terminal; F8 não pode iniciar captura. Volte e verifique estado.
   Teste durante resposta do agente: editor/footer e widgets alheios preservados;
   Esc e Ctrl+C continuam com o Pi.
7. `/voice cancel` em captura e transcrição. Teste desconectar microfone, porta STT
   errada, modelo ausente, 401/429 e timeout; editor não muda e TUI responde.
8. Grave silêncio, <350ms, ~15s e até 120s. Verifique limite automático, WAV e
   exclusão de temporários (`$env:TEMP\pi-voice-control-*`), sem guardar gravação.
9. `/reload` durante gravação/transcrição e encerramento do Pi. Verifique que o
   FFmpeg da operação terminou e o diretório temporário foi removido. Teste mudança
   de sessão/fork para garantir que texto não vá ao editor errado.
10. Em `/voice settings`, escolha API externa. Leia o aviso de endpoint/modelo e
    aceite apenas se quiser enviar áudio. Defina a chave no ambiente; nunca a cole
    no JSON. Faça um teste aprovado; alterne local/remote com `/voice profile`.
    Recuse consentimento em um perfil novo e confirme zero uploads.
11. Redimensione para 32/40/80/120/200 colunas; confira tema claro/escuro,
    `NO_COLOR` e coexistência com custom editor/extensões realmente instaladas.

## Registro de aceite pendente

Registrar somente data, SO/terminal/versões, resultado por passo e códigos de
falha. Não anexar áudio, transcrições, nomes pessoais de dispositivos ou chaves.
Taxa de acerto PT-BR/identificadores e latência de inferência ainda não medidas.

| Critério do contrato | Evidência atual |
| --- | --- |
| 1. Atalho inicia/finaliza | Wiring e parser automatizados; hardware/TUI humano pendente |
| 2. Waveform reage à voz real | RMS validado PCM + FFmpeg seno; voz física pendente |
| 3. Indicador desaparece | Testes de UI e lifecycle; avaliação visual humana pendente |
| 4. Alternar local/remoto | Perfis, wizard, adapter e mocks; inferência real pendente |
| 5. Preservar editor | Editor oficial real testado, incluindo cursor e undo |
| 6. Erros sem travar TUI | Testes de falhas e doctor no Pi real |
| 7. Sem órfãos | Supervisor/PIDs/cleanup testados; reload físico pendente |
| 8. Testes automatizados | Implementados e executados |
| 9. Manual Windows Terminal | **Pendente de execução humana** |
| 10. Consentimento explícito | Bloqueios e wizard testados; zero upload externo na implementação |
