import shop from './shop.json';
import midnight from './looks/midnight.json';
import sakura from './looks/sakura.json';
import inferno from './looks/inferno.json';
import phantom from './looks/phantom.json';

export interface TokenPack {
  id: string;
  name: string;
  tokens: number;
  rub: number;
  usdt: number;
  /** Цена в Telegram Stars. */
  stars: number;
  badge?: string;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export type CosmeticSlot =
  | 'paint'
  | 'neon'
  | 'livery'
  | 'rims'
  | 'spoiler'
  | 'kit'
  | 'smoke'
  | 'look';

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  value: string;
  name: string;
  price: number;
  rarity: Rarity;
}

/**
 * Легендарный образ (BLENDER_PLAN, раздел 5): кит + ливрея + диски + цвета + неон + дым.
 * 3D-моделей не требует — это набор значений визуальных слотов.
 */
export interface Look {
  id: string;
  name: string;
  price: number;
  set: Partial<Record<'kit' | 'livery' | 'rims' | 'paint' | 'paint2' | 'neon' | 'smoke', string>>;
}

/** Образы — по файлу на образ в `shop/looks/` (их же читает API). */
export const LOOKS: Look[] = [midnight, sakura, inferno, phantom];

const base = shop as { packs: TokenPack[]; cosmetics: Cosmetic[] };

/** Только косметика: за деньги — никаких преимуществ в скорости (ТЗ). Один файл для клиента и API. */
export const SHOP = {
  packs: base.packs,
  cosmetics: [
    ...base.cosmetics,
    ...LOOKS.map(
      (l): Cosmetic => ({
        id: `look_${l.id}`,
        slot: 'look',
        value: l.id,
        name: l.name,
        price: l.price,
        rarity: 'legendary',
      }),
    ),
  ],
};

export const cosmeticByValue = (slot: string, value: string): Cosmetic | undefined =>
  SHOP.cosmetics.find((c) => c.slot === slot && c.value === value);

/** Вкладки витрины (9.4) и слоты в них. */
export const SHOP_TABS = {
  looks: ['look'],
  body: ['kit', 'spoiler'],
  rims: ['rims'],
  liveries: ['livery'],
  neon: ['neon'],
  extras: ['paint', 'smoke'],
} as const satisfies Record<string, readonly CosmeticSlot[]>;
export type ShopTab = keyof typeof SHOP_TABS;

export const tabOfSlot = (slot: string): ShopTab =>
  (Object.keys(SHOP_TABS) as ShopTab[]).find((t) =>
    (SHOP_TABS[t] as readonly string[]).includes(slot),
  ) ?? 'extras';

/** Цвета дыма из-под колёс. */
export const SMOKE_COLORS: Record<string, string> = {
  cyan: '#7fe8ff',
  pink: '#ff6fd8',
  lime: '#b6ff5a',
  gold: '#ffc94a',
};

/**
 * Итоговый вид машины: образ (если надет) задаёт свои слоты поверх отдельных;
 * старый слот `vinyl` читается как `livery`.
 */
export function resolveVisual(visual: Record<string, string> | undefined): Record<string, string> {
  const v: Record<string, string> = { ...(visual ?? {}) };
  if (!v.livery && v.vinyl) v.livery = v.vinyl;
  const look = v.look && v.look !== 'none' ? LOOKS.find((l) => l.id === v.look) : undefined;
  if (look) Object.assign(v, look.set);
  return v;
}
