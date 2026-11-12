'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Largeur du conteneur (et non de la fenêtre) : le panneau d'artefacts fait ~480 px sur un écran
 * de 1440. Le plugin de requêtes de conteneur Tailwind n'est pas installé, d'où ResizeObserver.
 * Étroit par défaut (avant mesure, ou sans ResizeObserver) : c'est la disposition la plus sûre.
 */
export function useConteneurLarge<T extends HTMLElement = HTMLElement>(seuil: number) {
  const ref = useRef<T>(null);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = (largeur: number) => setLarge(largeur >= seuil);
    mesurer(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(entrees => {
      const largeur = entrees[0]?.contentRect.width;
      if (typeof largeur === 'number') mesurer(largeur);
    });
    if (typeof obs.observe !== 'function') {
      obs.disconnect?.();
      return;
    }
    obs.observe(el);
    return () => obs.disconnect();
  }, [seuil]);
  return { ref, large };
}

/** Vrai tant que la fenêtre est plus étroite que 640 px (panneau en feuille plein écran). */
export function useSuperpositionMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const maj = () => setMobile(mq.matches);
    maj();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', maj);
      return () => mq.removeEventListener('change', maj);
    }
    mq.addListener?.(maj);
    return () => mq.removeListener?.(maj);
  }, []);
  return mobile;
}
