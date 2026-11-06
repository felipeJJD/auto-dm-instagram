# Auto DM para Instagram

A pessoa comenta no seu Reels e recebe o link na DM. É a mesma automação das ferramentas pagas, só que
rodando num servidor seu: sem mensalidade, sem limite de contatos, e os dados ficam com você.

![Painel com as automações e o funil de cada Reels](docs/img/painel-automacoes.jpg)

## O que faz

1. Alguém comenta no post (qualquer comentário ou só com as palavras-chave que você escolher).
2. O sistema responde em público, sorteando uma entre as frases que você cadastrou.
3. Manda uma DM com um botão.
4. A pessoa clica e o sistema confere se ela segue você:
   - se não segue, pede para seguir e mostra o botão de novo;
   - se segue, manda o link.
5. O link passa pelo servidor, que conta os cliques. O painel mostra, para cada Reels, quantos comentaram,
   quantos pegaram o link e quantos clicaram.

Usa só a API oficial da Meta. Não precisa de App Review, verificação da empresa nem Página do Facebook.

## Painel

| Editar uma automação, com a prévia da DM | Configurar: checklist e valores para colar na Meta |
|---|---|
| ![Formulário de automação com prévia da conversa](docs/img/painel-editar.jpg) | ![Página Configurar com o checklist da Meta](docs/img/painel-configurar.jpg) |

- **Automações**: liga e desliga cada uma e mostra o funil (comentaram, pegaram o link, clicaram).
- **Posts**: lista os últimos posts da conta. Um clique cria a automação daquele Reels.
- **Contatos**: quem interagiu e se segue a conta.
- **Status**: token, envio, último webhook e fila de envio com erros.
- **Configurar**: o que falta para ligar à Meta, a conta conectada, um botão para inscrever o webhook e os
  valores para colar no app.

## Instalar

O passo a passo completo, da conta na Railway até o app publicado na Meta, está em
**[docs/INSTALAR.md](docs/INSTALAR.md)**. Leva cerca de 40 minutos.

Resumo: suba o serviço com um Postgres, crie um app na Meta com o caso de uso "Gerenciar mensagens e
conteúdo no Instagram" (login unificado), gere o token, configure o webhook, publique o app e teste com uma
segunda conta. A página **Configurar** do painel acompanha cada passo.

## Variáveis de ambiente

| Nome | Uso | Padrão |
|---|---|---|
| `DATABASE_URL` | Postgres | obrigatório |
| `PORT` | porta HTTP | `3000` |
| `PUBLIC_BASE_URL` | endereço público do serviço (webhook, links e privacidade) | `http://localhost:3000` |
| `ADMIN_PASSWORD` | senha do painel | obrigatório para `/painel` |
| `SESSION_SECRET` | assina o cookie do painel | obrigatório para `/painel` |
| `META_APP_SECRET` | confere a assinatura do webhook e cifra o token guardado | obrigatório para `/webhook` |
| `META_VERIFY_TOKEN` | frase que a Meta usa para verificar o webhook | obrigatório para `/webhook` |
| `META_ACCESS_TOKEN` | token da conta (login unificado: começa com `EA`) | vazio = não envia |
| `IG_USER_ID` | ID da conta profissional do Instagram | obrigatório para enviar |
| `IG_USERNAME` | @ da conta (só para exibir) | vazio |
| `BRAND_NAME` | nome no painel e na página de privacidade | `Auto DM` |
| `META_GRAPH_BASE` | base da Graph API | `https://graph.facebook.com/v27.0` |
| `SEND_ENABLED` | `true` envia de verdade; senão tudo fica em modo de teste (`dry_run`) | `false` |
| `BUTTON_STYLE` | formato da DM com botão: `generic`, `button` ou `quick_reply` | `generic` |

Nunca coloque valores reais no repositório. Se trocar `META_APP_SECRET`, o token guardado no banco deixa de
abrir: o serviço avisa no log e volta a usar `META_ACCESS_TOKEN`.

## Rodar local

Requer Node 24 e um Postgres.

```sh
npm install
export DATABASE_URL=postgres://usuario:senha@localhost:5432/autodm
export ADMIN_PASSWORD=... SESSION_SECRET=... META_APP_SECRET=... META_VERIFY_TOKEN=...
npm start                                       # migra o banco e abre http://localhost:3000/painel
npm run import -- data/exemplo-automacoes.json  # opcional: automações de exemplo, inativas
npm test && npm run typecheck
```

Os testes usam PGlite (Postgres em memória) e não acessam a rede. Com `SEND_ENABLED` diferente de `true`, tudo
que sairia para a Meta fica na fila como `dry_run`, bom para ensaiar.

## Como funciona por dentro

Node 24 com TypeScript nativo, `node:http` sem framework e `pg`. A única dependência de produção é o `pg`.

- `src/engine.ts`: regras do fluxo (casar o comentário com a automação, um atendimento por pessoa, checar se
  segue).
- `src/outbox.ts`: toda saída passa por uma fila com novas tentativas e limite de 700 private replies por hora.
- `src/http/`: webhook com assinatura HMAC, redirecionamento que conta cliques, página de privacidade e painel.
- `db/schema.sql`: tabelas.

A especificação completa está em [docs/spec.md](docs/spec.md). As regras da API pesquisadas na documentação
da Meta estão em [docs/pesquisa-meta.md](docs/pesquisa-meta.md).

## Limites conhecidos

- A primeira DM é uma resposta privada ao comentário: a Meta aceita uma só por comentário, em até 7 dias.
- Para saber se a pessoa segue a conta, a Meta exige que ela tenha interagido por DM. A documentação não diz
  se o clique no botão da resposta privada conta. Se não contar, a pessoa recebe o pedido para seguir e,
  ao responder ou clicar de novo, o sistema confere outra vez.
- O título do botão é curto no Instagram. O painel avisa acima de 20 caracteres.

## Licença

[MIT](LICENSE).
