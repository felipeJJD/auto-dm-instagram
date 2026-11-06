# Pesquisa Meta — bot próprio de DM no Instagram

> **Atualização de 2026-11-06:** apps novos não mostram mais "API setup with Instagram login"; só o **login unificado** (portfólio empresarial, token de usuário do sistema em `graph.facebook.com`). O caminho que funcionou está em [INSTALAR.md](INSTALAR.md). O resto desta nota é a leitura da documentação feita antes disso.

Pesquisado em 2026-11-05, só em docs oficiais da Meta. **Nenhuma página mostra data de "última atualização"**; a data acima é a da leitura. Citações curtas, traduzidas quando preciso. Onde a doc é ambígua, está marcado **[AMBÍGUO]**.

Links base (todas as páginas estão em `developers.facebook.com`; as redirecionam entre `/docs/` e `/documentation/`):
- Overview: https://developers.facebook.com/docs/instagram-platform/overview
- Messaging API (Instagram Login): https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
- Private Replies: https://developers.facebook.com/docs/instagram-platform/private-replies
- Webhooks (setup/fields/examples): https://developers.facebook.com/documentation/instagram-platform/webhooks/setup

---

## 1. Qual API usar

**Use "Instagram API with Instagram Login".** Não exige Página do Facebook.

- A doc lista três setups: Instagram Login, Facebook Login e "Unified Login" (este último "recommended for new integrations"). [Overview](https://developers.facebook.com/docs/instagram-platform/overview)
- Instagram Login: "serves Instagram professional accounts without requiring a linked Facebook Page"; host `graph.instagram.com`; token de usuário Instagram. [Overview](https://developers.facebook.com/docs/instagram-platform/overview)
- Facebook Login: Página obrigatória; host `graph.facebook.com`; mensagens "Supported through Messenger Platform". [Overview](https://developers.facebook.com/docs/instagram-platform/overview)
- Webhooks `messages` e `messaging_postbacks`: suportados no Instagram Login; no Facebook Login a tabela marca "x" (vai pelo Messenger Platform). [Webhooks fields](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields)
- Todo o fluxo pedido (comentário, resposta pública, private reply, botão/postback, perfil com campos de follow) tem página documentada na variante Instagram Login (seções 2 e 3). Logo, ela basta.
- Não foi investigado o "Unified Login" além da menção na doc; o Instagram Login já cobre o fluxo, então não é necessário.

**Versão atual da Graph API: v27.0.** Banner do changelog: "a versão mais recente da Graph API é v27.0" (o quadro de versões na mesma página termina em v26.0, lançada em 29/07/2026; a v27.0 é a usada nos exemplos de endpoint). [Changelog](https://developers.facebook.com/docs/graph-api/changelog) **[leve inconsistência na própria página]**

---

## 2. Endpoints

Todos com host `graph.instagram.com` e prefixo de versão, ex.: `https://graph.instagram.com/v27.0/...`.

### 2.1 Resposta pública ao comentário
- `POST /<IG_COMMENT_ID>/replies` com `{"message":"..."}`. Resposta: `{"id":"..."}`.
- Permissões (Instagram Login): `instagram_business_basic`, `instagram_business_manage_comments`.
- Doc recomenda usar webhooks para evitar rate limit e agrupar respostas em batch.
- Fonte: https://developers.facebook.com/docs/instagram-platform/comment-moderation
- **[AMBÍGUO]** A referência do IG Comment lista "Create an IG Comment on an IG Comment" na edge `replies`, mas não cita Reels explicitamente. https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment — Reels são "media", então deve funcionar; testar.

### 2.2 Private Replies (DM a quem comentou)
- `POST /<APP_USERS_IG_ID>/messages` com `"recipient":{"comment_id":"<COMMENT_ID>"}` e `"message":{"text":"..."}`.
- Prazo: "within 7 days of the creation time of the comment" (exceto Live, só durante a transmissão).
- Limite: "Only one message can be sent to the commenter." (uma por comentário).
- Cobre comentários em post, reel, story, Live ou anúncio.
- Follow-ups: "can only be sent if the recipient responds, and must be sent within 24 hours of the response."
- Permissões (Instagram Login): `instagram_business_basic`, `instagram_business_manage_comments`. A doc cita `instagram_manage_messages` apenas na coluna Unified Login.
- Fonte: https://developers.facebook.com/docs/instagram-platform/private-replies
- **A primeira DM aceita botão?** A doc de Private Replies só mostra `message.text` no exemplo. Ela não diz se a private reply pode levar `attachment`/template com botões. **[AMBÍGUO — testar]**. Plano B, se só texto for aceito: private reply com texto + quick reply não é garantido; alternativa documentada é a pessoa responder, abrindo a janela de 24 h.

### 2.3 Mensagem com botões / quick replies / postback
- Envio geral: `POST /<IG_ID>/messages` (ou `/me/messages`) com `"recipient":{"id":"<IGSID>"}` e `"message":{...}`. [Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- **Generic template** (`message.attachment.type="template"`, `payload.template_type="generic"`): até 10 elements, título até 80 caracteres, **até 3 botões por element, só `postback` e `web_url`**. Exemplo de botão: `{"type":"postback","title":"Start Chatting","payload":"DEVELOPER_DEFINED_PAYLOAD"}`. Fonte: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/generic-template
- Não existe página própria "button template" na doc do Instagram; a doc do generic template remete às propriedades de botão do Messenger Platform (https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/buttons — não lida). **[AMBÍGUO: `button` template puro não confirmado para Instagram; usar `generic` com 1 element]**
- **Quick replies**: até 13, 20 caracteres de título, só `content_type: "text"`; resposta chega em `message.quick_reply.payload`. Fonte: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies
- Texto: UTF-8, máximo 1000 bytes. Fonte: Messaging API (link acima).
- Templates "not available on desktop" (generic-template).

### 2.4 Webhooks
- Campos usados: `comments`, `messages`, `messaging_postbacks`. Para os dois de mensagem no Instagram Login: `instagram_business_basic` + `instagram_business_manage_messages`; para `comments`: `instagram_business_basic` + `instagram_business_manage_comments`. [Fields](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields)
- **Postback (clique no botão)** chega em `messaging_postbacks`: `sender.id` (IGSID de quem clicou), `recipient.id`, `timestamp`, `postback.mid`, `postback.title`, `postback.payload`. [Examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
- `comments` (Business Login): `value.id` (comment id), `value.from.id` / `from.username`, `value.text`, `value.media.id`, `media_product_type`. A variante Unified/Facebook usa `comment_id`, `parent_id` e `changes[]` — os dois exemplos da doc têm formatos diferentes; trate o payload real defensivamente. [Examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
- `messages`: `messaging[].sender.id`, `recipient.id`, `timestamp`, `message.mid`, `message.text`. [Examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
- **[AMBÍGUO]** No exemplo de `messaging_postbacks`, o `entry.id` é rotulado como ID escopado do Instagram, mas a tabela da mesma página diz que é o ID da conta do usuário do app. Não dependa de `entry.id`; use `recipient.id`.
- Quem dispara: usuário Instagram que comenta em post/reel/story ou manda mensagem para a conta profissional. A conta dona da mídia precisa ser pública. [Overview](https://developers.facebook.com/docs/instagram-platform/overview), [Setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)
- Entrega: endpoint HTTPS responde `200 OK`; falhas são reenviadas "over the next 36 hours" — trate duplicatas (idempotência por `mid`/`comment id`). [Setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)

---

## 3. Verificar se a pessoa segue a conta

- **Existem.** User Profile API do Instagram Login: `GET https://graph.instagram.com/v27.0/<IGSID>?fields=is_user_follow_business,is_business_follow_user` (junto com outros campos de perfil).
  - `is_user_follow_business`: "Indicates whether the Instagram user follows your app user (`true`) or not (`false`)" → é o campo que responde "a pessoa me segue?".
  - `is_business_follow_user`: se a conta do app segue a pessoa.
- Permissões: `instagram_business_basic` + `instagram_business_manage_messages`.
- Acesso: Standard Access vale para contas que você possui/administra e adicionou ao app; Advanced só para contas de terceiros.
- **Consentimento (crítico para o fluxo):** "User consent is required to access an Instagram user's profile." O consentimento só é definido quando o usuário **manda mensagem** ao app user ou toca num ice breaker / menu persistente. **Um comentário sozinho não basta** e a chamada falha com "User consent is required to access user profile."
  - Implicação para o fluxo: a verificação do passo 4 só funciona depois que a pessoa já interagiu por DM. **[AMBÍGUO]** A doc não diz se o clique num botão postback de uma private reply conta como consentimento. A lista de gatilhos de consentimento cita "messages the business", ice breaker e persistent menu — o clique em botão não está listado nem excluído. Testar; plano B: pedir que a pessoa responda por texto ou usar ice breaker.
- Bloqueio: se a pessoa bloqueou o negócio, não dá para ver o perfil.
- Fonte: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
- (A página equivalente do Facebook Login — https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile — confirma os mesmos campos e o mesmo requisito de consentimento, mas via Página/`graph.facebook.com`.)

---

## 4. Permissões, níveis de acesso e modos

**Permissões (Instagram Login)**: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` (`instagram_business_content_publish` não é necessária). Fonte: [Overview](https://developers.facebook.com/docs/instagram-platform/overview), [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login).

**Standard vs Advanced** ([Overview](https://developers.facebook.com/docs/instagram-platform/overview)):
- Standard: "the default access level for all apps"; "intended for apps that will only be used by people who have roles on them, during app development, or for testing your app."
- Advanced: "requires App Review and Business Verification"; necessário para servir contas que você não possui/administra.
- Frase decisiva para seu caso: "If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs." (com o aviso de que "some features might not work properly until your app has been granted Advanced Access").

**Modo Live para receber webhooks:** "Your app must be published or **Live** to receive notifications for app users." [Setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)

**Testers/roles:** "Your app testers must have a role on your app, grant your app access to all the required permissions, and have a role on the Instagram professional account that owns the app." [Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api)

**Conflito/ambiguidade (o ponto mais importante):**
- A página de Setup de webhooks diz: "Advanced Access is required for `comments` and `live_comments` notifications", e a tabela de requisitos marca Instagram Login como "Advanced Access" e Business Verification como "Required for production access". [Setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)
- A página de Overview diz que Standard basta para a própria conta.
- A página de criação do app diz: "Instagram requires successful completion of the App Review process before your app can access live data." [Criar app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)
- **A doc não diz de forma explícita** o que acontece com um app em modo desenvolvimento apenas com Standard Access: se os webhooks chegam só de usuários com papel no app, ou se chegam de qualquer um. O texto "intended for apps ... used by people who have roles on them" sugere limitação a usuários com papel, mas isso é inferência, não frase da doc. **Conclusão honesta: não confirmado. É provável que, para receber comentários/DMs de qualquer pessoa, seja necessário app em Live + Advanced Access para `comments` (logo App Review + Business Verification). Validar em teste real com uma conta sem papel no app.**
- Exceção para app privado: a doc cita que "approval may be requested only for `instagram_basic` and `instagram_manage_comments`" (no contexto Facebook Login, app privado) — não se aplica diretamente ao Instagram Login. [Overview](https://developers.facebook.com/docs/instagram-platform/overview)

---

## 5. Regras operacionais

**Janela de mensagens**
- "For most user actions, it lasts 24 hours." (Click-to-Direct pode chegar a 7 dias.) Human Agent tag: janela separada de 7 dias; adicionada automaticamente ao pedir `instagram_business_manage_messages`. [Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api), [Criar app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app)
- A private reply é a exceção (7 dias desde o comentário, 1 mensagem); depois disso, só se a pessoa responder, e então 24 h. [Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies)
- Consequência: o "Já segui" (clique) abre nova janela de 24 h a cada clique, mas só se o postback contar como interação do usuário — a doc fala em "user action" sem enumerar cliques em botão. **[AMBÍGUO]**

**Rate limits** ([Overview — Rate Limiting](https://developers.facebook.com/docs/instagram-platform/overview))
- Send API: 100 chamadas/s por conta profissional (texto, links, reações, stickers); 10/s (áudio/vídeo).
- Private Replies (posts e reels): **750 chamadas/hora por conta profissional**. Live: 100/s.
- Conversations API: 2 chamadas/s por conta.
- Demais endpoints: Business Use Case; fora de mensagens, "Calls within 24 hours = 4800 * Number of Impressions".
- (O número "200 chamadas/hora" não aparece nas páginas lidas.)

**Token** ([Get started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started), [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login))
- Token do fluxo Business Login: curto, 1 h. Token gerado no painel do app: longo, 60 dias.
- Trocar curto por longo: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...` (`expires_in` ≈ 5183944 s ≈ 60 dias).
- Renovar: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`. Condições: token com pelo menos 24 h, ainda válido, usuário concedeu `instagram_business_basic`. "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed." → agendar renovação (ex.: semanal).
- Código de autorização: validade 1 h, uso único; troca em `POST https://api.instagram.com/oauth/access_token`.

**Validação do webhook** ([Setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup))
- GET de verificação: conferir `hub.verify_token` com a string configurada e responder com o valor de `hub.challenge`.
- POST de eventos: "We sign all Event Notification payloads with a **SHA256** signature and include the signature in the request's `X-Hub-Signature-256` header, preceded with `sha256=`." Calcular HMAC-SHA256 do corpo **bruto** com o App Secret e comparar em tempo constante. A doc diz "You don't have to validate the payload, but you should."
- Endpoint HTTPS, responder 200.

---

## 6. Passo a passo (resumo) — painel da Meta

Fonte: https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app

1. Conta Instagram **profissional** (Business ou Creator).
2. Em developers.facebook.com, criar app: caso de uso "Other", tipo **Business** (obrigatório para adicionar o produto Instagram).
3. Nome do app + e-mail de contato.
4. Adicionar o produto **Instagram** → "API setup with Instagram login".
5. Adicionar a conta Instagram como tester (App Roles / Instagram > API Setup) e aceitar o convite na conta.
6. Gerar token da conta no painel (60 dias) com as 3 permissões `instagram_business_*`, ou usar Business Login.
7. Configurar webhooks: URL de callback HTTPS + Verify Token; assinar os campos `comments`, `messages`, `messaging_postbacks`.
8. Configurar Business Login (redirect/OAuth URIs, URLs de desautorização e exclusão de dados) se for usar OAuth.
9. Para sair do modo desenvolvimento: concluir App Review e, conforme a seção 4, Business Verification; publicar o app (Live).

---

## Resumo das ambiguidades a testar
1. App em Standard + modo desenvolvimento recebe webhook de quem não tem papel no app? (doc não afirma; setup exige Advanced para `comments`).
2. Private reply aceita template com botões, ou só texto?
3. Clique em postback conta como consentimento para `is_user_follow_business` e reabre janela de 24 h?
4. Reply público (`/replies`) funciona em comentários de Reels (doc genérica).
5. `button` template puro no Instagram (a doc só documenta `generic`).
6. Documentação sem data de atualização em todas as páginas; v27.0 vs. tabela que termina em v26.0.
