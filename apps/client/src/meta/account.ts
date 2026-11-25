/** Вход в API (метаигра). Гость играет без аккаунта: без наград, рейтинга и гаража. */
export interface AccountState {
  token: string | null;
  userId: string | null;
  name: string | null;
  /** Выбранная машина из гаража (id владения). */
  ownedCarId: string | null;
}

const KEY = 'sr:account';

function load(): AccountState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw)
      return {
        token: null,
        userId: null,
        name: null,
        ownedCarId: null,
        ...(JSON.parse(raw) as Partial<AccountState>),
      };
  } catch {
    /* без хранилища — гость */
  }
  return { token: null, userId: null, name: null, ownedCarId: null };
}

export const account: AccountState = load();

export function saveAccount(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(account));
  } catch {
    /* без хранилища */
  }
}

export function logout(): void {
  account.token = account.userId = account.name = account.ownedCarId = null;
  saveAccount();
}
