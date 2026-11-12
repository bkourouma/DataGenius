const ADMIN = 'TenantAdmin'
export const ROLES_SIEGE_MEDIC_ASSIST: readonly string[] = [ADMIN, 'Member']

export function peutUtiliserMedicAssist(
  roleName: string | null | undefined,
  scope: { voitTout: boolean } | null,
  _habilitations: readonly string[] | null | undefined
): boolean {
  return !!roleName && ROLES_SIEGE_MEDIC_ASSIST.includes(roleName) && (scope?.voitTout ?? true)
}

export function peutAdministrerMedicAssist(
  roleName: string | null | undefined,
  _habilitations: readonly string[] | null | undefined
): boolean {
  return roleName === ADMIN
}
