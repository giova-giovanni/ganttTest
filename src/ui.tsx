import React from 'react';
import { translate, type TKey } from './i18n';
import type { Lang, Person, Status } from './types';
import type { Level } from './utils/api';
import { STATUS_COLORS } from './utils/tree';
import { useStore } from './store';

export function useT() {
  const { ui } = useStore();
  const t = React.useCallback(
    (key: TKey, vars?: Record<string, string | number>) => translate(ui.lang, key, vars),
    [ui.lang],
  );
  return { t, lang: ui.lang as Lang };
}

/**
 * true quando l'utente può modificare i dati: nell'archivio condiviso solo chi
 * tiene il blocco di scrittura, e solo se il livello di accesso lo consente.
 */
export function useCanEdit(): boolean {
  const { sync, auth } = useStore();
  if (auth.level === 'lettura') return false;
  return sync.mode === 'browser' || (sync.role === 'writer' && !sync.conflict);
}

/** livello di accesso attuale (senza gantt-utenti.json è sempre «admin») */
export function useLevel(): Level {
  return useStore().auth.level;
}

/** true se il livello è «amministratore», a prescindere dal blocco di scrittura */
export function useIsAdmin(): boolean {
  return useStore().auth.level === 'admin';
}

/**
 * true per le operazioni delicate — eliminare progetti, gestire responsabili e
 * assenze, svuotare o sostituire l'archivio — che restano all'amministratore.
 */
export function useCanAdmin(): boolean {
  const canEdit = useCanEdit();
  const admin = useIsAdmin();
  return canEdit && admin;
}

export function IconLock({ size = 13, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.1" />
      {open ? (
        <path d="M5.6 7V5.1a2.4 2.4 0 0 1 4.8-.3" strokeLinecap="round" />
      ) : (
        <path d="M5.6 7V5.1a2.4 2.4 0 0 1 4.8 0V7" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * Icone disegnate a mano: niente emoji, che cambiano aspetto da un PC all'altro
 * e stonano in un programma di lavoro.
 */
export function IconArchive({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x="1.9" y="2.3" width="12.2" height="3" rx="0.6" />
      <path d="M3.1 5.3v7.3c0 .4.3.8.8.8h8.2c.5 0 .8-.4.8-.8V5.3" />
      <path d="M6.4 8.3h3.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconRestore({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <path d="M2.6 8a5.4 5.4 0 1 0 1.8-4" strokeLinecap="round" />
      <path d="M2.2 2.6v3.3h3.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusChip({ status, lang }: { status: Status; lang: Lang }) {
  return (
    <span className="chip" style={{ background: STATUS_COLORS[status] }}>
      {translate(lang, `status.${status}` as TKey)}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ person, size = 22 }: { person?: Person; size?: number }) {
  if (!person) {
    return (
      <span className="avatar" style={{ background: '#9aa5b3', width: size, height: size, flexBasis: size }}>
        ?
      </span>
    );
  }
  return (
    <span
      className="avatar"
      style={{ background: person.color, width: size, height: size, flexBasis: size }}
      title={person.name}
    >
      {initials(person.name)}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  maxWidth,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  maxWidth?: number;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={maxWidth ? { maxWidth } : undefined}>
        <h3>{title}</h3>
        {children}
        {footer && <div className="row">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Ore con una sola cifra decimale e virgola come separatore:
 * italiano e tedesco usano entrambi la virgola, quindi non serve distinguere la lingua.
 */
export function fmtHours(h: number): string {
  if (!h) return '0';
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}
