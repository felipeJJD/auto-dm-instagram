import type { Automation, ContactRow, Stats } from '../../store.ts';
import type { MediaItem } from '../../meta.ts';
import { WEBHOOK_FIELDS } from '../../meta.ts';
import type { Brand } from '../privacidade.ts';
import { escapeHtml as h } from '../util.ts';

export const BUTTON_TITLE_LIMIT = 20;

/** Guia de instalação no repositório público. */
export const GUIDE_URL = 'https://github.com/felipeJJD/auto-dm-instagram/blob/main/docs/INSTALAR.md';

// Marca e @ vêm da configuração; as páginas deixam marcadores e withBrand troca na saída. Texto de usuário passa
// por h() e nunca forma "<!--", então os marcadores não podem ser injetados.
const BRAND = '<!--brand-->';
const HANDLE = '<!--handle-->';

export function withBrand(html: string, b: Brand): string {
  return html.replaceAll(BRAND, h(b.brandName)).replaceAll(HANDLE, b.igUsername ? `@${h(b.igUsername)}` : '');
}

export type FormValues = {
  id?: string;
  name: string;
  media_id: string;
  media_permalink: string;
  trigger_mode: string;
  keywords: string;
  include_replies: boolean;
  public_replies: string;
  welcome_text: string;
  welcome_button: string;
  ask_follow_text: string;
  ask_follow_button: string;
  link_text: string;
  link_button: string;
  link_url: string;
};

/** O que o painel mostra sobre a saúde do envio (lista e status). */
export type Health = { sendEnabled: boolean; lastWebhook: Date | null; failed: number; setupPending?: boolean };

