import { ConnectedAccount, getAllAccounts, getAccount, saveAccount, deleteAccount, setDefaultAccount } from './token-store';

export { ConnectedAccount };

export async function resolveAccount(
  userId: string,
  type: 'calendar' | 'tasks',
  alias?: string
): Promise<ConnectedAccount | null> {
  const accounts = await getAllAccounts(userId);

  if (alias) {
    return accounts.find((a) => a.alias.toLowerCase() === alias.toLowerCase() && a.type === type) ?? null;
  }

  return accounts.find((a) => a.isDefault && a.type === type) ?? null;
}

export async function setDefault(userId: string, id: string): Promise<void> {
  await setDefaultAccount(userId, id);
}

export { getAllAccounts, getAccount, saveAccount, deleteAccount };
