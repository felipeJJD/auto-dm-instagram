import type { ServerResponse } from 'node:http';
import { escapeHtml as h, send } from './util.ts';

export type Brand = { brandName: string; igUsername: string };

// Página pública exigida pela Meta para publicar o app (URL da política e das instruções de exclusão de dados).
export function privacidadeHtml(b: Brand): string {
  const name = h(b.brandName);
  const user = b.igUsername ? h(b.igUsername) : '';
  const perfil = user ? `<a href="https://www.instagram.com/${user}/">@${user}</a>` : 'o nosso perfil';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidade — ${name}</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px; color: #1f2328; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 1.8rem; }
</style>
</head>
<body>
<h1>Política de Privacidade</h1>
<p>${name}</p>
<p>Este serviço responde automaticamente a comentários e mensagens enviados a ${perfil} no Instagram
e envia por mensagem direta o link que a pessoa pediu.</p>

<h2>Dados que coletamos</h2>
<ul>
  <li>Identificador e nome de usuário do Instagram de quem comenta ou envia mensagem.</li>
  <li>Texto do comentário ou da mensagem enviada ao perfil.</li>
  <li>Se a pessoa segue o perfil, informação fornecida pela própria API do Instagram.</li>
  <li>Se o link enviado foi clicado.</li>
</ul>

<h2>Para que usamos</h2>
<p>Somente para responder ao comentário, enviar a mensagem com o link pedido e contar quantas pessoas
receberam e abriram o link. Não vendemos, alugamos nem compartilhamos esses dados com terceiros, e não os
usamos para publicidade.</p>

<h2>Onde ficam e por quanto tempo</h2>
<p>Os dados ficam em um banco de dados privado, acessível só ao responsável pelo perfil, e são guardados
enquanto o serviço estiver em uso ou até a pessoa pedir a exclusão. As mensagens passam pela plataforma
da Meta e seguem também a política de privacidade do Instagram.</p>

<h2 id="exclusao">Como pedir a exclusão dos seus dados</h2>
<p>Envie uma mensagem direta para ${perfil} com o texto "apagar meus dados". Apagamos tudo o que está
associado à sua conta em até 30 dias e confirmamos pela mesma conversa.</p>

<h2>Contato</h2>
<p>Dúvidas sobre esta política: mensagem direta para ${perfil} no Instagram.</p>
</body>
</html>
`;
}

export function handlePrivacidade(res: ServerResponse, b: Brand): void {
  send(res, 200, privacidadeHtml(b), { 'Content-Type': 'text/html; charset=utf-8' });
}