// Estilo "accent-ladder" (tasteskill): uma cor só, um azul de caneta, nas marcas pequenas e nos
// dados; os tons claros dela nas áreas. Sem sombra, sem gradiente; superfícies separadas por uma borda de 1px.
const CSS = `
:root{color-scheme:light;
--ground:#f7f9fc;--surface:#fff;--raised:#f1f4f9;--border:#e3e8ef;--rule:#edf0f5;--control:#cfd6e0;
--text:#0f1729;--muted:#5b6474;
--accent:#1f4fd1;--accent-soft:#eef3fd;--accent-track:#c2d2f5;--accent-ink:#163a9c;--bar:#d3dae5;
--positive:#247b50;--negative:#c4242a;
--pill-pos-bg:#dcfce7;--pill-pos-ink:#14532d;--pill-neg-bg:#ffedea;--pill-neg-ink:#831c1e;
--pill-warn-bg:#fffbeb;--pill-warn-ink:#92400e;--pill-warn-line:#fde68a;--pill-neu-bg:#eef0f3;--pill-neu-ink:#374151;
--font:"DM Sans",Inter,system-ui,sans-serif;--r-card:8px;--r-ctl:6px;--gap:24px}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;
--ground:#000;--surface:#111;--raised:#1c1c1c;--border:#262626;--rule:#1c1c1c;--control:#444;
--text:#fff;--muted:#b4b4b4;
--accent:#7ea2ff;--accent-soft:#141d33;--accent-track:#2a3d6b;--accent-ink:#c3d3ff;--bar:#2a2a2a;
--positive:#3fc07a;--negative:#ff8a80;
--pill-pos-bg:#172a1d;--pill-pos-ink:#3fc07a;--pill-neg-bg:#2c1a20;--pill-neg-ink:#ff8a80;
--pill-warn-bg:#2b2414;--pill-warn-ink:#e5a93b;--pill-warn-line:#4a3b17;--pill-neu-bg:#222;--pill-neu-ink:#d4d4d4}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--text);font:14px/20px var(--font);font-variant-numeric:tabular-nums}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
.app{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}
.side{display:flex;flex-direction:column;gap:24px;padding:24px 12px;border-right:1px solid var(--border);position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px;color:var(--text)}
.brand:hover{text-decoration:none}
.brand svg{flex:none}
.brand strong{display:block;font-size:15px;line-height:20px;font-weight:600}
.brand small{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;height:32px;padding:0 10px;border-radius:var(--r-ctl);color:var(--muted);font-weight:500}
.nav a:hover{color:var(--text);text-decoration:none;background:var(--raised)}
.nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent-ink)}
.out{margin:auto 0 0;padding:0 2px}
.canvas{padding:32px 40px 64px;min-width:0}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:var(--gap);flex-wrap:wrap}
h1{font-size:32px;line-height:38px;font-weight:700;letter-spacing:-0.02em;margin:0}
.sub{margin:6px 0 0;color:var(--muted);font-size:15px;line-height:22px;max-width:70ch}
.sub strong{color:var(--text);font-weight:600}
.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h2{font-size:18px;line-height:24px;font-weight:600;margin:0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;flex-wrap:wrap}
.card-head p{margin:2px 0 0;color:var(--muted);font-size:13px}
.stack{display:grid;gap:var(--gap);grid-template-columns:minmax(0,1fr)}
.btn,button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:var(--r-ctl);border:1px solid var(--control);background:var(--surface);color:var(--text);font:500 14px/1 var(--font);cursor:pointer;white-space:nowrap;transition:background-color .15s,border-color .15s,transform .12s}
.btn:hover,button:hover{text-decoration:none;border-color:var(--muted)}
.btn:active,button:active{transform:translateY(1px)}
.btn.primary,button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover,button.primary:hover{background:var(--accent-ink);border-color:var(--accent-ink)}
@media(prefers-color-scheme:dark){.btn.primary,button.primary{color:#000}.btn.primary:hover,button.primary:hover{background:#a9c0ff;border-color:#a9c0ff}}
button.small,.btn.small{height:30px;padding:0 10px;font-size:13px}
button.link{height:32px;border:0;background:none;color:var(--muted);padding:0 10px;font-weight:500}
button.link:hover{color:var(--text)}
.stamp{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
.dot.on{background:var(--positive)}.dot.off{background:var(--negative)}
.checks{list-style:none;margin:0;padding:0 20px 4px}
.checks li{display:grid;grid-template-columns:8px minmax(0,300px) minmax(0,1fr) auto;gap:6px 14px;align-items:center;min-height:52px;padding:8px 0;border-top:1px solid var(--rule)}
.checks b{font-weight:500}
.checks small{color:var(--muted);font-size:14px;line-height:20px;overflow-wrap:anywhere}
.checks form{margin:0}
@media(max-width:760px){.checks li{grid-template-columns:8px minmax(0,1fr)}.checks small,.checks form{grid-column:2}}
.kv code{font:13px/18px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;user-select:all}
.kv summary{cursor:pointer;color:var(--accent);font-weight:500}

.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.kpi{padding:16px 20px}
.kpi+.kpi{border-left:1px solid var(--border)}
.kpi span{display:block;color:var(--muted);font-size:13px}
.kpi b{display:block;font-size:24px;line-height:32px;font-weight:600;margin-top:4px}
.kpi small{display:block;color:var(--muted);font-size:13px;line-height:18px}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font-size:12px;font-weight:500;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px;border-bottom:1px solid var(--rule);vertical-align:middle}
tr:last-child td{border-bottom:0}
th:first-child,td:first-child{padding-left:20px}
th:last-child,td:last-child{padding-right:20px}
.num{text-align:right;white-space:nowrap}
td.num{font-size:14px}
.name>a{font-weight:600;color:var(--text)}
.name small,.meta{display:block;color:var(--muted);font-size:13px;line-height:18px;margin-top:2px}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--muted)}
.mut{color:var(--muted)}
.pill{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;flex:none}
.pill.pos{background:var(--pill-pos-bg);color:var(--pill-pos-ink)}
.pill.neu{background:var(--pill-neu-bg);color:var(--pill-neu-ink)}
.pill.acc{background:var(--accent-soft);color:var(--accent-ink)}
.funnel{width:180px;height:8px;border-radius:4px;background:transparent}
.funnel i{display:block;height:100%;border-radius:4px;background:var(--bar);min-width:4px}
.funnel i i{background:var(--accent-track);min-width:0}
.funnel i i i{background:var(--accent)}
.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:13px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend span::before{content:"";width:10px;height:8px;border-radius:2px;background:var(--bar)}
.legend .l2::before{background:var(--accent-track)}.legend .l3::before{background:var(--accent)}
tr.off td{color:var(--muted)}
tr.off .name>a{color:var(--muted);font-weight:500}
.m-line{display:none}
.foot{margin:0;padding:12px 20px;color:var(--muted);font-size:13px;border-top:1px solid var(--rule)}
.note{padding:10px 14px;border-radius:var(--r-ctl);margin:0 0 16px;font-size:14px}
.note.erro{background:var(--pill-neg-bg);color:var(--pill-neg-ink)}
.note.aviso{background:var(--pill-warn-bg);color:var(--pill-warn-ink);border:1px solid var(--pill-warn-line)}
.note.ok{background:var(--pill-pos-bg);color:var(--pill-pos-ink)}
.empty{margin:0 20px 20px;padding:14px 16px;border:1px dashed var(--control);border-radius:var(--r-card);color:var(--muted)}
.edit{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:var(--gap);align-items:start}
.sec{padding:20px}
.sec>h2+p{margin:4px 0 0;color:var(--muted)}
.fields{display:grid;gap:16px;margin-top:20px}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
label{display:block;font-weight:500;margin-bottom:8px}
.hint{display:block;color:var(--muted);font-size:12px;line-height:16px;margin-top:6px}
input[type=text],input[type=password],select,textarea{width:100%;height:40px;padding:0 12px;border:1px solid var(--control);border-radius:var(--r-ctl);background:var(--surface);color:var(--text);font:14px/20px var(--font)}
textarea{height:auto;min-height:84px;padding:10px 12px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:var(--accent)}
.check{display:flex;align-items:center;gap:10px;font-weight:400;margin:0}
.check input{width:18px;height:18px;accent-color:var(--accent);margin:0}
.btnrow{display:flex;justify-content:space-between;align-items:center;gap:8px}
.count{font-size:12px;color:var(--muted);font-weight:400}
.count.over{color:var(--pill-warn-ink)}
.save{display:flex;gap:12px;align-items:center;justify-content:flex-end;padding:16px 20px}
.preview{position:sticky;top:24px}
.chat{padding:16px 20px 20px;display:grid;gap:10px}
.step{color:var(--muted);font-size:12px;margin-top:6px}
.bub{max-width:92%;padding:9px 12px;border-radius:16px 16px 16px 4px;background:var(--raised);white-space:pre-wrap;overflow-wrap:anywhere}
.bub.me{justify-self:end;border-radius:16px 16px 4px 16px;background:var(--accent);color:#fff}
@media(prefers-color-scheme:dark){.bub.me{color:#000}}
.bub.me:empty{display:none}
[data-e]:empty::before{content:attr(data-e);color:var(--muted)}
.bub .opt{display:block;margin:8px -4px -3px;padding:7px 10px;border-radius:10px;background:var(--surface);color:var(--accent);text-align:center;font-weight:500}
.kv th{width:42%;font-size:14px;color:var(--muted);font-weight:400;border-bottom:1px solid var(--rule);padding:12px 12px 12px 20px;white-space:normal}
.kv td{font-weight:500}
.kv td.good::before,.kv td.bad::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:var(--positive);vertical-align:1px}
.kv td.bad::before{background:var(--negative)}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap);align-items:start}
.login{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.login .card{width:100%;max-width:380px;padding:28px}
.login h1{font-size:24px;line-height:30px;margin:24px 0 20px}
.login button{width:100%;margin-top:16px;height:40px}
@media(max-width:1100px){.edit{grid-template-columns:1fr}.preview{position:static}.cols{grid-template-columns:1fr}}
@media(max-width:860px){
.app{display:block}
.side{position:sticky;top:0;z-index:2;height:auto;display:grid;grid-template-columns:1fr auto;gap:0;padding:0;background:var(--ground);border-right:0;border-bottom:1px solid var(--border)}
.brand{height:52px;padding:0 16px}
.brand small{display:none}
.out{margin:0;padding:0 8px;display:flex;align-items:center;grid-row:1;grid-column:2}
.nav{grid-column:1/-1;flex-direction:row;overflow-x:auto;padding:0 12px 8px;gap:4px}
.nav a{flex:none;height:36px}
.canvas{padding:20px 16px 48px}
h1{font-size:24px;line-height:30px}
.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
.kpi:nth-child(3){border-left:0}
.kpi:nth-child(n+3){border-top:1px solid var(--border)}
.two{grid-template-columns:1fr}
}
@media(max-width:480px){.nav{gap:0;padding:0 8px 8px;justify-content:space-between}.nav a{padding:0 6px;font-size:13px}}
@media(max-width:640px){
.list thead{display:none}
.list,.list tbody,.list tr,.list td{display:block}
.list tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:14px 16px;border-bottom:1px solid var(--rule)}
.list tr:last-child{border-bottom:0}
.list td{padding:0;border:0}
.list td.hide-m{display:none}
.list td.m-line{display:block;grid-column:1/-1;color:var(--muted);font-size:13px}
.list td.funnel-cell{grid-column:1/-1}
.list .funnel{width:100%}
.list td.act{grid-column:2;grid-row:1}
.list td.state{grid-column:1;justify-self:start}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// Caderno com espiral e um rabisco de caneta, no azul do painel.
const MARK = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect x="6" y="3" width="20" height="24" rx="4" fill="var(--accent)"/><g fill="var(--ground)"><circle cx="6" cy="9" r="1.8"/><circle cx="6" cy="15" r="1.8"/><circle cx="6" cy="21" r="1.8"/></g><path d="M11 18.5c2.3-3.2 4.3-4.9 5.5-3.8 1.2 1-1.7 3.8-.2 4.3 1.3.5 2.8-1.7 4.1-3" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>`;

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">`;

