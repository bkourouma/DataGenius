/**
 * Prépare Vitest à exécuter le code SERVEUR des exports (pdfmake, pptxgenjs, echarts).
 *
 * `tests/setup.ts` (commun au dépôt) suppose jsdom (`window`) : l'annotation
 * `@vitest-environment node` le ferait échouer. On rétablit donc, le temps des tests, les
 * conditions d'un serveur Next :
 * - pas de `document` au premier chargement de pdfkit (il calcule `import.meta.url` : avec
 *   jsdom il prend une URL http et `createRequire` échoue) ;
 * - `Uint8Array` de Node, seulement pour pdfmake (`utiliserUint8ArrayNode` ; jsdom en fournit un autre : pdfkit refuse alors les polices lues
 *   sur le disque, « Not a supported font format ») ;
 * - zrender (echarts) ne trouve pas de canvas : il retombe sur sa table de largeurs, comme
 *   sur le serveur.
 */
import { afterAll, beforeAll, vi } from 'vitest';

export async function importerSansDocument<T>(charger: () => Promise<T>): Promise<T> {
  const descripteur = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    return await charger();
  } finally {
    if (descripteur) Object.defineProperty(globalThis, 'document', descripteur);
  }
}

/** Rustine canvas (zrender), à appeler au premier niveau d'un fichier de test. */
export function preparerEnvironnementServeur(): void {
  beforeAll(() => {
    if (typeof HTMLCanvasElement !== 'undefined') {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    }
  });
}

/**
 * `Uint8Array` de Node pour pdfmake, à appeler DANS un `describe` (jszip, lui, ne supporte pas
 * ce remplacement : les tests PPTX ne l'utilisent pas).
 */
export function utiliserUint8ArrayNode(): void {
  const Uint8ArrayNode = Object.getPrototypeOf(Buffer.prototype)
    .constructor as Uint8ArrayConstructor;
  let Uint8ArrayJsdom: Uint8ArrayConstructor;
  beforeAll(() => {
    Uint8ArrayJsdom = globalThis.Uint8Array;
    globalThis.Uint8Array = Uint8ArrayNode;
  });
  afterAll(() => {
    globalThis.Uint8Array = Uint8ArrayJsdom;
  });
}
