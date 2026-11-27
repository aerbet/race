import { t, has, getLang } from '@sr/shared';
import { account, saveAccount, logout } from './account';

export function apiUrl(): string {
  const q = new URLSearchParams(location.search).get('api');
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL;
  // same-origin — продакшен за одним доменом: nginx проксирует /api и /webhooks (deploy/)
  if (env === 'same-origin') return q ?? '';
  return q ?? env ?? `${location.protocol}//${location.hostname}:8080`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Ключ идемпотентности для операций с деньгами (повтор запроса не спишет дважды). */
export const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; key?: string; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && account.token) headers.Authorization = `Bearer ${account.token}`;
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  let res: Response;
  try {
    res = await fetch(apiUrl() + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', t('err.offline'));
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    if (res.status === 401 && account.token) logout();
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      res.status,
      d.error ?? 'error',
      d.message ?? t('err.http', { status: res.status }),
    );
  }
  return data as T;
}

/** Текст ошибки для игрока: свой перевод по коду, иначе сообщение сервера (оно на русском). */
export function errText(e: unknown): string {
  if (!(e instanceof ApiError)) return t('err.generic');
  if (has(`err.${e.code}`)) return t(`err.${e.code}`);
  return getLang() === 'ru' && e.message ? e.message : t('err.generic');
}

export interface OwnedCar {
  id: string;
  carId: string;
  parts: Record<string, number>;
  visual: Record<string, string>;
  pi: number;
  carClass: string;
}

export interface CatalogCar {
  id: string;
  name: string;
  era: string;
  price: number;
  pi: number;
  carClass: string;
}

export interface Wallet {
  credits: number;
  tokens: number;
}

export async function login(email: string, password: string): Promise<void> {
  const r = await api<{ token: string; userId: string; name: string }>('/api/auth/login', {
    body: { email, password },
    auth: false,
  });
  setSession(r);
}

export async function register(email: string, password: string, name: string): Promise<void> {
  const r = await api<{ token: string; userId: string; name: string }>('/api/auth/register', {
    body: { email, password, name },
    auth: false,
  });
  setSession(r);
}

/** Вход из Telegram Mini App по initData (подпись проверяет API). */
export async function loginTelegramWebApp(initData: string): Promise<void> {
  const r = await api<{ token: string; userId: string; name: string }>(
    '/api/auth/telegram-webapp',
    { body: { initData }, auth: false },
  );
  setSession(r, false);
}

/** После входа — настройки из профиля; сменился язык — пересобрать страницу. */
function afterLogin(): void {
  void import('./settings-sync').then(async ({ pullSettings }) => {
    if (await pullSettings()) location.reload();
  });
}

/** sync = false — вход при запуске (Telegram): настройки заберёт сам запуск (main.ts). */
function setSession(r: { token: string; userId: string; name: string }, sync = true): void {
  account.token = r.token;
  account.userId = r.userId;
  account.name = r.name;
  account.ownedCarId = null;
  saveAccount();
  if (sync) afterLogin();
}

export const garageList = () => api<OwnedCar[]>('/api/garage');
export const catalog = () => api<CatalogCar[]>('/api/catalog/cars', { auth: false });
export const wallet = () => api<Wallet>('/api/wallet');

/** Машина, выбранная для заездов (если вошли). */
export async function activeCar(): Promise<OwnedCar | null> {
  if (!account.token) return null;
  const list = await garageList();
  return list.find((c) => c.id === account.ownedCarId) ?? list[0] ?? null;
}
