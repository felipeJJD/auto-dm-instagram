# Instalar o Auto DM, do zero

Guia para ligar o Auto DM à sua conta do Instagram: alguém comenta no seu Reels, recebe uma resposta pública e
uma DM com botão; ao clicar, o sistema confere se a pessoa segue você e manda o link.

Este é o caminho que funcionou em 6 de novembro de 2026. A Meta muda nomes de botões com frequência: se algum
não bater, procure o mais parecido na mesma tela. Leva cerca de 40 minutos.

## Antes de começar

- Uma **conta profissional** do Instagram (Empresa ou Criador de conteúdo), **pública**.
- Um **portfólio empresarial** da Meta (business.facebook.com) com essa conta do Instagram. Quem já anuncia
  ou usa o Meta Business Suite normalmente já tem.
- Sua conta do Facebook como **administradora** desse portfólio. É ela que vai criar o app.
- Uma conta na [Railway](https://railway.com) (ou outro lugar que rode Node 24 com Postgres).
- Uma **segunda conta** do Instagram para testar, porque o sistema ignora comentários da própria conta.

Não é preciso App Review, verificação da empresa nem Página do Facebook.

## 1. Subir o serviço na Railway

1. Faça um fork deste repositório no seu GitHub.
2. Na Railway: **New Project → Deploy from GitHub repo** e escolha o fork.
3. No mesmo projeto: **+ New → Database → PostgreSQL**.
4. No serviço do Auto DM, aba **Settings → Networking → Generate Domain**. Anote o endereço
   (`https://algo.up.railway.app`): é o seu `PUBLIC_BASE_URL`.
5. Aba **Variables** do serviço. Crie estas variáveis (as da Meta vêm nos passos seguintes):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao banco do passo 3) |
| `PUBLIC_BASE_URL` | o endereço do passo 4, sem barra no final |
| `ADMIN_PASSWORD` | a senha que você vai usar para entrar no painel |
| `SESSION_SECRET` | uma frase longa e aleatória (assina o cookie do painel) |
| `META_VERIFY_TOKEN` | outra frase longa e aleatória, inventada por você |
| `BRAND_NAME` | o nome que aparece no painel e na página de privacidade |
| `IG_USERNAME` | o @ da conta, sem o arroba |
| `SEND_ENABLED` | `false` por enquanto |

Gere frases aleatórias com `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.

Depois do deploy, abra `PUBLIC_BASE_URL/painel`, entre com a senha e vá em **Configurar**. Essa tela mostra
o que falta e os valores para colar na Meta. Deixe-a aberta.

## 2. Criar o app na Meta

1. Em [developers.facebook.com](https://developers.facebook.com/apps), clique em **Criar um app**.
2. Preencha o nome do app e o e-mail de contato.
3. Em **Casos de uso**, escolha **Gerenciar mensagens e conteúdo no Instagram**. Se não aparecer, mude o
   filtro para **Tudo**.
4. Em **Empresa**, pode seguir sem escolher. Avance até **Criar aplicativo**; a Meta pede sua senha do Facebook.

## 3. Ligar o portfólio (login unificado)

Apps novos não oferecem mais "API setup with Instagram login". O caminho é o login unificado.

1. No painel do app: **Personalizar o caso de uso** → aba **API setup with Unified login**.
2. Clique em **Portfólio empresarial**, escolha o seu em **Select a business** e clique em **Connect**.
   Depois clique em **Concluir**.
3. Em **1. Configure seu app**, clique em **Criar nova configuração**. Mantenha o modelo como está: token de
   usuário do sistema que não expira, com as permissões `instagram_basic`, `instagram_manage_comments` e
   `instagram_manage_messages`, entre outras. Clique em **Criar do modelo**.

## 4. Pôr a conta como testadora

1. No menu do app: **Funções → Adicionar pessoas → Testador do Instagram**. Digite o @ da conta e clique em
   **Adicionar**. Ela fica "Pendente".
2. Entre no Instagram com essa conta e abra
   [instagram.com/accounts/manage_access](https://www.instagram.com/accounts/manage_access/), aba
   **Convites de testador**. Aceite o convite.

## 5. Gerar o token e pegar o ID da conta

1. Volte ao caso de uso, seção **2. Gerar tokens de acesso**. A linha da conta mostra o @, um **número de 17
   dígitos** e o botão **Gerar token**. Se a conta não estiver na lista, use **Adicionar conta**.
2. O número de 17 dígitos é o `IG_USER_ID`. Coloque-o na Railway.
3. Clique em **Gerar token**, marque **Estou ciente** e clique em **Copiar**. O token aparece uma vez só, começa
   com `EA` e tem umas 250 letras. Coloque-o em `META_ACCESS_TOKEN` na Railway.

Antes de salvar, confira que você colou o token. Se o valor começar com `http`, é um link e não o token.

## 6. Chave secreta do app

Em **Configurações do app → Básico**, clique em **Mostrar** ao lado de **Chave Secreta do Aplicativo** (a Meta
pede a senha). Coloque o valor em `META_APP_SECRET` na Railway. Ela confere a assinatura de cada webhook.

Espere a Railway refazer o deploy e recarregue **Configurar** no painel. Agora deve aparecer **Conta
conectada: @sua_conta**.

## 7. Webhook

1. No caso de uso, seção **3. Configurar webhooks**:
   - **URL de callback**: copie de **Configurar → Cole na Meta** (é `PUBLIC_BASE_URL/webhook`).
   - **Verificar token**: o mesmo `META_VERIFY_TOKEN` (em **Configurar**, clique em **Mostrar**).
   - Clique em **Verificar e salvar**.
2. Em **Campos do webhook**, ative `comments`, `messages` e `messaging_postbacks`.
3. Inscreva a conta: em **Configurar**, clique em **Inscrever a conta** na linha "Webhook inscrito na conta".
   A linha fica verde.

O botão **Teste** ao lado de um campo manda um evento de exemplo. Se ele chegar, a linha "Primeiro webhook
recebido" fica verde.

## 8. Privacidade, categoria e publicar

A Meta exige uma política de privacidade para publicar. O Auto DM já serve uma em `/privacidade`.

1. Em **Configurações do app → Básico**, preencha:
   - **URL da Política de Privacidade**: `PUBLIC_BASE_URL/privacidade`
   - **URL de instruções de exclusão de dados**: `PUBLIC_BASE_URL/privacidade#exclusao`
   - **Categoria**: **Negócio e Páginas**
   - Clique em **Save changes**.
