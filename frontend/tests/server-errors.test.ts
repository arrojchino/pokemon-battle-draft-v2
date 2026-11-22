import { describe, expect, it } from 'vitest';
import { localizeServerErrorIn } from '../src/i18n/serverErrors.js';
import { translate } from '../src/i18n/core.js';

describe('localizeServerError', () => {
  it('maps a known server message to Spanish', () => {
    expect(localizeServerErrorIn('es', 'Unknown room')).toBe(translate('es', 'srv.unknownRoom'));
    expect(localizeServerErrorIn('es', 'Slow down: one message a second')).toBe('Más despacio: un mensaje por segundo');
    expect(localizeServerErrorIn('es', 'Not time to pick')).not.toBe('Not time to pick');
  });

  it('keeps English as English', () => {
    expect(localizeServerErrorIn('en', 'Finish this game first')).toBe('Finish this game first');
  });

  it('fills the player name in the coin-call message', () => {
    expect(localizeServerErrorIn('es', 'Ash calls this coin')).toBe(translate('es', 'srv.callsCoin', { name: 'Ash' }));
    expect(localizeServerErrorIn('es', 'Ash calls this coin')).toContain('Ash');
    expect(localizeServerErrorIn('es', 'Your rival calls this coin')).toBe(translate('es', 'srv.rivalCallsCoin'));
  });

  it('passes unknown messages through unchanged', () => {
    expect(localizeServerErrorIn('es', 'Something new the server says')).toBe('Something new the server says');
    expect(localizeServerErrorIn('en', '')).toBe('');
  });
});
