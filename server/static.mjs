// Quale file della cartella dist corrisponde a un indirizzo richiesto dal browser.
import { join, normalize, sep } from 'node:path';

/**
 * `rawPath` è la parte di indirizzo prima del «?», ancora codificata (%20, %5C…).
 * Restituisce il file da servire (index.html per le rotte dell'applicazione),
 * oppure null se l'indirizzo è malformato (risposta 400).
 */
export function staticPath(root, rawPath) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath || '/');
  } catch {
    return null;
  }
  if (urlPath.includes('\0')) return null;
  const base = normalize(root);
  const file = normalize(join(base, urlPath === '/' ? 'index.html' : urlPath.replace(/^[/\\]+/, '')));
  // dentro dist e basta: «dist-vecchia» o «dist.zip» iniziano come «dist» ma sono fuori
  const inside = file.startsWith(base.endsWith(sep) ? base : base + sep);
  return inside ? file : join(base, 'index.html');
}
