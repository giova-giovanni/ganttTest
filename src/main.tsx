import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { flushPersist, initStore } from './store';
import './styles.css';

// il salvataggio è differito: alla chiusura si forza la scrittura
window.addEventListener('beforeunload', flushPersist);
window.addEventListener('pagehide', flushPersist);

const container = document.getElementById('root');

// prima si legge l'archivio (file condiviso o browser), poi si disegna:
// così l'interfaccia non parte mai da dati vuoti che verrebbero subito sostituiti
initStore().finally(() => {
  if (!container) return;
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
