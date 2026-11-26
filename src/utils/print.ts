import React from 'react';

/**
 * Manda in stampa quando il documento è stato disegnato e ripulisce alla fine,
 * anche se l'utente annulla la finestra di stampa del browser.
 * Il documento va disegnato fuori da `.app` (portale su `document.body`):
 * mentre `body` ha la classe `printing` il programma sparisce e resta solo il foglio.
 */
export function usePrintWhenReady(active: boolean, done: () => void) {
  const cb = React.useRef(done);
  cb.current = done;

  React.useEffect(() => {
    if (!active) return;
    document.body.classList.add('printing');
    const finish = () => {
      document.body.classList.remove('printing');
      cb.current();
    };
    window.addEventListener('afterprint', finish, { once: true });
    const id = window.setTimeout(() => window.print(), 120);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing');
    };
  }, [active]);
}

/** formato del foglio: `@page` accetta A4/A3 e l'orientamento */
export function pageRule(paper: 'A4' | 'A3', orientation: 'landscape' | 'portrait', margin = '10mm'): string {
  return `@page { size: ${paper} ${orientation}; margin: ${margin}; }`;
}
