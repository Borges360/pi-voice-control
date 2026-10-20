# pi-voice-control

Ditado nativo para **Pi Coding Agent 1.3.x**. Pressione **F8**, fale e pressione
**F8** novamente: o texto entra no editor para revisão, sem envio automático ao
agente. Captura FFmpeg, waveform RMS real, Whisper local incluído e STT remoto escolhido
explicitamente. Sem MCP, TTS, LLM de reformulação ou modelo carregado no Pi.

## Começar

Requisitos: Node >=22.19, `@earendil-works/pi-coding-agent` 1.3.x e FFmpeg no PATH.
No Windows, habilite **Configurações → Privacidade e segurança → Microfone →
Permitir que aplicativos da área de trabalho acessem seu microfone**.

```powershell
cd C:\Users\felip\Desenvolvimento\pi-voice-control
npm ci
pi -e .
```

No Pi, execute **`/voice`**. O painel mostra provedor, microfone, idioma, modelo e
atalho. Use **↑↓** para navegar, **Enter** para editar e **Ctrl+S** para salvar.
**Esc** volta de uma edição; no painel avisa antes de descartar alterações.
Salvar mantém o menu aberto. Não há autosave nem gravação ao abrir o menu.

O padrão é **Local incluído (Whisper)**. A instalação prepara o modelo multilíngue
quantizado (~45 MB) no cache do usuário. Não exige Python, Docker ou servidor STT.
Se o download falhar ou scripts de instalação forem bloqueados, abra
`/voice → Preparar motor local`; há progresso e Esc cancela. Também é possível
executar `npm run setup:local` no diretório do pacote.

No painel, selecione o microfone e use **Testar microfone** ou **Testar ditado**.
Os testes gravam somente após confirmação e descartam áudio/texto. Depois salve,
feche o menu e teste F8 → fala → F8 com texto já existente no editor.

Para instalar pelo mecanismo nativo do Pi, depois de revisar o código:

```powershell
pi install C:\Users\felip\Desenvolvimento\pi-voice-control
# Ou a fonte Git:
pi install git:github.com/Borges360/pi-voice-control
```

Não é preciso executar build para carregar `index.ts`. `npm run build` gera a
entrada ESM em `dist/index.js` para consumidores do pacote.

## Local incluído, OpenRouter ou servidor

O default usa Whisper tiny multilíngue (`onnx-community/whisper-tiny`), idioma
`pt`, em processo Node separado do Pi. Pesos e runtime vêm da instalação; a
inferência funciona offline e não acessa a rede. A revisão do modelo está fixada
no código. O serviço inicia sob demanda e termina após a operação, cancelamento
ou encerramento do Pi. O modelo tiny prioriza instalação leve e CPU; nomes
técnicos e fala com ruído podem ter menor precisão.

Para usar sua API **OpenRouter**, escolha o provedor no menu, configure o **nome**
da variável `OPENROUTER_API_KEY` e selecione **Modelo**. O catálogo mostra somente
modelos STT. Salve com Ctrl+S e autorize o endpoint/modelo escolhido. A integração
usa `/api/v1/audio/transcriptions` com áudio base64 JSON, sem chat ou reformulação.
Consulte a [documentação STT do OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/stt).
O menu informa se a variável está presente, sem revelar o valor. A chave precisa
estar no ambiente do processo antes de abrir o Pi.

Servidores HTTP compatíveis, como Speaches no homelab, continuam disponíveis no
perfil `local` legado ou em perfis JSON próprios. Configure uma URL real; não há
servidor presumido em `127.0.0.1:8000`. Uma configuração antiga explicitamente
salva é preservada: para migrar, escolha **Local incluído** e salve com Ctrl+S.

Qualquer servidor que aceite multipart OpenAI-compatible pode ser usado. A API
recebe `file=audio.wav`, `model`, `response_format=json` e `language`; `auto` omite
o idioma. O retorno deve ser JSON com `text`. Catálogo `/v1/models` é opcional.

Para API externa, selecione o perfil em `/voice` e confirme o envio de
áudio. Defina a chave no ambiente **antes de abrir o Pi**; forneça ao assistente
somente o **nome** da variável, por exemplo `OPENAI_API_KEY`. Nunca cole a chave
na configuração ou no prompt. Há exemplos em `examples/`.

Copiar o exemplo remoto **não autoriza uploads**. O consentimento global vincula
endpoint, modelo, variável de credencial e política HTTP. Mudança nesses campos
exige nova autorização. Não há fallback nem retry automático de upload.

## Comandos

| Comando | Ação |
| --- | --- |
| `/voice` | Painel interativo; Ctrl+S salva; não abre microfone |
| `/voice start` | Inicia captura mediante ação no terminal |
| `/voice stop` | Finaliza, transcreve e cola uma vez |
| `/voice cancel` | Descarta captura/requisição, preserva editor |
| `/voice status` | Estado, microfone, perfil, modelo, idioma, atalho |
| `/voice settings` | Alias para o mesmo painel e testes opcionais |
| `/voice doctor` | FFmpeg, dispositivos, ambiente, catálogo e diagnóstico |
| `/voice profile [nome]` | Lista/troca perfil na sessão; vale na próxima gravação |

No painel, Esc volta/cancela e Enter edita. Fora dele, as teclas mantêm a
semântica do Pi. Use `/voice cancel` para descartar voz.
Durante transcrição, novos inícios são recusados. Trocar sessão, árvore, fork,
`/reload` ou encerrar cancela a operação e libera os recursos.

