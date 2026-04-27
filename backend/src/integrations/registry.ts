import { ConnectedAccount, getAllAccounts, getAccount, saveAccount, deleteAccount } from './token-store';

export { ConnectedAccount };

export function resolveAccount(type: 'calendar' | 'tasks', alias?: string): ConnectedAccount | null {
  const accounts = getAllAccounts();

  if (alias) {
    return accounts.find((a) => a.alias.toLowerCase() === alias.toLowerCase() && a.type === type) ?? null;
  }

  return accounts.find((a) => a.isDefault && a.type === type) ?? null;
}

export function setDefault(id: string) {
  const account = getAccount(id);
  if (!account) return;

  const accounts = getAllAccounts();
  accounts
    .filter((a) => a.type === account.type)
    .forEach((a) => {
      a.isDefault = a.id === id;
      saveAccount(a);
    });
}

export { getAllAccounts, getAccount, saveAccount, deleteAccount };
