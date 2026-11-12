import { PrismaClient } from '@prisma/client'

const globalDb = globalThis as typeof globalThis & { datageniusDb?: PrismaClient }
export const prisma = globalDb.datageniusDb ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalDb.datageniusDb = prisma
