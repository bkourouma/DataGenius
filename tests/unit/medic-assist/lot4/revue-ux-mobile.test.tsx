import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BarreOutilsArtefact } from '@/components/medic-assist/artefacts/barre-outils-artefact';
import { OngletsArtefacts } from '@/components/medic-assist/artefacts/onglets-artefacts';
import { PanneauArtefacts } from '@/components/medic-assist/artefacts/panneau-artefacts';

import { artefactTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui';
import { langueTest } from './_intl';

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
);
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', roleName: 'RegManager' } }, status: 'authenticated' }),
}));
vi.mock('@/components/medic-assist/suivi/actions-artefact', () => ({
  ActionsArtefact: () => <div data-testid="actions-artefact" />,
}));
vi.mock('@/components/medic-assist/artefacts/rendu-tableau', () => ({
  RenduTableau: () => <div data-testid="rendu-tableau" />,
}));

const matchMediaOrigine = window.matchMedia;
const rectOrigine = Element.prototype.getBoundingClientRect;

function simulerMobile(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === '(max-width: 639px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function simulerLargeur(largeur: number) {
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: largeur,
      height: 0,
      top: 0,
      left: 0,
      right: largeur,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON() {},
    };
  };
}

beforeEach(() => {
  langueTest.code = 'fr';
});
afterEach(() => {
  window.matchMedia = matchMediaOrigine;
  Element.prototype.getBoundingClientRect = rectOrigine;
  vi.unstubAllGlobals();
});

function barre() {
  const artefact = artefactTest('tableau', { titre: 'CA par pays' });
  return render(
    <BarreOutilsArtefact
      artefact={artefact}
      versionAffichee={artefact.version}
      onChoisirVersion={vi.fn()}
      vue="natif"
      onVue={vi.fn()}
      copiable
      onCopier={vi.fn()}
      provenanceOuverte={false}
      idProvenance="prov"
      onProvenance={vi.fn()}
      enregistrement="inactif"
      actions={<div data-testid="actions-factices" />}
    />
  );
}

describe('Point 5 : cibles tactiles', () => {
  it("Copier, Comment j'ai calculé et Télécharger portent cible-tactile", () => {
    barre();
    expect(screen.getByRole('button', { name: 'Copier' })).toHaveClass('cible-tactile');
    expect(screen.getByRole('button', { name: "Comment j'ai calculé" })).toHaveClass('cible-tactile');
    expect(screen.getByRole('button', { name: /Télécharger/ })).toHaveClass('cible-tactile');
  });

  it('Agrandir et Fermer portent cible-tactile', () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseJson({ artefacts: [] })));
    render(
      <PanneauArtefacts conversationId="c" artefactActifId={null} onFermer={vi.fn()} onSelection={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Agrandir le panneau' })).toHaveClass('cible-tactile');
    expect(screen.getByRole('button', { name: 'Fermer le panneau' })).toHaveClass('cible-tactile');
  });
});

describe('Point 6 : libellés selon la largeur du conteneur', () => {
  it('masque les libellés sous 560 px (nom accessible conservé)', () => {
    simulerLargeur(480);
    barre();
    const copier = screen.getByRole('button', { name: 'Copier' });
    expect(copier).toHaveAttribute('title', 'Copier');
    expect(copier.querySelector('span')).toHaveClass('sr-only');
    expect(screen.getByTestId('actions-secondaires').className).toMatch(/!hidden/);
  });

  it('affiche les libellés à partir de 560 px', async () => {
    simulerLargeur(600);
    barre();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copier' }).querySelector('span')).not.toHaveClass('sr-only')
    );
    expect(
      screen.getByRole('button', { name: "Comment j'ai calculé" }).querySelector('span')
    ).not.toHaveClass('sr-only');
    expect(screen.getByTestId('actions-secondaires').className).not.toMatch(/!hidden/);
  });
});

describe('Point 8 : feuille plein écran mobile', () => {
  function monter() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/medic-assist/artefacts?'))
          return reponseJson({
            artefacts: [
              {
                id: 'a1',
                racineId: 'a1',
                version: 1,
                type: 'tableau',
                titre: 'CA par pays',
                majA: '2026-11-02T08:00:00.000Z',
              },
            ],
          });
        return reponseJson(reponseApi(artefactTest('tableau', { titre: 'CA par pays' })));
      })
    );
    const onFermer = vi.fn();
    render(
      <PanneauArtefacts conversationId="c" artefactActifId="a1" onFermer={onFermer} onSelection={vi.fn()} />
    );
    return onFermer;
  }

  it('mobile : dialogue modal, Agrandir masqué, Échap ferme', async () => {
    simulerMobile(true);
    const onFermer = monter();
    const dialogue = await screen.findByRole('dialog', { name: 'Panneau des artefacts en plein écran' });
    expect(dialogue).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Agrandir le panneau', hidden: true })).toHaveClass(
      'max-sm:hidden'
    );
    await userEvent.keyboard('{Escape}');
    expect(onFermer).toHaveBeenCalledTimes(1);
  });

  it("mobile : Échap rend le focus à l'élément qui avait ouvert la feuille", async () => {
    simulerMobile(true);
    const ouvreur = document.createElement('button');
    ouvreur.textContent = 'Ouvrir';
    document.body.appendChild(ouvreur);
    ouvreur.focus();
    try {
      const onFermer = monter();
      await screen.findByRole('dialog', { name: 'Panneau des artefacts en plein écran' });
      expect(ouvreur).not.toHaveFocus();
      await userEvent.keyboard('{Escape}');
      expect(onFermer).toHaveBeenCalledTimes(1);
      expect(ouvreur).toHaveFocus();
    } finally {
      ouvreur.remove();
    }
  });

  it('bureau : région inchangée', async () => {
    simulerMobile(false);
    monter();
    expect(await screen.findByRole('region', { name: 'Panneau des artefacts' })).not.toHaveAttribute(
      'aria-modal'
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Point 9 : onglets homonymes', () => {
  it('le nom accessible inclut le type et la largeur est réduite sur mobile', () => {
    const base = { racineId: 'x', version: 1, majA: '2026-11-02T08:00:00.000Z' };
    render(
      <OngletsArtefacts
        artefacts={[
          { ...base, id: 'a', type: 'tableau', titre: 'Ventes' },
          { ...base, id: 'b', type: 'graphique', titre: 'Ventes' },
        ]}
        actifId="a"
        onSelection={vi.fn()}
        libelle="Artefacts"
      />
    );
    const tableau = screen.getByRole('tab', { name: 'Ventes (Tableau)' });
    expect(screen.getByRole('tab', { name: 'Ventes (Graphique)' })).toBeInTheDocument();
    expect(tableau.className).toMatch(/max-w-\[9rem\]/);
    expect(tableau.className).toMatch(/sm:max-w-\[12rem\]/);
  });
});
