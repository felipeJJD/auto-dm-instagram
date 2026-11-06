export type ButtonStyle = 'generic' | 'button' | 'quick_reply';

export type Config = {
  databaseUrl: string;
  port: number;
  publicBaseUrl: string;
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  igUserId: string;
  /** @ da conta, sem arroba: só aparece no painel e na página de privacidade. */
  igUsername: string;
  /** Nome que o painel e a página de privacidade mostram. */
  brandName: string;
  graphBase: string;
  sendEnabled: boolean;
  buttonStyle: ButtonStyle;
  adminPassword: string;
  sessionSecret: string;
};

const STYLES: ButtonStyle[] = ['generic', 'button', 'quick_reply'];

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const style = env.BUTTON_STYLE || 'generic';
  if (!STYLES.includes(style as ButtonStyle)) {
    throw new Error(`BUTTON_STYLE inválido: ${style} (use ${STYLES.join(' | ')})`);
  }
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 0) throw new Error(`PORT inválida: ${env.PORT}`);
  return {
    databaseUrl: env.DATABASE_URL ?? '',
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    appSecret: env.META_APP_SECRET ?? '',
    verifyToken: env.META_VERIFY_TOKEN ?? '',
    accessToken: env.META_ACCESS_TOKEN ?? '',
    igUserId: (env.IG_USER_ID ?? '').trim(),
    igUsername: (env.IG_USERNAME ?? '').trim().replace(/^@/, ''),
    brandName: (env.BRAND_NAME ?? '').trim() || 'Auto DM',
    graphBase: (env.META_GRAPH_BASE || 'https://graph.facebook.com/v27.0').replace(/\/+$/, ''),
    sendEnabled: env.SEND_ENABLED === 'true',
    buttonStyle: style as ButtonStyle,
    adminPassword: env.ADMIN_PASSWORD ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
  };
}
