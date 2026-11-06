import type { AutomationInput } from '../src/store.ts';

export function sampleAutomation(over: Partial<AutomationInput> = {}): AutomationInput {
  return {
    name: 'Kit X',
    media_id: 'm1',
    media_permalink: null,
    trigger_mode: 'any',
    keywords: [],
    include_replies: true,
    public_replies: ['a', 'b'],
    welcome_text: 'oi',
    welcome_button: 'Clique',
    ask_follow_text: 'segue?',
    ask_follow_button: 'Seguindo',
    link_text: 'toma',
    link_button: 'Pegar',
    link_url: 'https://example.com/x',
    ...over,
  };
}
