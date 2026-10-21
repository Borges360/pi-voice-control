# Evidências da versão 0.3 — Whisper exclusivamente local

Status: implementação validada automaticamente. Aceite humano com microfone físico
no Windows Terminal ainda precisa ser conferido pelo usuário.
As opções HTTP/OpenRouter e os testes de adapters removidos não integram o produto atual.

## Verificado

- Windows x64, Node 24, Pi 1.3.x e FFmpeg no PATH.
- Escolha fechada tiny/base/small, com repositórios e revisões fixos.
- Download real e carregamento offline dos três modelos no cache do usuário.
- Modelos separados do processo do Pi; rede bloqueada durante inferência/probe.
- Menu nativo com rascunho, Enter para editar, Ctrl+S para preparar/salvar.
- Erro ou cancelamento de download preserva a configuração anterior.
- Migração de configurações 0.1/0.2 para somente local; Ctrl+S persiste o novo formato.
- Estados/corridas, fechamento/reload, processos encerrados, editor e outros widgets preservados.
- Waveform sensível à fala baixa e às pausas, sem alteração do ganho do microfone.

**58 testes de unidade aprovados** (`npm test`) e lint sem erros.
Pacote conferido com `npm pack --dry-run`: ~71 kB, sem pesos/adapters removidos.
Whisper tiny, base e small transcreveram o fixture português offline em processos
separados (aprox. 4,5 s, 4,0 s e 6,8 s nesta execução; não é benchmark).

`npm test` cobre configuração/schema, precedência, modelo default da instalação,
migração de perfis externos, três escolhas no painel, download cancelado/falho,
FSM, cancelamento tardio, supervisão e editor oficial do Pi.
`npm run test:integration` cobre FFmpeg real com seno PCM16/16kHz/mono e cleanup.
A inferência real em português usa áudio sintético, com opt-in
`VOICE_LOCAL_TEST=1`, `VOICE_LOCAL_WAV=<arquivo WAV>` e
`VOICE_LOCAL_MODELS=tiny,base,small`. A revisão automática bloqueou a exclusão dos WAVs sintéticos desta execução.
Ficaram no diretório ignorado `.acceptance-local/model-check*.wav`, fora do Git e do pacote.
Nenhuma captura física ou envio a servidor é necessário.

## Roteiro humano no Windows Terminal

1. Atualize a extensão e execute `/reload`.
2. Abra `/voice`, escolha Modelo e confirme apenas tiny, base e small.
3. Escolha base ou small; Ctrl+S deve baixar/preparar com progresso, depois salvar.
4. Durante um download pendente, Esc deve cancelar sem salvar a nova escolha.
5. Verificar modelo deve funcionar offline após o preparo.
6. Configure o microfone e teste com confirmação; nenhum teste altera o editor.
7. Com texto existente, F8 → fala → F8 deve colar uma única transcrição sem enviar ao agente.
8. Observe waveform, contador e desaparecimento após sucesso/cancelamento.
9. Teste `/voice cancel`, `/reload` e saída durante captura/transcrição; confirme limpeza.
10. Repita com os três modelos, comparando precisão e tempo no seu equipamento.

Pesos ficam em `~/.pi/agent/cache/voice-control`; Git e pacote não podem conter
ONNX/safetensors/GGUF. Áudio/transcrição não são persistidos nesse cache.
