import { GabaritPleinEcran } from '@/components/medic-assist/chat/gabarit-plein-ecran'
import { Skeleton } from '@/components/ui/skeleton'

/** Squelette plein ecran : liste des conversations a gauche, fil et saisie a droite. */
export default function ChargementMedicAssist() {
  return (
    <GabaritPleinEcran>
    <div className="flex h-full" aria-busy="true">
      <div className="hidden w-[280px] shrink-0 flex-col gap-2 border-e p-3 lg:flex">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-4 px-4 py-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="mx-auto w-full max-w-[760px] px-4 pb-4">
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
    </GabaritPleinEcran>
  )
}
