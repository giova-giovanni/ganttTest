import React from 'react';
import { createPortal } from 'react-dom';
import { translate, type TKey } from './i18n';
import type { Lang, Person, Status } from './types';
import type { Level, Presence } from './utils/api';
import { STATUS_COLORS } from './utils/tree';
import { canEditState, useStore } from './store';
import { textOn } from './theme';

export function useT() {
  const { ui } = useStore();
  const t = React.useCallback(
    (key: TKey, vars?: Record<string, string | number>) => translate(ui.lang, key, vars),
    [ui.lang],
  );
  return { t, lang: ui.lang as Lang };
}

/**
 * true quando l'utente può modificare i dati: lo consentono il livello di accesso e il
 * server (nell'archivio condiviso tutti scrivono insieme, nessuno blocca gli altri).
 */
export function useCanEdit(): boolean {
  return canEditState(useStore());
}

/** gli altri utenti collegati adesso (uno per persona, anche se ha più schede aperte) */
export function useOthers(): Presence[] {
  const { sync } = useStore();
  return React.useMemo(() => {
    const mine = sync.session?.id;
    const byUser = new Map<string, Presence>();
    for (const p of sync.presence) {
      if (p.sid === mine) continue;
      const prev = byUser.get(p.sid);
      // tra più schede della stessa persona conta quella che sta modificando qualcosa
      if (!prev || (!prev.node && !prev.note && (p.node || p.note))) byUser.set(p.sid, p);
    }
    return [...byUser.values()];
  }, [sync.presence, sync.session?.id]);
}

/** pallini con le iniziali di chi è presente */
export function PresenceDots({ people, size = 18, max = 6 }: { people: Presence[]; size?: number; max?: number }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className="presence-dots" style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {shown.map((p) => (
        <span
          key={p.sid}
          className="avatar"
          title={p.user}
          style={{ background: p.color, width: size, height: size, flexBasis: size, fontSize: size * 0.45 }}
        >
          {initials(p.user)}
        </span>
      ))}
      {people.length > max && <small style={{ marginLeft: 2 }}>+{people.length - max}</small>}
    </span>
  );
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

export function IconZoom({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="6.8" cy="6.8" r="4.6" />
      <path d="M10.3 10.3 14 14" strokeLinecap="round" />
      <path d="M4.6 6.8h4.4M6.8 4.6V9" strokeLinecap="round" />
    </svg>
  );
}

export function StatusChip({ status, lang }: { status: Status; lang: Lang }) {
  return (
    <span className="chip" style={{ background: STATUS_COLORS[status], color: textOn(STATUS_COLORS[status]) }}>
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

/**
 * Tondo del responsabile: la foto del profilo se c'è e si carica, altrimenti le iniziali
 * sul suo colore (il colore resta come cornice anche attorno alla foto).
 */
export function Avatar({ person, size = 22 }: { person?: Person; size?: number }) {
  // si ricorda l'indirizzo che non si è caricato: cambiandolo si riprova
  const [broken, setBroken] = React.useState('');
  const box = { width: size, height: size, flexBasis: size, fontSize: Math.max(8, Math.round(size * 0.42)) };
  if (!person) {
    return (
      <span className="avatar" style={{ background: '#6e788a', ...box }}>
        ?
      </span>
    );
  }
  const photo = person.photo && person.photo !== broken ? person.photo : '';
  return (
    <span
      className={'avatar' + (photo ? ' photo' : '')}
      style={{
        background: person.color,
        color: textOn(person.color),
        boxShadow: photo ? `0 0 0 ${size > 40 ? 3 : 1.5}px ${person.color}` : undefined,
        ...box,
      }}
      title={person.name}
    >
      {photo ? (
        // il sito della foto non deve sapere da quale indirizzo di Gantt Planner arriva la richiesta
        <img src={photo} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(photo)} />
      ) : (
        initials(person.name)
      )}
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
  // fuori dalla pagina: così la finestra segue l'ingrandimento scelto senza uscire dallo schermo
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={maxWidth ? { maxWidth: `min(${maxWidth}px, calc(96vw / var(--page-zoom, 1)))` } : undefined}
      >
        <h3>{title}</h3>
        {children}
        {footer && <div className="row">{footer}</div>}
      </div>
    </div>,
    document.body,
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
