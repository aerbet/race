import shop from './shop.json';

export interface TokenPack {
  id: string;
  name: string;
  tokens: number;
  rub: number;
  usdt: number;
  badge?: string;
}

export interface Cosmetic {
  id: string;
  slot: 'paint' | 'neon' | 'vinyl' | 'rims' | 'spoiler' | 'kit';
  value: string;
  name: string;
  price: number;
}

/** Только косметика: за деньги — никаких преимуществ в скорости (ТЗ). Один файл для клиента и API. */
export const SHOP = shop as { packs: TokenPack[]; cosmetics: Cosmetic[] };

export const cosmeticByValue = (slot: string, value: string): Cosmetic | undefined =>
  SHOP.cosmetics.find((c) => c.slot === slot && c.value === value);
