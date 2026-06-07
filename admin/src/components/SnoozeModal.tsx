import { SnoozeOption } from '../api/client';

interface Props {
  title: string;
  mode: 'snooze' | 'remind';
  onSelect: (option: SnoozeOption) => void;
  onClose: () => void;
  loading?: boolean;
}

const OPTIONS: { value: SnoozeOption; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: 'monday', label: 'Next Monday' },
];

export default function SnoozeModal({ title, mode, onSelect, onClose, loading }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '24px 28px', minWidth: 280, maxWidth: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
          {mode === 'snooze' ? 'Snooze' : 'Add Reminder'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, wordBreak: 'break-word' }}>
          {title}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className="btn-secondary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
              disabled={loading}
              onClick={() => onSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          className="btn-ghost"
          style={{ width: '100%', marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}
          disabled={loading}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