const NAV = [
  ['automacoes', '/painel', 'Automações'],
  ['posts', '/painel/posts', 'Posts'],
  ['contatos', '/painel/contatos', 'Contatos'],
  ['status', '/painel/status', 'Status'],
  ['configurar', '/painel/configurar', 'Configurar'],
].map(([k, href, label]) => [k, `<a href="${href}"__${k}__>${label}</a>`]);

type LayoutOpts = { nav?: boolean; active?: string; sub?: string; actions?: string; head?: boolean };

export function layout(title: string, body: string, opts: LayoutOpts = {}): string {
  const doc = (inner: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} — ${BRAND}</title>${FONT}<style>${CSS}</style></head>
<body>${inner}</body></html>`;
  if (opts.nav === false) return doc(body);
  const links = NAV.map(([k, a]) => a.replace(`__${k}__`, opts.active === k ? ' aria-current="page"' : '')).join('');
  const head =
    opts.head === false
      ? ''
      : `<header class="head"><div><h1>${h(title)}</h1>${opts.sub ? `<p class="sub">${opts.sub}</p>` : ''}</div>${opts.actions ? `<div class="actions">${opts.actions}</div>` : ''}</header>`;
  return doc(`<div class="app">
<aside class="side">
<a class="brand" href="/painel">${MARK}<span><strong>${BRAND}</strong><small>${HANDLE}</small></span></a>
<nav class="nav" aria-label="Painel">${links}</nav>
<script>(()=>{const n=document.querySelector('.nav'),a=n&&n.querySelector('[aria-current]');if(a&&n.scrollWidth>n.clientWidth)n.scrollLeft=a.offsetLeft-(n.clientWidth-a.offsetWidth)/2})()</script>
<form class="out" method="post" action="/painel/sair"><button class="link" type="submit">Sair</button></form>
</aside>
<main class="canvas">${head}${body}</main>
</div>`);
}

const nf = new Intl.NumberFormat('pt-BR');
const n = (v: number) => nf.format(v);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dayKey = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Horário de Brasília; "hoje às 14:05" quando for o mesmo dia. */
export function when(d: Date | null, now = new Date()): string {
  if (!d) return '—';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '—';
  return dayKey.format(t) === dayKey.format(now) ? `hoje às ${timeFmt.format(t)}` : dateFmt.format(t).replace(',', ' às');
}

export function loginPage(error?: string): string {
  return layout(
    'Entrar',
    `<div class="login"><div class="card">
<div class="brand">${MARK}<span><strong>${BRAND}</strong><small>${HANDLE}</small></span></div>
<h1>Entrar no painel</h1>
${error ? `<p class="note erro">${h(error)}</p>` : ''}
<form method="post" action="/painel/login">
<label for="senha">Senha</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required>
<button class="primary" type="submit">Entrar</button>
</form>
</div></div>`,
    { nav: false },
  );
}

function safeLink(url: string | null, label?: string): string {
  if (!url) return '<span class="mut">—</span>';
  if (!/^https:\/\//i.test(url)) return h(url);
  return `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(label ?? url)}</a>`;
}

const EMPTY_STATS = { runs: 0, links: 0, clicked_runs: 0, clicks: 0 };

/** A barra de funil de cada Reels: comentaram (cinza) → pegaram o link (azul claro) → clicaram (azul). */
function funnel(s: Omit<Stats, 'automation_id'>, max: number): string {
  const w = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)).toFixed(1) : '0');
  const tip = `${plural(s.runs, 'comentou', 'comentaram')} · ${plural(s.links, 'pegou o link', 'pegaram o link')} · ${plural(s.clicked_runs, 'clicou', 'clicaram')}`;
  if (s.runs === 0) return `<div class="funnel" title="${h(tip)}"></div>`;
  return `<div class="funnel" title="${h(tip)}" role="img" aria-label="${h(tip)}"><i style="width:${w(s.runs, max)}%"><i style="width:${w(s.links, s.runs)}%"><i style="width:${w(s.clicked_runs, s.links)}%"></i></i></i></div>`;
}

function finding(rows: { a: Automation; s: Omit<Stats, 'automation_id'> }[], health?: Health): string {
  const runs = rows.reduce((t, r) => t + r.s.runs, 0);
  const links = rows.reduce((t, r) => t + r.s.links, 0);
  const clicked = rows.reduce((t, r) => t + r.s.clicked_runs, 0);
  if (health && health.failed > 0) return `<strong>${plural(health.failed, 'envio falhou', 'envios falharam')}.</strong> Veja em <a href="/painel/status">Status</a>.`;
  if (health && !health.sendEnabled) return '<strong>Envio desligado:</strong> as respostas ficam só em modo de teste.';
  if (runs === 0) return 'Nenhum comentário atendido ainda.';
  if (clicked === 0)
    return `${plural(runs, 'comentário atendido', 'comentários atendidos')}, ${plural(links, 'link entregue', 'links entregues')} e nenhum clique ainda.`;
  const best = rows.reduce((b, r) => (r.s.clicked_runs > b.s.clicked_runs ? r : b));
  return `<strong>${h(best.a.name)}</strong> trouxe ${n(best.s.clicked_runs)} das ${plural(clicked, 'pessoa', 'pessoas')} que clicaram no link.`;
}

export function listPage(automations: Automation[], stats: Stats[], health?: Health): string {
  const byId = new Map(stats.map((s) => [s.automation_id, s]));
  const rows = automations
    .map((a) => ({ a, s: byId.get(a.id) ?? EMPTY_STATS }))
    .sort((x, y) => Number(y.a.active) - Number(x.a.active) || y.s.runs - x.s.runs || x.a.name.localeCompare(y.a.name, 'pt-BR'));
  const active = rows.filter((r) => r.a.active).length;
  const tot = rows.reduce(
    (t, r) => ({ runs: t.runs + r.s.runs, links: t.links + r.s.links, clicked: t.clicked + r.s.clicked_runs, clicks: t.clicks + r.s.clicks }),
    { runs: 0, links: 0, clicked: 0, clicks: 0 },
  );
  const max = Math.max(1, ...rows.map((r) => r.s.runs));
  const stamp = health
    ? `<span class="stamp"><span class="dot ${health.sendEnabled ? 'on' : 'off'}"></span>${health.sendEnabled ? 'Envio ligado' : 'Envio desligado'} · último webhook ${h(when(health.lastWebhook))}</span>`
    : '';
  const actions = `${stamp}<a class="btn primary" href="/painel/automacoes/nova">Nova automação</a>`;

  const kpis = `<section class="card kpis" aria-label="Resumo">
