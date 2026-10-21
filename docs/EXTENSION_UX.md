# Contrato básico de UX de extensões Pi

Padrão canônico no harness: `workspace/docs/pi-extension-standard.md`.
Template copiável: `workspace/templates/pi-extension/settings-panel.ts`.
Este documento resume o contrato aplicado por esta extensão 0.3.

- `/voice` abre o menu com os valores atuais. `/voice settings` é um alias.
- ↑↓ navega; Enter edita/abre; Ctrl+S valida e salva sem fechar o painel.
- Edições são rascunho. Esc em campo volta sem aplicar; no painel avisa antes
  de descartar o rascunho. Não há autosave silencioso.
- Falta de microfone, FFmpeg ou rede não impede abrir o painel. Testes são ações
  separadas e mostram resultado ou recuperação. Nenhuma captura começa no menu.
- Modelo é uma lista fechada: tiny, base ou small, com tamanho aproximado.
- Ctrl+S prepara o modelo antes de salvar; falha/cancelamento preserva a escolha salva.
- Sem campos de provedor, URL, credencial ou consentimento externo.
- Tema do host, colunas Unicode e rolagem. Editor e footer global preservados.
- Toda ação possui abort, timeout e cleanup. Fechar/reload aguarda o trabalho
  pendente; callbacks atrasados não escrevem na UI fechada.

`src/ui/settings-panel.ts` implementa a casca genérica, sem dependência do core
de voz. `src/ui/settings.ts` fornece campos, validação, ações e persistência.
Outras extensões podem copiar o componente; não devem importar este pacote
como dependência apenas para construir menus.

A instalação padrão inclui o runtime Whisper local e baixa tiny para o cache do usuário.
`PI_VOICE_MODEL` escolhe base/small na instalação; pesos fora do Git/pacote. Instalação
offline/bloqueada informa pendência e oferece reparo no próprio menu. Não há
serviço fictício de localhost configurado como default.

Evidência automatizada: `tests/settings.test.mjs`, `tests/panel.test.mjs`,
`tests/config.test.mjs`, `tests/controller.test.mjs` e `tests/local.test.mjs`.
A adoção deste contrato nas extensões irmãs não foi executada em lote.