## Configuração

Arquivo global: `~/.pi/agent/voice-control.json`. Override do projeto:
`.pi/voice-control.json` (ignorado pelo Git). Ambos aceitam JSON parcial; o
[schema](schemas/voice-control.schema.json) documenta os campos.

Precedência: **flags CLI > env > projeto > global > defaults**. Flags:
`--voice-profile local`, `--voice-language pt`. Variáveis:

| Variável | Efeito |
| --- | --- |
| `PI_VOICE_PROFILE` | Seleciona perfil já configurado |
| `PI_VOICE_LANGUAGE` | Idioma ou `auto` |
| `PI_VOICE_SHORTCUT` | F1–F12; registrada ao carregar; mudanças exigem `/reload` |
| `PI_VOICE_FFMPEG` | Caminho confiável do executável FFmpeg; não aceita argumentos |
| `PI_VOICE_SKIP_LOCAL_SETUP=1` | Adia download do modelo na instalação; reparo pelo menu |
| Nome indicado em `apiKeyEnv` | Credencial do perfil, lida apenas ao fazer request |

Ctrl+S salva configuração global atomicamente. Overrides de projeto/env/CLI
continuam tendo prioridade. `/voice profile nome` é uma seleção explícita apenas
na sessão, acima da escolha de perfil carregada. `remoteConsents` só é aceito no
arquivo global; um repositório não pode conceder autorização externa.

Defaults: gravação máxima 120s (teto 120), mínimo 350ms, timeout STT 120s,
PCM16 mono 16kHz, 14 barras e 8 FPS (teto 10). `ui.noiseFloorDb` calibra o
medidor; `capture.silenceRms` evita envio de silêncio. Áudio fica em arquivo
temporário exclusivo, limitado a 3,84 MB de PCM, e é apagado em todos os desfechos.

HTTP só é aceito em loopback. Para servidor LAN com HTTP, a configuração avançada
exige `allowInsecureHttp: true` no perfil **e** confirmação de envio para esse
endpoint. HTTPS remoto valida certificados; `NODE_TLS_REJECT_UNAUTHORIZED=0` é
recusado. URLs com credenciais/query/fragmento e redirecionamentos são bloqueados.

Antes de abrir o microfone, a extensão verifica a instalação local ou a conexão
com o servidor. `STT_REFUSED` indica serviço ausente, `STT_DNS` resolução de nome
e `STT_TLS` certificado inválido; autenticação e saldo têm mensagens próprias.
Use **Testar conexão / motor** no menu. Nenhuma falha muda o provedor automaticamente.

O cache `~/.pi/agent/cache/voice-control` guarda apenas os pesos/configurações do
modelo. Áudio, transcrição e chaves não são guardados nele. Instalação em CI adia
o download; inferência e testes reais do motor exigem preparo explícito.

## Interface e compatibilidade

Widget próprio **abaixo do editor**, alinhado à direita. Não substitui editor ou
footer. ≥80 colunas: ponto, contador e barras; 40–79: ponto e contador; <40:
`● REC`. `ui.placement: "status"` usa a chave própria no rodapé. `NO_COLOR` e
`TERM=dumb` desativam cores. Não há timer de animação em IDLE ou transcrição.

Pi 1.3 não reconhece teclas F com modificadores; remapeie entre F1 e F12.
Pacotes Kitty equivalentes são normalizados antes do matcher nativo. Com
press/repeat/release, repetições são ignoradas por estado da tecla. No VT legado
não há distinção exata entre tecla solta/repetida: proteção de 750ms no início e
250ms entre eventos reduz duplicações. Um terminal com atraso de autorepeat
incomum pode exigir usar `/voice start` e `/voice stop`. Bindings do Windows
Terminal podem interceptar F8 antes do Pi; o Pi mostra conflitos com extensões
e atalhos internos ao carregar. Nenhum hook global é instalado.

Foco é acompanhado por eventos do terminal. Sem suporte a focus reporting, a
extensão depende da entrega de teclas exclusivamente à janela ativa. Não captura
em RPC/print. WSL/SSH/contêiner exigem microfone/source acessível ao host do Pi;
o default é bloqueado quando detectado esse ambiente, com orientação acionável.
Linux usa PulseAudio/PipeWire-Pulse e fallback ALSA; macOS usa AVFoundation.
Esses SOs têm testes de parser/argv; hardware real permanece validação condicional.

## Desenvolvimento e evidências

```powershell
npm run lint
npm test
npm run test:integration
npm run benchmark
npm pack --dry-run
```

`npm test` cobre FSM/corridas, configuração/schema, segurança, provider, processo,
UI e o **Editor real do Pi**, incluindo cursor, Unicode, multiline e undo.
Integração usa FFmpeg real com sinal sintético e STT HTTP loopback simulado.
Teste de microfone real só é habilitado com `VOICE_MIC_TEST=1`; nunca envia áudio
a STT. CI inclui Windows/Linux, Node 22/24, sem captura de hardware nem API paga.

**Aceite P0 ainda requer validação humana no Windows Terminal com voz e STT real.**
Consulte [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) para evidências e roteiro;
não confunda mocks/PTY automatizado com esse aceite manual. Arquitetura e limites
de segurança: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

O contrato de UX desta versão está em [docs/EXTENSION_UX.md](docs/EXTENSION_UX.md).