<div class="kpi"><span>Comentários atendidos</span><b>${n(tot.runs)}</b><small>${plural(active, 'automação ativa', 'automações ativas')}</small></div>
<div class="kpi"><span>Pegaram o link</span><b>${n(tot.links)}</b><small>${tot.runs > 0 ? `${pct(tot.links, tot.runs)} de quem comentou` : '—'}</small></div>
<div class="kpi"><span>Clicaram</span><b>${n(tot.clicked)}</b><small>${plural(tot.clicks, 'clique', 'cliques')} no total</small></div>
<div class="kpi"><span>Taxa de clique</span><b>${pct(tot.clicked, tot.links)}</b><small>de quem recebeu o link</small></div>
</section>`;

  const body = rows
    .map(({ a, s }) => {
      const toggle = a.active ? 'desativar' : 'ativar';
      const trigger = a.trigger_mode === 'keywords' ? `palavras: ${h(a.keywords.join(', '))}` : 'qualquer comentário';
      return `<tr${a.active ? '' : ' class="off"'}>
<td class="name"><a href="/painel/automacoes/${a.id}">${h(a.name)}</a><small>${a.media_permalink ? `${safeLink(a.media_permalink, 'ver post')} · ` : ''}${trigger}</small></td>
<td class="state">${a.active ? '<span class="pill pos">Ativa</span>' : '<span class="pill neu">Inativa</span>'}</td>
<td class="funnel-cell">${funnel(s, max)}</td>
<td class="num hide-m">${n(s.runs)}</td><td class="num hide-m">${n(s.links)}</td><td class="num hide-m">${n(s.clicked_runs)}</td><td class="num hide-m">${pct(s.clicked_runs, s.links)}</td>
<td class="m-line">${plural(s.runs, 'comentou', 'comentaram')} · ${plural(s.links, 'pegou o link', 'pegaram o link')} · ${plural(s.clicked_runs, 'clicou', 'clicaram')} · taxa ${pct(s.clicked_runs, s.links)}</td>
<td class="num act"><form method="post" action="/painel/automacoes/${a.id}/${toggle}"><button class="small" type="submit">${a.active ? 'Desativar' : 'Ativar'}</button></form></td>
</tr>`;
    })
    .join('\n');

  const table =
    rows.length === 0
      ? `<p class="empty">Nenhuma automação ainda. <a href="/painel/automacoes/nova">Criar a primeira</a> ou escolher um Reels em <a href="/painel/posts">Posts</a>.</p>`
      : `<div class="wrap"><table class="list">