2. No menu, clique em **Publicar**. Quando aparecer "Todas as configurações necessárias do app foram
   concluídas", clique em **Publicar**. O painel do app passa a mostrar **Publicado**.

Sem publicar, o app só atende contas com função nele (como a testadora). Publicado, ele atende qualquer
pessoa que comentar, já com o acesso padrão, sem App Review.

## 9. Primeira automação e teste

1. No painel, abra **Posts**, escolha um Reels e clique em **Criar automação**. Preencha as mensagens e o link
   e clique em **Salvar**. Depois clique em **Ativar**.
2. Com `SEND_ENABLED=false`, nada sai de verdade: comente com a segunda conta e veja em **Status** e em
   **Contatos** se o comentário chegou.
3. Mude `SEND_ENABLED` para `true` na Railway e comente de novo com a segunda conta. Você deve ver a resposta
   pública no comentário e a DM com o botão.

Prefere importar várias automações de uma vez? Veja `data/exemplo-automacoes.json` e rode
`npm run import -- seu-arquivo.json` com o `DATABASE_URL` de produção.

## Problemas comuns

| Sintoma | Causa provável e o que fazer |
|---|---|
| Não existe "API setup with Instagram login" | Normal em apps novos. Use **API setup with Unified login** (passo 3). |
| O portfólio não aparece e **Connect** fica cinza | Sua conta do Facebook não está no portfólio. No Business Suite, convide-a como administradora, aceite o e-mail e tente de novo. |
| "Selecione uma configuração na Etapa 1" ao gerar o token | Falta o passo 3.3 (**Criar nova configuração**). |
| A conta não aparece em **Gerar tokens de acesso** | O convite de testadora não foi aceito (passo 4.2), ou a conta não é profissional ou está privada. |
| **Conta conectada** mostra "Cannot parse access token" | O valor em `META_ACCESS_TOKEN` não é o token, ou `META_GRAPH_BASE` aponta para `graph.instagram.com`. Apague `META_GRAPH_BASE` (o padrão `graph.facebook.com` é o certo para o login unificado). |
| **Configurar** diz que o token é de outra conta | O `IG_USER_ID` não é o número da linha da conta no passo 5. |
| **Verificar e salvar** falha | `PUBLIC_BASE_URL` errado, serviço fora do ar, ou o verify token colado não é igual ao `META_VERIFY_TOKEN`. |
| Comentários de outras pessoas não chegam | App não publicado (passo 8), ou a conta não foi inscrita (passo 7.3). |
| Chega o comentário, mas não sai DM | `SEND_ENABLED` não está `true`, ou a automação está inativa. Veja o erro em **Status**. |
| Seu próprio comentário não dispara nada | É de propósito: o sistema ignora a própria conta. Teste com outra. |

## Segurança

- Nunca coloque token, chave secreta ou senha no repositório nem em print. Eles ficam só nas variáveis da
  Railway.
- `META_APP_SECRET` também cifra o token guardado no banco. Se trocar a chave, gere e cole um token novo.
- Se o token vazar, gere outro (passo 5) e troque `META_ACCESS_TOKEN`. Em **Configurações → Básico** também
  dá para redefinir a chave secreta.
