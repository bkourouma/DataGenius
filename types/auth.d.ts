import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string; roleName: string; habilitations: string[] | null }
  }
  interface User { roleName: string }
}

declare module 'next-auth/jwt' {
  interface JWT { roleName: string; emetteurOidc?: string; sujetOidc?: string }
}