<thead><tr><th>Automação</th><th>Estado</th><th>Funil</th><th class="num">Comentaram</th><th class="num">Pegaram o link</th><th class="num">Clicaram</th><th class="num">Taxa</th><th></th></tr></thead>
<tbody>${body}</tbody></table></div>
<p class="foot">Taxa = pessoas que clicaram ÷ pessoas que receberam o link. Contado desde que o sistema começou a atender.</p>`;

  const setup = health?.setupPending
    ? `<p class="note aviso">Falta terminar a ligação com a Meta. <a href="/painel/configurar">Abrir a configuração</a> e seguir o passo a passo.</p>`
    : '';
  return layout(
    'Automações',
    `${setup}<div class="stack">${kpis}
<section class="card"><div class="card-head"><div><h2>Por Reels</h2><p>${plural(active, 'ativa', 'ativas')} · ${plural(rows.length - active, 'inativa', 'inativas')}</p></div>
<div class="legend"><span>Comentaram</span><span class="l2">Pegaram o link</span><span class="l3">Clicaram</span></div></div>
${table}</section></div>`,
    { active: 'automacoes', sub: finding(rows, health), actions },
  );
}

export function emptyForm(): FormValues {
  return {
    name: '',
    media_id: '',
    media_permalink: '',
    trigger_mode: 'any',
    keywords: '',
    include_replies: true,
    public_replies: '',
    welcome_text: '',
    welcome_button: '',
    ask_follow_text: 'Ja me seguiu ?',
    ask_follow_button: 'Seguindo',
    link_text: '',
    link_button: '',
    link_url: 'https://',
  };
}

export function formFromAutomation(a: Automation): FormValues {
  return {
    id: String(a.id),
    name: a.name,
    media_id: a.media_id,
    media_permalink: a.media_permalink ?? '',
    trigger_mode: a.trigger_mode,
    keywords: a.keywords.join(', '),
    include_replies: a.include_replies,
    public_replies: a.public_replies.join('\n'),
    welcome_text: a.welcome_text,
    welcome_button: a.welcome_button,
    ask_follow_text: a.ask_follow_text,
    ask_follow_button: a.ask_follow_button,
    link_text: a.link_text,
    link_button: a.link_button,
    link_url: a.link_url,
  };
}

export function buttonWarnings(v: FormValues): string[] {
  return (
    [
      ['botão da primeira mensagem', v.welcome_button],
      ['botão de pedir para seguir', v.ask_follow_button],
      ['botão do link', v.link_button],
    ] as const
  )
    .filter(([, t]) => [...t].length > BUTTON_TITLE_LIMIT)
    .map(
      ([nome, t]) =>
        `Aviso: o ${nome} tem ${[...t].length} caracteres. O Instagram pode cortar títulos acima de ${BUTTON_TITLE_LIMIT} caracteres (limite real ainda a testar); salvo mesmo assim.`,
    );
}

function field(label: string, name: string, value: string, hint = ''): string {
  return `<div><label for="${name}">${h(label)}</label><input id="${name}" name="${name}" type="text" value="${h(value)}" data-p="${name}">${hint ? `<span class="hint">${h(hint)}</span>` : ''}</div>`;
}

function buttonField(label: string, name: string, value: string): string {
  const len = [...value].length;
  return `<div><div class="btnrow"><label for="${name}">${h(label)}</label><span class="count${len > BUTTON_TITLE_LIMIT ? ' over' : ''}" data-count="${name}">${len}/${BUTTON_TITLE_LIMIT}</span></div><input id="${name}" name="${name}" type="text" value="${h(value)}" data-p="${name}"></div>`;
}

function area(label: string, name: string, value: string, hint = ''): string {
  return `<div><label for="${name}">${h(label)}</label><textarea id="${name}" name="${name}" data-p="${name}">${h(value)}</textarea>${hint ? `<span class="hint">${h(hint)}</span>` : ''}</div>`;
}

function section(title: string, desc: string, fields: string): string {
  return `<section class="card sec"><h2>${h(title)}</h2><p>${h(desc)}</p><div class="fields">${fields}</div></section>`;
}

// Atualiza a prévia da DM e os contadores dos botões enquanto se digita (sem script, a prévia mostra o que está salvo).
const PREVIEW_JS = `<script>
(()=>{const f=document.querySelector('form.editor');if(!f)return;const L=${BUTTON_TITLE_LIMIT};
const upd=el=>{const k=el.dataset.p,v=el.value;
if(k==='public_replies'){const first=v.split('\\n').map(s=>s.trim()).find(Boolean)||'';document.querySelectorAll('[data-s="public_replies"]').forEach(o=>o.textContent=first||'(sem resposta pública)');return}
document.querySelectorAll('[data-s="'+k+'"]').forEach(o=>o.textContent=v);
const c=document.querySelector('[data-count="'+k+'"]');if(c){const n=[...v].length;c.textContent=n+'/'+L;c.classList.toggle('over',n>L)}};
f.addEventListener('input',e=>{if(e.target.dataset&&e.target.dataset.p)upd(e.target)});})();
</script>`;

export function formPage(v: FormValues, o: { errors?: string[]; saved?: boolean } = {}): string {
  const warnings = buttonWarnings(v);
  const firstReply = v.public_replies.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  const preview = `<aside class="card preview" aria-label="Prévia da DM">
