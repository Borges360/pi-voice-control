# pi-voice-control

Ditado nativo para **Pi Coding Agent 1.3.x**, com Whisper **100% local**.
Pressione **F8**, fale e pressione **F8** novamente: o texto entra no editor para
revisão, sem envio automático ao agente. FFmpeg captura áudio e a waveform reage
às amostras RMS reais. Escolha entre **tiny, base e small**, em português ou outros idiomas.

## Instalar

Requisitos: Node >=22.19, Pi 1.3.x e FFmpeg no PATH.
No Windows, habilite o acesso de aplicativos da área de trabalho ao microfone.

```powershell
pi install git:github.com/Borges360/pi-voice-control
```

A instalação baixa **somente o tiny por padrão** (~45 MB), do Hugging Face para
`~/.pi/agent/cache/voice-control`, fora da extensão e do seu projeto.
**Nenhum peso de modelo está no Git nem no pacote publicado.** Não exige Python,
Docker, chave de API ou servidor. Após o download, a transcrição funciona offline.

Para escolher outro modelo já na instalação, no PowerShell:

```powershell
$env:PI_VOICE_MODEL = 'base' # tiny, base ou small
pi install git:github.com/Borges360/pi-voice-control
Remove-Item Env:PI_VOICE_MODEL
```

A escolha da instalação fica no cache como default; configurações explicitamente
salvas no Pi mantêm prioridade. Atualizações reaproveitam o cache e o modelo salvo.
Com scripts bloqueados, rede indisponível ou `PI_VOICE_SKIP_LOCAL_SETUP=1`, o menu
continua disponível e informa como baixar o modelo antes de gravar.

## Escolher o modelo

Execute **`/voice` → Modelo → tiny, base ou small → Ctrl+S**.
Enter abre/edita, ↑↓ navega e Esc volta ou cancela. As alterações são rascunho.
Ctrl+S baixa o modelo escolhido, se necessário, e só salva após o preparo terminar.
Download interrompido ou com erro preserva a configuração anterior.
A ação **Preparar modelo** permite baixar/reparar explicitamente o modelo do rascunho.
Abrir o painel ou apenas navegar na lista não inicia downloads nem gravações.

| Modelo | Download aproximado (q8) | Prioridade |
| --- | ---: | --- |
| tiny | 45 MB | Leveza e rapidez |
| base | 80 MB | Equilíbrio entre precisão e processamento |
| small | 255 MB | Mais precisão, maior consumo de CPU e memória |

São modelos multilíngues, com repositório e revisão fixos; idioma padrão `pt`.
O tamanho de download não é o consumo de RAM. Desempenho depende do computador.
O processo de inferência separado usa CPU e ONNX Runtime, encerrando ao terminar.
Somente instalação/reparo acessa a rede; durante a transcrição, fetch é bloqueado.
Não há integração com APIs externas, OpenRouter, servidor HTTP ou fallback em nuvem.

Use **Verificar modelo**, **Testar microfone** ou **Testar ditado** no painel.
Testes de microfone pedem confirmação e descartam áudio/texto. O teste de ditado
usa o modelo selecionado no rascunho e exige que ele já esteja preparado.

## Comandos e configuração

| Comando | Ação |
| --- | --- |
| `/voice` ou `/voice settings` | Abre o painel; Ctrl+S salva |
| `/voice start` | Inicia gravação |
| `/voice stop` | Encerra, transcreve e cola uma vez |
| `/voice cancel` | Cancela e preserva o editor |
| `/voice status` | Estado, modelo, microfone, idioma e atalho |
| `/voice doctor` | Diagnóstico de FFmpeg, dispositivos e modelo offline |
| `/voice model [tiny\|base\|small]` | Lista/troca modelo só na sessão; use o painel para baixar/salvar |

Configuração global: `~/.pi/agent/voice-control.json`.
Override por projeto: `.pi/voice-control.json`, ignorado pelo Git.
JSON parcial, com [schema](schemas/voice-control.schema.json):

```json
{
  "language": "pt",
  "transcription": { "model": "base" }
}
```

Precedência: **flags CLI > env > projeto > global > default da instalação > tiny**.
Flags: `--voice-model base`, `--voice-language pt`.
A troca por `/voice model` vale para a sessão, acima da configuração carregada.

| Variável | Efeito |
| --- | --- |
| `PI_VOICE_MODEL` | tiny, base ou small; também seleciona o download na instalação |
| `PI_VOICE_LANGUAGE` | Idioma ou auto |
| `PI_VOICE_SHORTCUT` | F1–F12; mudança exige /reload |
| `PI_VOICE_FFMPEG` | Caminho do executável FFmpeg, sem argumentos |
| `PI_VOICE_SKIP_LOCAL_SETUP=1` | Adia download; Ctrl+S no painel prepara depois |

Versões 0.1/0.2: arquivos antigos são adaptados em memória para o modo local.
Perfis HTTP, referências a chaves e consentimentos são descartados da configuração
carregada. Ctrl+S grava o novo formato; arquivos não são reescritos ao abrir.
Seleção externa antiga passa a tiny; preferências de microfone, idioma e atalho são mantidas.
`PI_VOICE_PROFILE` e `/voice profile` foram substituídos por seleção de modelo.

Máximo de gravação: 120 s, mínimo: 350 ms; PCM16 mono 16 kHz e timeout de 120 s.
Áudio temporário limitado a 3,84 MB é removido após uso ou cancelamento.
Áudio e transcrição não são persistidos no cache. O texto é colado no editor,
sem execução como comando ou correção por LLM. Falhas preservam o editor.

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
npm ci
pi -e .
npm test
npm run test:integration
npm run lint
npm pack --dry-run
```

Para preparar manualmente o modelo: `npm run setup:local` (respeita `PI_VOICE_MODEL`).
`npm test` cobre estados, concorrência, configuração/migração, escolha de modelos,
download cancelado, processo supervisionado, TUI e Editor real do Pi.
Integração usa FFmpeg com áudio sintético; microfone físico é opt-in `VOICE_MIC_TEST=1`.
CI Windows/Linux, Node 22/24, adia modelos; não exige rede para os testes de unidade.

Detalhes: [arquitetura](docs/ARCHITECTURE.md), [UX](docs/EXTENSION_UX.md) e
[evidências/aceite manual](docs/ACCEPTANCE.md).
