import type { ButtonStyle } from './config.ts';

export type Button =
  | { kind: 'postback'; title: string; payload: string }
  | { kind: 'url'; title: string; url: string };

export type OutMessage = Record<string, unknown>;

export class ValidationError extends Error {}

const TITLE_MAX = 80;
const GENERIC_MAX = 160;
const BUTTON_TEXT_MAX = 640;

export function splitTitle(text: string): { title: string; subtitle?: string } {
  if (text.length <= TITLE_MAX) return { title: text };
  if (text.length > GENERIC_MAX) {
    throw new ValidationError(`texto com ${text.length} caracteres; o máximo em generic é ${GENERIC_MAX}`);
  }
  const cut = text.lastIndexOf(' ', TITLE_MAX);
  if (cut <= 0) return { title: text.slice(0, TITLE_MAX), subtitle: text.slice(TITLE_MAX) };
  return { title: text.slice(0, cut), subtitle: text.slice(cut + 1) };
}

function apiButton(b: Button): Record<string, string> {
  return b.kind === 'postback'
    ? { type: 'postback', title: b.title, payload: b.payload }
    : { type: 'web_url', url: b.url, title: b.title };
}

function generic(text: string, button: Button): OutMessage {
  const { title, subtitle } = splitTitle(text);
  const element: Record<string, unknown> = { title };
  if (subtitle) element.subtitle = subtitle;
  element.buttons = [apiButton(button)];
  return {
    attachment: { type: 'template', payload: { template_type: 'generic', elements: [element] } },
  };
}

export function buildButtonMessage(text: string, button: Button, style: ButtonStyle): OutMessage {
  if (style === 'button') {
    if (text.length > BUTTON_TEXT_MAX) {
      throw new ValidationError(`texto com ${text.length} caracteres; o máximo em button é ${BUTTON_TEXT_MAX}`);
    }
    return {
      attachment: {
        type: 'template',
        payload: { template_type: 'button', text, buttons: [apiButton(button)] },
      },
    };
  }
  if (style === 'quick_reply' && button.kind === 'postback') {
    return {
      text,
      quick_replies: [{ content_type: 'text', title: button.title, payload: button.payload }],
    };
  }
  return generic(text, button);
}

export function buildText(text: string): OutMessage {
  return { text };
}