<div class="card-head"><div><h2>Como chega na DM</h2><p>Prévia do que a pessoa recebe</p></div></div>
<div class="chat">
<span class="step">No comentário</span>
<div class="bub" data-s="public_replies">${h(firstReply || '(sem resposta pública)')}</div>
<span class="step">Na DM</span>
<div class="bub"><span data-s="welcome_text" data-e="Texto da primeira mensagem">${h(v.welcome_text)}</span><span class="opt" data-s="welcome_button" data-e="Botão">${h(v.welcome_button)}</span></div>
<div class="bub me" data-s="welcome_button">${h(v.welcome_button)}</div>
<span class="step">Se ainda não segue (repete a cada clique)</span>
<div class="bub"><span data-s="ask_follow_text" data-e="Texto de pedir para seguir">${h(v.ask_follow_text)}</span><span class="opt" data-s="ask_follow_button" data-e="Botão">${h(v.ask_follow_button)}</span></div>
<span class="step">Quando já segue</span>
<div class="bub"><span data-s="link_text" data-e="Texto da mensagem com o link">${h(v.link_text)}</span><span class="opt" data-s="link_button" data-e="Botão do link">${h(v.link_button)}</span></div>
</div></aside>`;

  const form = `<form class="editor stack" method="post" action="/painel/automacoes">
