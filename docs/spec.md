# Auto DM — especificação

Automação própria de "comenta que eu te mando na DM" para uma conta profissional do Instagram. Regras da API
da Meta pesquisadas em `docs/pesquisa-meta.md`; configuração do app em `docs/INSTALAR.md`.

## Fluxo (pedido do usuário)

Comentário num post/Reels com automação ativa → resposta pública ao comentário (1 texto sorteado entre N)
→ DM privada (private reply) com texto + botão → clique → checa se a pessoa segue a conta
(`is_user_follow_business`) → não segue: DM de pedir para seguir + botão (loop) → segue: DM com
texto + botão de link. O link passa por `/r/<runId>-<token>` (token aleatório do run, 8 bytes hex) para contar cliques; sem token ou com token errado → 404.

## Stack

Node 24 (ESM, TypeScript por *type stripping* nativo: só sintaxe apagável, imports com `.ts`), servidor
`node:http` sem framework, `pg` em produção, `@electric-sql/pglite` nos testes, `node --test`.
Dependências permitidas: `pg`; dev: `@electric-sql/pglite`, `typescript`, `@types/node`, `@types/pg`.
Deploy: Railway, serviço novo com Postgres próprio, `npm start`.

## Variáveis de ambiente

| Nome | Uso | Padrão |
|---|---|---|
| `DATABASE_URL` | Postgres | obrigatório em produção |
| `PORT` | porta HTTP | `3000` |
| `PUBLIC_BASE_URL` | base dos links `/r/<runId>-<token>` | `http://localhost:3000` |
| `META_APP_SECRET` | HMAC do webhook e chave de cifra do token | obrigatório para `/webhook` |
| `META_VERIFY_TOKEN` | verificação `GET /webhook` | obrigatório para `/webhook` |
| `META_ACCESS_TOKEN` | token de acesso da conta (login unificado: token de usuário do sistema, `EA…`) | vazio = sem envio |
| `IG_USER_ID` | ID da conta profissional do Instagram | obrigatório para enviar |
| `IG_USERNAME` | @ da conta, só para o painel e a página de privacidade | vazio |
| `BRAND_NAME` | nome mostrado no painel e na página de privacidade | `Auto DM` |
| `META_GRAPH_BASE` | base da Graph API; com `graph.facebook.com` (login unificado) não há renovação de token | `https://graph.facebook.com/v27.0` |
| `SEND_ENABLED` | `true` envia de verdade; senão a saída fica `dry_run` | `false` |
| `BUTTON_STYLE` | `generic` \| `button` \| `quick_reply` (formato da DM com botão) | `generic` |
| `ADMIN_PASSWORD` | senha do painel | obrigatório para `/painel` |
| `SESSION_SECRET` | assinatura do cookie do painel | obrigatório para `/painel` |

## Regras de negócio

1. Ignorar comentário cujo `from.id` = `IG_USER_ID` (as próprias respostas; evita laço).
2. Automação casa pelo `media.id` do comentário; só `active = true`. `trigger_mode = 'any'` dispara com
   qualquer texto; `'keywords'` exige uma palavra-chave como palavra inteira, sem diferenciar maiúsculas
   nem acentos. `include_replies = false` ignora comentário com `parent_id`.
3. Um `run` por (automação, pessoa): se já existe, o novo comentário não gera resposta nem DM. Exceção: run
   `undelivered` (a `private_reply` terminou `failed` ou `dry_run`) é reaproveitado por um novo comentário
   (novo `comment_id`, estado `welcome_sent`) e a resposta e a DM são reenviadas.
4. Idempotência: cada item do webhook tem id = sha256 do JSON do item; repetido é descartado. O item é gravado
   em `webhook_events` antes do 200 (falha de banco → 500, a Meta reenvia) e processado depois, isolado dos
   demais. Erro deixa `processed_at` nulo, grava `error` e soma `attempts`; a varredura `reprocessPending` (a
   cada 60 s) reprocessa eventos pendentes há mais de 30 s com menos de 5 tentativas.
5. Postback/quick reply com payload `FC:<runId>` ou texto livre da pessoa com run em `welcome_sent` ou
   `asked_follow` há menos de 7 dias → checagem de seguir. Segue → DM do link, estado `link_sent`.
   Não segue ou erro na checagem (ex.: consentimento) → DM de pedir para seguir, estado `asked_follow`.
   Clique de novo depois de `link_sent` → reenvia o link.
