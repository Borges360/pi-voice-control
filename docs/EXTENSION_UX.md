# Contrato básico de UX de extensões Pi

Padrão canônico no harness: `workspace/docs/pi-extension-standard.md`.
Template copiável: `workspace/templates/pi-extension/settings-panel.ts`.
Este documento resume o contrato aplicado por esta extensão 0.2.

- `/voice` abre o menu com os valores atuais. `/voice settings` é um alias.
- ↑↓ navega; Enter edita/abre; Ctrl+S valida e salva sem fechar o painel.
- Edições são rascunho. Esc em campo volta sem aplicar; no painel avisa antes
  de descartar o rascunho. Não há autosave silencioso.
- Falta de microfone, FFmpeg ou rede não impede abrir o painel. Testes são ações
  separadas e mostram resultado ou recuperação. Nenhuma captura começa no menu.
- Provedor externo só envia dados depois da escolha e consentimento específico.
- Tema do host, colunas Unicode e rolagem. Editor e footer global preservados.
- Toda ação possui abort, timeout e cleanup. Fechar/reload aguarda o trabalho
  pendente; callbacks atrasados não escrevem na UI fechada.

`src/ui/settings-panel.ts` implementa a casca genérica, sem dependência do core
de voz. `src/ui/settings.ts` fornece campos, validação, ações e persistência.
Outras extensões podem copiar o componente; não devem importar este pacote
como dependência apenas para construir menus.

A instalação padrão inclui o motor Whisper local e prepara o modelo. Instalação
offline/bloqueada informa pendência e oferece reparo no próprio menu. Não há
serviço fictício de localhost configurado como default.

Evidência automatizada: `tests/settings.test.mjs`, `tests/panel.test.mjs`,
`tests/provider.test.mjs`, `tests/controller.test.mjs` e `tests/local.test.mjs`.
A adoção deste contrato nas extensões irmãs não foi executada em lote.