${v.id ? `<input type="hidden" name="id" value="${h(v.id)}">` : ''}
${section(
  'Post e gatilho',
  'Qual Reels a automação escuta e quais comentários disparam a resposta.',
  `${field('Nome', 'name', v.name)}
<div class="two">${field('ID do post', 'media_id', v.media_id, 'Escolha na aba Posts ou digite.')}${field('Link do post (opcional)', 'media_permalink', v.media_permalink, 'Começa com https://')}</div>
<div class="two"><div><label for="trigger_mode">Quando disparar</label>
<select id="trigger_mode" name="trigger_mode">
<option value="any"${v.trigger_mode === 'any' ? ' selected' : ''}>Qualquer comentário</option>
<option value="keywords"${v.trigger_mode === 'keywords' ? ' selected' : ''}>Só com palavra-chave</option>
</select></div>${field('Palavras-chave', 'keywords', v.keywords, 'Separadas por vírgula. Vale palavra inteira, sem diferenciar acentos.')}</div>
<label class="check"><input type="checkbox" name="include_replies" value="on"${v.include_replies ? ' checked' : ''}> Incluir respostas a comentários</label>`,
)}
${section('Resposta pública', 'Aparece embaixo do comentário. O sistema sorteia uma por vez.', area('Respostas públicas', 'public_replies', v.public_replies, 'Uma por linha.'))}
${section('Primeira DM', 'Chega na hora do comentário, com um botão para pegar o conteúdo.', `${area('Primeira mensagem (DM)', 'welcome_text', v.welcome_text)}${buttonField('Botão da primeira mensagem', 'welcome_button', v.welcome_button)}`)}
${section('Pedir para seguir', 'Vai para quem clica no botão e ainda não segue a conta. Repete a cada clique até seguir.', `${area('Mensagem de pedir para seguir', 'ask_follow_text', v.ask_follow_text)}${buttonField('Botão de pedir para seguir', 'ask_follow_button', v.ask_follow_button)}`)}
${section('DM com o link', 'Vai para quem já segue. O link passa pelo painel para contar os cliques.', `${area('Mensagem com o link', 'link_text', v.link_text)}<div class="two">${buttonField('Botão do link', 'link_button', v.link_button)}${field('Link de destino', 'link_url', v.link_url, 'Começa com https://')}</div>`)}
<div class="card save"><a class="btn" href="/painel">Cancelar</a><button class="primary" type="submit">Salvar</button></div>
</form>`;

  const notes = `${o.saved ? '<p class="note ok">Salvo.</p>' : ''}${(o.errors ?? []).map((e) => `<p class="note erro">${h(e)}</p>`).join('')}${warnings.map((w) => `<p class="note aviso">${h(w)}</p>`).join('')}`;
  return layout(v.id ? v.name : 'Nova automação', `${notes}<div class="edit">${form}${preview}</div>${PREVIEW_JS}`, {
    active: 'automacoes',
    sub: v.id ? 'Editar a automação deste Reels.' : 'Uma automação por Reels: responde o comentário, manda a DM e entrega o link para quem segue.',
  });
}

export function contactsPage(rows: ContactRow[]): string {
  const follow = rows.filter((c) => c.follows === true).length;
  const notFollow = rows.filter((c) => c.follows === false).length;
  const body = rows.length
    ? `<div class="wrap"><table class="contacts"><thead><tr><th>Pessoa</th><th>Segue a conta?</th><th class="num">Última vez</th><th class="num">ID no Instagram</th></tr></thead><tbody>${rows
        .map(
          (c) =>
            `<tr><td class="name">${c.username ? `<a href="https://www.instagram.com/${encodeURIComponent(c.username)}/" target="_blank" rel="noopener noreferrer">@${h(c.username)}</a>` : '<span class="mut">sem nome</span>'}</td><td>${c.follows === null ? '<span class="mut">—</span>' : c.follows ? '<span class="pill pos">Segue</span>' : '<span class="pill neu">Não segue</span>'}</td><td class="num">${h(when(c.last_seen_at))}</td><td class="num mono">${h(c.igsid)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="empty">Nenhum contato ainda. Quem comentar num Reels com automação aparece aqui.</p>';
  return layout('Contatos', `<section class="card">${body}</section>`, {
    active: 'contatos',
    sub: rows.length
      ? `Últimos ${n(rows.length)}: ${plural(follow, 'segue', 'seguem')} a conta, ${n(notFollow)} não ${notFollow === 1 ? 'segue' : 'seguem'}, ${n(rows.length - follow - notFollow)} sem checagem.`
      : 'Quem interagiu com as automações.',
  });
}

export function postsPage(o: { posts?: MediaItem[]; message?: string; automations?: Automation[] }): string {
  if (!o.posts) return layout('Posts', `<p class="note aviso">${h(o.message ?? 'Não foi possível listar os posts.')}</p>`, { active: 'posts' });
  const byMedia = new Map((o.automations ?? []).map((a) => [a.media_id, a]));
  const covered = o.posts.filter((p) => byMedia.has(p.id)).length;
  const rows = o.posts
    .map((p) => {
      const q = `media_id=${encodeURIComponent(p.id)}&permalink=${encodeURIComponent(p.permalink ?? '')}`;
      const a = byMedia.get(p.id);
      const auto = a
        ? `<a href="/painel/automacoes/${a.id}">${h(a.name)}</a> ${a.active ? '<span class="pill pos">Ativa</span>' : '<span class="pill neu">Inativa</span>'}`
        : `<a class="btn small" href="${h(`/painel/automacoes/nova?${q}`)}">Criar automação</a>`;
      const caption = (p.caption ?? '').split('\n')[0].slice(0, 90);
      return `<tr><td class="name">${caption ? h(caption) : '<span class="mut">sem legenda</span>'}<small>${h(p.media_product_type === 'REELS' ? 'Reels' : p.media_product_type)} · ${h(when(p.timestamp ? new Date(p.timestamp.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : null))} · ${safeLink(p.permalink, 'abrir')}</small></td><td class="num mono">${h(p.id)}</td><td class="num">${auto}</td></tr>`;
    })
    .join('');
  return layout(
    'Posts',
    `<section class="card">${
      o.posts.length
        ? `<div class="wrap"><table><thead><tr><th>Post</th><th class="num">ID</th><th class="num">Automação</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="empty">Nenhum post encontrado no Instagram.</p>'
    }</section>`,
    { active: 'posts', sub: `Últimos ${n(o.posts.length)} do Instagram · ${plural(covered, 'tem', 'têm')} automação.` },
  );
}

export function statusPage(s: {
  tokenConfigured: boolean;
  sendEnabled: boolean;
  lastWebhook: Date | null;
  pending: number;
  failed: number;
  eventErrors: number;
  lastError: string | null;
}): string {
  const row = (k: string, v: string, tone = '') => `<tr><th>${h(k)}</th><td${tone ? ` class="${tone}"` : ''}>${v}</td></tr>`;
  const problems = [!s.tokenConfigured && 'token', !s.sendEnabled && 'envio', s.failed > 0 && 'falhas', s.eventErrors > 0 && 'eventos'].filter(Boolean);
  return layout(
    'Status',
    `<div class="cols">
<section class="card"><div class="card-head"><h2>Conexão com o Instagram</h2></div><table class="kv"><tbody>
${row('Conta', `${HANDLE} <a href="/painel/configurar">ver configuração</a>`)}
${row('Token do Instagram', s.tokenConfigured ? 'configurado' : 'não configurado', s.tokenConfigured ? 'good' : 'bad')}
${row('Envio', s.sendEnabled ? 'ligado' : 'desligado (saída em modo de teste)', s.sendEnabled ? 'good' : 'bad')}
${row('Último webhook', s.lastWebhook ? h(when(s.lastWebhook)) : 'nenhum recebido')}
</tbody></table></section>
<section class="card"><div class="card-head"><h2>Fila de envio</h2></div><table class="kv"><tbody>
${row('Pendentes', String(s.pending))}
${row('Falhas', String(s.failed), s.failed > 0 ? 'bad' : '')}
${row('Eventos com erro', String(s.eventErrors), s.eventErrors > 0 ? 'bad' : '')}
${row('Último erro', s.lastError ? h(s.lastError) : '—')}
</tbody></table></section>
</div>`,
    {
      active: 'status',
      sub: problems.length ? `Precisa de atenção: ${problems.join(', ')}.` : 'Tudo certo: token configurado, envio ligado e nenhuma falha na fila.',
    },
  );
}

/** O que a página Configurar sabe. `null` = não deu para consultar (falta token ou IG_USER_ID). */
export type SetupFacts = {
  publicBaseUrl: string;
  appSecret: boolean;
  verifyToken: string;
  token: boolean;
  igUserId: string;
  account: { id: string; username: string } | { error: string } | null;
  fields: string[] | { error: string } | null;
  lastWebhook: Date | null;
  sendEnabled: boolean;
  subscribed?: boolean;
  subscribeError?: string;
};

/** Configuração mínima ainda incompleta? (só variáveis e webhook; não consulta a Graph). */
export function setupPending(f: Pick<SetupFacts, 'publicBaseUrl' | 'appSecret' | 'verifyToken' | 'token' | 'igUserId' | 'lastWebhook'>): boolean {
  return !/^https:\/\//i.test(f.publicBaseUrl) || !f.appSecret || !f.verifyToken || !f.token || !f.igUserId || !f.lastWebhook;
}

export function setupPage(f: SetupFacts): string {
  const base = h(f.publicBaseUrl);
  const httpsBase = /^https:\/\//i.test(f.publicBaseUrl);
  const err = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v;
  const acc = f.account && !err(f.account) ? f.account : null;
  const missing = Array.isArray(f.fields) ? WEBHOOK_FIELDS.filter((x) => !(f.fields as string[]).includes(x)) : [];
  const needsLive = 'Depende do token e do IG_USER_ID.';

  const idOk = !!f.igUserId && (!acc || acc.id === f.igUserId);
  const subscribe =
    Array.isArray(f.fields) && missing.length
      ? `<form method="post" action="/painel/configurar/inscrever"><button class="primary small" type="submit">Inscrever a conta</button></form>`
      : '';
  const items: [string, boolean, string, string?][] = [
    ['Endereço público · PUBLIC_BASE_URL', httpsBase, httpsBase ? base : 'Coloque o endereço https do serviço (o domínio que a Railway gerou).'],
    ['Chave secreta do app · META_APP_SECRET', f.appSecret, f.appSecret ? 'definida' : 'Meta → Configurações do app → Básico → Chave secreta do app.'],
    ['Verify token · META_VERIFY_TOKEN', !!f.verifyToken, f.verifyToken ? 'definido' : 'Invente uma frase longa e use a mesma no webhook da Meta.'],
    ['Token de acesso · META_ACCESS_TOKEN', f.token, f.token ? 'definido' : 'Gere na configuração do Instagram do app (passo 5 do guia).'],
    [
      'ID da conta · IG_USER_ID',
      idOk,
      !f.igUserId
        ? 'Use o ID da conta do Instagram que aparece ao gerar o token.'
        : acc && acc.id !== f.igUserId
          ? `O token é da conta @${h(acc.username)} (ID ${h(acc.id)}), mas IG_USER_ID é ${h(f.igUserId)}.`
          : h(f.igUserId),
    ],
    ['Conta conectada', !!acc, acc ? `@${h(acc.username)}` : err(f.account) ? h(f.account.error) : needsLive],
    [
      'Webhook inscrito na conta',
      Array.isArray(f.fields) && missing.length === 0,
      err(f.fields)
        ? h(f.fields.error)
        : !Array.isArray(f.fields)
          ? needsLive
          : missing.length
            ? `Faltam: ${h(missing.join(', '))}.`
            : h(WEBHOOK_FIELDS.join(', ')),
      subscribe,
    ],
    ['Primeiro webhook recebido', !!f.lastWebhook, f.lastWebhook ? h(when(f.lastWebhook)) : 'Comente num post com outra conta para testar.'],
    ['Envio ligado · SEND_ENABLED', f.sendEnabled, f.sendEnabled ? 'true' : 'Deixe false até o teste passar; depois mude para true.'],
  ];
  const done = items.filter((i) => i[1]).length;
  const list = items
    .map(
      ([label, ok, detail, action]) =>
        `<li data-ok="${ok ? 1 : 0}"><span class="dot ${ok ? 'on' : 'off'}"></span><b>${h(label)}</b><small>${detail}</small>${action ?? ''}</li>`,
    )
    .join('\n');

  const row = (k: string, v: string) => `<tr><th>${h(k)}</th><td>${v}</td></tr>`;
  const paste = `<section class="card"><div class="card-head"><div><h2>Cole na Meta</h2><p>Copie cada valor para o campo de mesmo nome no app.</p></div></div>
<table class="kv"><tbody>
${row('URL de callback', `<code>${base}/webhook</code>`)}
${row('Verificar token', f.verifyToken ? `<details><summary>Mostrar</summary><code>${h(f.verifyToken)}</code></details>` : '<span class="mut">defina META_VERIFY_TOKEN</span>')}
${row('Campos do webhook', `<code>${h(WEBHOOK_FIELDS.join(', '))}</code>`)}
${row('URL da Política de Privacidade', `<code>${base}/privacidade</code>`)}
${row('URL de exclusão de dados', `<code>${base}/privacidade#exclusao</code>`)}
</tbody></table></section>`;

  const notes = [
    f.subscribed && '<p class="note ok">Conta inscrita no webhook.</p>',
    f.subscribeError && `<p class="note erro">Não deu para inscrever: ${h(f.subscribeError)}</p>`,
  ]
    .filter(Boolean)
    .join('');
  return layout(
    'Configurar',
    `${notes}<div class="stack">
<section class="card"><div class="card-head"><div><h2>Checklist</h2><p>${n(done)} de ${n(items.length)} prontos</p></div></div>
<ul class="checks">${list}</ul></section>
${paste}
</div>`,
    {
      active: 'configurar',
      sub: `Ligue o painel à sua conta do Instagram. Passo a passo completo em <a href="${GUIDE_URL}" target="_blank" rel="noopener noreferrer">docs/INSTALAR.md</a>.`,
    },
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `<section class="card sec"><p>${h(message)}</p><p><a href="/painel">Voltar para Automações</a></p></section>`);
}
