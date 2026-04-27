import fs from 'fs';
import path from 'path';
import { env } from '../env';
import { encrypt, decrypt } from '../utils/encrypt';

// NOTE: Render free tier has ephemeral storage — data written here is lost on redeploy/restart.
// Re-connect accounts after each redeploy. A future version should use Upstash Redis or a database.

export interface ConnectedAccount {
  id: string;
  alias: string;
  provider: 'google';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
  encryptedTokens: string; // JSON stringified tokens, AES-256-GCM encrypted
}

export interface Settings {
  timezone: string;
  morningDigest: {
    enabled: boolean;
    time: string;    // HH:MM
    days: number[];  // 0=Sun, 1=Mon, ... 6=Sat
    scheduleId?: string;
  };
  weeklySummary: {
    enabled: boolean;
    day: number;
    time: string;
    scheduleId?: string;
  };
}

interface StoreData {
  accounts: ConnectedAccount[];
  settings: Settings;
}

const STORE_PATH = path.join(__dirname, '../../../../data/accounts.json');

const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Santiago',
  morningDigest: { enabled: false, time: '08:00', days: [1, 2, 3, 4, 5] },
  weeklySummary: { enabled: false, day: 0, time: '09:00' },
};

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore(): StoreData {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    return { accounts: [], settings: DEFAULT_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw) as StoreData;
  } catch {
    return { accounts: [], settings: DEFAULT_SETTINGS };
  }
}

function writeStore(data: StoreData) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function getAllAccounts(): ConnectedAccount[] {
  return readStore().accounts;
}

export function getAccount(id: string): ConnectedAccount | undefined {
  return readStore().accounts.find((a) => a.id === id);
}

export function saveAccount(account: ConnectedAccount) {
  const store = readStore();
  const idx = store.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    store.accounts[idx] = account;
  } else {
    store.accounts.push(account);
  }
  writeStore(store);
}

export function deleteAccount(id: string) {
  const store = readStore();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  writeStore(store);
}

export function getSettings(): Settings {
  return readStore().settings;
}

export function saveSettings(settings: Settings) {
  const store = readStore();
  store.settings = settings;
  writeStore(store);
}

export function encryptTokens(tokens: object): string {
  return encrypt(JSON.stringify(tokens), env.TOKEN_ENCRYPTION_KEY);
}

export function decryptTokens<T = object>(encrypted: string): T {
  return JSON.parse(decrypt(encrypted, env.TOKEN_ENCRYPTION_KEY)) as T;
}
