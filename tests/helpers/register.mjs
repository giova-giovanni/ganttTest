// Permette a `node --test` di importare direttamente i sorgenti TypeScript di src/
// (import senza estensione, sintassi TS e JSX) usando il compilatore `typescript`
// già presente tra le dipendenze di sviluppo: nessun pacchetto in più.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TS_EXT = ['.ts', '.tsx'];
const HAS_EXT = /\.(?:[cm]?[jt]sx?|json)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && context.parentURL && !HAS_EXT.test(specifier)) {
      for (const ext of TS_EXT) {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, format: 'module', shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const file = fileURLToPath(url);
      const out = ts.transpileModule(readFileSync(file, 'utf8'), {
        fileName: file,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          isolatedModules: true,
          inlineSourceMap: true,
        },
      });
      return { format: 'module', source: out.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
