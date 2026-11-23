# Contrato básico de UX de extensões Pi

Padrão canônico no harness: `workspace/docs/pi-extension-standard.md`.
Este documento resume o contrato aplicado por esta extensão.

- `/voice` abre o menu com os valores atuais. `/voice settings` é um alias.
  Abrir o menu não enumera dispositivos, não grava, não baixa e não acessa rede.
- ↑↓ navega (para nas pontas); Enter edita/abre; Tab alterna para a barra
  [Save changes] [Help] [Close]; `/` busca itens; F1/`?` abrem a ajuda.
- Ctrl+S valida e salva sem fechar o painel e confirma na linha de status.
  Edições são rascunho (título com `*`). Não há autosave silencioso.
- Esc em campo ou lista de escolha volta sem aplicar. Esc no painel com
  rascunho avisa (Continue editing / Save and close / Discard changes); o
  segundo Esc descarta e fecha. Esc durante operação ou salvamento cancela pelo
  `AbortSignal` e o painel continua utilizável.
- Campos: modelo (tiny/base/small com tamanho), microfone (lista carregada só
  ao ativar o campo), idioma da transcrição (validado no campo), atalho F1–F12
  (mostra `/reload` pendente) e idioma da interface. Valores definidos por
  `.pi/voice-control.json`, `PI_VOICE_*` ou `--voice-*` mostram a origem
  (`[source: …]`), não são editáveis aqui e nunca são gravados no arquivo global.
- Ações: Check model, Prepare model (progresso, Esc cancela), Test microphone e
  Test dictation (confirmação com foco em Go back), Diagnostics (resultado nas
  notificações), Start/Stop dictation (exige rascunho salvo) e Cancel
  dictation. As duas últimas fecham o painel e devolvem a ação ao `index.ts`.
- Ctrl+S prepara o modelo antes de salvar (até 11 min, progresso na linha de
  status); falha ou cancelamento preserva a configuração salva e o rascunho.
  Se o salvamento não confirmar, Ctrl+S ou [Check storage] relê o arquivo antes
  de qualquer nova gravação.
- Idioma: inglês por padrão; o seletor Language troca o painel ao vivo para
  PT-BR (prévia) e só grava `.pi/pi-voice-control.locale.json` com Ctrl+S em
  projeto confiável. Descartar a prévia volta ao idioma salvo. Em projeto não
  confiável a linha fica bloqueada com o motivo.
- Tema do host (`theme.fg`/`theme.bold`), sem ANSI fixo; nenhuma linha passa
  da largura pedida (medida com `visibleWidth`); abaixo de 40×12 o painel pede
  para redimensionar. Editor e footer global preservados.
- Toda ação possui abort, timeout e cleanup. Fechar/reload aborta o sinal do
  painel; resultados que chegam depois do Esc são informados, mas não usados.

## Implementação

`src/ui/settings.ts` declara campos, ações, mensagens e persistência do produto e
abre o painel com `openPiSettings` da cópia versionada em
`src/vendor/inteiro-terminal/` (estado, teclado e renderização por projeção;
procedência e licença em `src/vendor/THIRD_PARTY_NOTICES.md`). A cópia não é
editada à mão: é regenerada pelo script de vendoring do repositório de origem e
verificada por `tests/vendor.test.mjs` sem depender daquele checkout.

A instalação padrão inclui o runtime Whisper local e baixa tiny para o cache do usuário.
`PI_VOICE_MODEL` escolhe base/small na instalação; pesos fora do Git/pacote. Instalação
offline/bloqueada informa pendência e oferece reparo no próprio menu. Não há
serviço fictício de localhost configurado como default.

## Evidência automatizada

- `tests/settings.test.mjs`: painel real dirigido por bytes (`\x1b[A`, `\x1b[B`,
  `\r`, `\x13`, `\x1b`) com o `KeybindingsManager` do pi-tui; teclado, Ctrl+S,
  Esc duplo, cancelamento, resultado atrasado, falha de disco com rascunho
  preservado, EN/PT-BR, overrides e 40/80/120 colunas com Unicode.
- `tests/extension.test.mjs`: loader oficial do Pi (devDependency 1.6.0) e
  `/voice` abrindo o painel pelo `index.ts`, com F8 bloqueado enquanto aberto.
- `npm run smoke:host`: o loader do Pi instalado em
  `~/.pi/agent/install/releases/1.6.0` (ou `PI_HOST_DIR`) abre `/voice` e
  renderiza em 40/80/120 sem gravar nada.

Avaliação humana no Windows Terminal (visual, hardware, redimensionamento real)
é evidência separada e continua pendente.
