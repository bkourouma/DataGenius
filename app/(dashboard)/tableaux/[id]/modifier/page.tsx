import { EditeurTableau } from '../../editeur'

export default function ModifierTableauPage({ params }: { params: { id: string } }) {
  return <EditeurTableau id={params.id} />
}
