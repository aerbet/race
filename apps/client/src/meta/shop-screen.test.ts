import { describe, expect, it } from 'vitest';
import { formatPrice, methodsFor, preferredProviders } from './shop-screen';

const offer = {
  id: 'tokens_100',
  name: '',
  tokens: 100,
  prices: {
    cryptobot: { amount: '1.10', currency: 'USD' },
    sbp: { amount: '99.00', currency: 'RUB' },
    stars: { amount: '75', currency: 'XTR' },
  },
};

describe('ателье: цена в валюте игрока (7.4)', () => {
  it('порядок способов оплаты', () => {
    expect(methodsFor(offer, 'ru', false)[0]).toBe('sbp');
    expect(methodsFor(offer, 'en', false)[0]).toBe('cryptobot');
    expect(methodsFor(offer, 'ru', true)[0]).toBe('stars');
    expect(preferredProviders('en', true)[0]).toBe('stars');
    // Неизвестный способ — в конце
    expect(
      methodsFor({ ...offer, prices: { x: offer.prices.stars, ...offer.prices } }, 'ru', false).at(
        -1,
      ),
    ).toBe('x');
  });

  it('формат цены', () => {
    expect(formatPrice(offer.prices.sbp, 'ru').replace(/\s/g, ' ')).toBe('99 ₽');
    expect(formatPrice(offer.prices.cryptobot, 'en')).toBe('$1.10');
    expect(formatPrice(offer.prices.stars, 'en')).toBe('⭐ 75');
  });
});
