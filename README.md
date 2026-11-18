# Estante

Leitor de livros EPUB e MOBI (também AZW3) para o celular. Funciona como app (PWA): os livros ficam guardados só no aparelho, abrem sem internet, e dá para ajustar tamanho da letra, fundo (papel, branco, sépia, noite), fonte, espaçamento e margens.

**No ar:** https://oiyuriv.github.io/estante/

## Como usar
- **iPhone:** abrir no Safari → Compartilhar → *Adicionar à Tela de Início*. Para colocar livros, tocar em *Adicionar* → *Escolher arquivo* (app Arquivos).
- **Android:** abrir no Chrome → *Instalar app*. Depois é só compartilhar o arquivo do livro de qualquer app e escolher *Estante*.

## Arquivos
- `index.html`, `app.css`, `app.js` — o app
- `sw.js` — offline + recebe livros compartilhados (Android). Ao mudar o app, subir `VERSION`.
- `lib/foliate/` — leitor [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), copiado sem alterações
- `make-icons.ps1` — gera os ícones em `icons/`