6. Mensagens `is_echo` e de outros remetentes sem run são ignoradas.
7. Saída sempre pela fila `outbox`, com novas tentativas: HTTP 429, 5xx, erro de rede, ou códigos Graph
   4, 17, 32, 613 → espera `min(5 s × 2^tentativas, 15 min)`, até 8 tentativas, depois `failed`.
   Outros erros → `failed` na hora. Private replies limitadas a 700 por hora (janela móvel).
8. Token: guardado cifrado (AES-256-GCM, chave HKDF do `META_APP_SECRET`) na tabela `settings`; renovado
   quando tiver mais de 7 dias (`GET <host>/refresh_access_token?grant_type=ig_refresh_token`). Guarda o
   sha256 do `META_ACCESS_TOKEN` que originou o token do banco: se o env mudar, o env vence e o substitui. Se a
   decifragem falhar, usa o env e loga (sem o valor).

## Formatos da Meta (Instagram Login)

- Resposta pública: `POST /{comment_id}/replies` `{message}`.
- Private reply: `POST /{IG_USER_ID}/messages` `{recipient:{comment_id}, message}`.
- DM: `POST /{IG_USER_ID}/messages` `{recipient:{id: igsid}, message}`.
- Seguir: `GET /{igsid}?fields=username,is_user_follow_business`.
- Posts: `GET /{IG_USER_ID}/media?fields=id,caption,permalink,media_product_type,timestamp&limit=25`.
- Token vai no header `Authorization: Bearer <token>`.
- DM com botão, por `BUTTON_STYLE`:
  - `generic`: `{attachment:{type:'template',payload:{template_type:'generic',elements:[{title,subtitle?,buttons}]}}}`;
    texto ≤ 80 vira `title`; até 160 é dividido na última palavra antes de 80 em `title`/`subtitle`;
    acima de 160 é erro de validação.
  - `button`: `{attachment:{type:'template',payload:{template_type:'button',text,buttons}}}` (texto ≤ 640).
  - `quick_reply`: `{text, quick_replies:[{content_type:'text',title,payload}]}` (só para postback).
  - Botão de link é sempre `web_url`; em `quick_reply` o link vai como `generic`.
- Webhook: `object:'instagram'`; comentários em `entry[].changes[]` (`field:'comments'`); DMs e postbacks
  em `entry[].messaging[]`. Assinatura `X-Hub-Signature-256: sha256=<hex>` do corpo bruto.

## Painel (`/painel`, HTML do servidor, português)

Configurar (`/painel/configurar`): checklist das variáveis, conta do token (`GET /{IG_USER_ID}?fields=id,username`),
campos inscritos (`GET /{IG_USER_ID}/subscribed_apps`) com botão que inscreve a conta
(`POST /{IG_USER_ID}/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks`), primeiro
webhook, envio ligado e os valores para colar na Meta (URL de callback, verify token, URLs de privacidade).
Nunca mostra `META_APP_SECRET` nem o token. A lista avisa enquanto a configuração mínima está incompleta.

Login por senha (cookie assinado, HttpOnly, SameSite=Strict, Secure fora de localhost, 7 dias; 5
tentativas/min por IP). Lista de automações com post, estado e números (runs, links enviados, cliques,
CTR = runs com clique ÷ runs com link). Criar/editar: nome, post (escolha pela lista da Graph ou id
manual), modo, palavras, respostas públicas (uma por linha), textos e botões, link `https://`. Ativar e
desativar. Contatos (últimos 200). Status: token configurado, envio ligado, último webhook, fila
pendente/falha, eventos do webhook com erro. POST exige Origin igual ao Host. Toda saída escapada. Título de botão acima de 20
caracteres mostra aviso (não bloqueia; o limite real no Instagram é hipótese a testar).

## Política de privacidade (`/privacidade`)

Página pública, exigida pela Meta para publicar o app, com `BRAND_NAME` e `IG_USERNAME`; `#exclusao` traz as
instruções de exclusão de dados.

## Importação

`npm run import -- <arquivo.json>` cria as automações de um JSON (`defaults` + `automations`, veja
`data/exemplo-automacoes.json`) como inativas, pulando `media_id` já existente.

## Fora desta versão

Coleta de e-mail, follow-up com atraso, resposta padrão, IA, caixa de entrada, envio em massa.
