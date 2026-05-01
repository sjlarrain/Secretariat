import { ConnectedAccount, getAllAccounts, getAccount, saveAccount, deleteAccount, setDefaultAccount } from './token-store';

export { ConnectedAccount };

export async function resolveAccount(type: 'calendar' | 'tasks', alias?: string): Promise<ConnectedAccount | null> {
  const accounts = await getAllAccounts();

  if (alias) {
    return accounts.find((a) => a.alias.toLowerCase() === alias.toLowerCase() && a.type === type) ?? null;
  }

  return accounts.find((a) => a.isDefault && a.type === type) ?? null;
}

export async function setDefault(id: string): Promise<void> {
  await setDefaultAccount(id);
}

export { getAllAccounts, getAccount, saveAccount, deleteAccount };
