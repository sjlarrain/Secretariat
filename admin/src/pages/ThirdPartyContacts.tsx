import { useEffect, useState } from 'react';
import { api, ThirdPartyContact } from '../api/client';

// The per-user counterpart to the "Third-party contacts" section of
// Whitelist.tsx — same feature, minus the ops-only whitelisted-numbers list
// that page also shows. Kept as its own page rather than reusing Whitelist.tsx
// because that page's single effect fetches both in one Promise.all(); under
// this panel api.getWhitelist() 404s (there's no per-user whitelist), which
// would fail the combined fetch and blank out the contacts list too.
export default function ThirdPartyContacts() {
  const [contacts, setContacts] = useState<ThirdPartyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNumber, setNewNumber] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getThirdPartyContacts().then(({ contacts }) => {
      setContacts(contacts);
      setLoading(false);
    });
  }, []);

  async function handleAdd() {
    if (!newNumber.trim() || !newAlias.trim()) {
      setError('Both number and alias are required.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      await api.addThirdPartyContact(newNumber.trim(), newAlias.trim());
      const { contacts: updated } = await api.getThirdPartyContacts();
      setContacts(updated);
      setNewNumber('');
      setNewAlias('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add contact');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(number: string) {
    try {
      await api.removeThirdPartyContact(number);
      setContacts((c) => c.filter((x) => x.number !== number));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove contact');
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Contacts</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          These numbers can send <code>/set</code> and <code>/menu</code> to create events for you.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        {contacts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No contacts yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map((c) => (
              <li key={c.number} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 15 }}>👤</span>
                <span style={{ fontWeight: 600, fontSize: 14, minWidth: 80 }}>{c.alias}</span>
                <span style={{
                  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
                  fontSize: 13,
                  flex: 1,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.03em',
                }}>
                  {c.number}
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '2px 10px', color: 'var(--red)' }}
                  onClick={() => handleRemove(c.number)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add contact</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Alias (e.g. Wife)"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            style={{ width: 140 }}
          />
          <input
            className="input"
            placeholder="+56912345678"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={adding}
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
