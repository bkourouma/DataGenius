import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConteneurLarge } from '@/components/medic-assist/artefacts/use-conteneur-large';

function Sonde() {
  const { ref, large } = useConteneurLarge<HTMLDivElement>(500);
  return <div ref={ref} data-large={String(large)} />;
}

const observateurOrigine = window.ResizeObserver;

function poser(classe: unknown) {
  window.ResizeObserver = classe as typeof ResizeObserver;
}

describe('useConteneurLarge', () => {
  afterEach(() => {
    window.ResizeObserver = observateurOrigine;
  });

  it("déconnecte l'observateur quand observe n'est pas disponible", () => {
    const disconnect = vi.fn();
    class FauxObservateur {
      disconnect = disconnect;
    }
    poser(FauxObservateur);
    render(<Sonde />);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("déconnecte l'observateur au démontage", () => {
    const disconnect = vi.fn();
    class FauxObservateur {
      observe = vi.fn();
      disconnect = disconnect;
    }
    poser(FauxObservateur);
    const { unmount } = render(<Sonde />);
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
