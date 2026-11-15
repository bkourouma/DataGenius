-- CreateTable
CREATE TABLE "auth_tentatives" (
    "cle" TEXT NOT NULL,
    "echecs" INTEGER NOT NULL,
    "fenetreDebut" TIMESTAMP(3) NOT NULL,
    "bloqueJusqua" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_tentatives_pkey" PRIMARY KEY ("cle")
);
