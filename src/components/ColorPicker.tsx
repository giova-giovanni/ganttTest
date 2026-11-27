import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../ui';

/** colori proposti: distinti fra loro, la scelta libera resta sempre disponibile */
export const SWATCHES = [
  '#2f7de1',
  '#2f9bc9',
  '#0f8f83',
  '#2aa76b',
  '#5b8c2a',
  '#c99a16',
  '#e0873c',
  '#b0603a',
  '#d6453d',
  '#c0398f',
  '#8e5bd8',
  '#4f5bd5',
  '#6b7889',
  '#37474f',
];

const POPUP_W = 224;
const POPUP_H = 190;

interface Props {
  value: string;
  onChange: (color: string) => void;
  /** mostra «Colore automatico» quando il colore è stato scelto a mano */
  onReset?: () => void;
  isCustom?: boolean;
  disabled?: boolean;
  title: string;
  className?: string;
  /** testo accanto al quadratino */
  label?: string;
}

/**
 * Quadratino di colore che apre una tavolozza. La scelta libera viene salvata solo quando
 * si chiude il selettore del browser, non a ogni movimento del mouse: nell'archivio
 * condiviso ogni salvataggio arriva a tutti i colleghi.
 */
export function ColorPicker({ value, onChange, onReset, isCustom, disabled, title, className, label }: Props) {
  const { t } = useT();
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [draft, setDraft] = React.useState(value);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const customRef = React.useRef<HTMLInputElement | null>(null);
  const change = React.useRef(onChange);
  change.current = onChange;
  const open = !!pos;

  React.useEffect(() => setDraft(value), [value, open]);

  // evento «change» del browser = scelta conclusa (React chiama onChange a ogni movimento)
  React.useEffect(() => {
    const el = customRef.current;
    if (!el) return;
    const commit = () => change.current(el.value);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setPos(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // chiude solo la tavolozza, non la finestra che la contiene
      setPos(null);
    };
    const close = () => setPos(null);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setPos(null);
      return;
    }
    const r = buttonRef.current!.getBoundingClientRect();
    const below = r.bottom + 4 + POPUP_H <= window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - POPUP_W - 8)),
      top: below ? r.bottom + 4 : Math.max(8, r.top - POPUP_H - 4),
    });
  };

  const pick = (color: string) => {
    onChange(color);
    setPos(null);
  };

  /** il quadratino vive dentro righe e pulsanti cliccabili: i clic restano qui */
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'color-btn' + (label ? ' with-label' : '') + (className ? ' ' + className : '')}
        title={title}
        aria-label={title}
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="color-dot" style={{ background: value }} />
        {label}
      </button>
      {pos &&
        createPortal(
          <div
            ref={popupRef}
            className="color-pop"
            style={{ left: pos.left, top: pos.top, width: POPUP_W }}
            onMouseDown={stop}
            onClick={stop}
            onKeyDown={stop}
          >
            <div className="color-pop-title">{title}</div>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'swatch' + (c.toLowerCase() === value.toLowerCase() ? ' sel' : '')}
                  style={{ background: c }}
                  title={c}
                  onClick={() => pick(c)}
                />
              ))}
            </div>
            <label className="color-custom">
              <input ref={customRef} type="color" value={draft} onChange={(e) => setDraft(e.target.value)} />
              {t('colors.custom')}
            </label>
            {onReset && (
              <button
                type="button"
                className="btn sm"
                disabled={!isCustom}
                onClick={() => {
                  onReset();
                  setPos(null);
                }}
              >
                {t('colors.automatic')}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
