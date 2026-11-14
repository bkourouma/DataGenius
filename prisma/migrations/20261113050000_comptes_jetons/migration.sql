-- CreateTable
CREATE TABLE "comptes_jetons" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expireA" TIMESTAMP(3) NOT NULL,
    "utiliseA" TIMESTAMP(3),
    "creeA" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creePar" TEXT,

    CONSTRAINT "comptes_jetons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comptes_jetons_hash_key" ON "comptes_jetons"("hash");

-- CreateIndex
CREATE INDEX "comptes_jetons_userId_type_creeA_idx" ON "comptes_jetons"("userId", "type", "creeA");

-- AddForeignKey
ALTER TABLE "comptes_jetons" ADD CONSTRAINT "comptes_jetons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
