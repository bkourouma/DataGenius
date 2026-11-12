-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "roleName" TEXT NOT NULL DEFAULT 'Member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "epinglee" BOOLEAN NOT NULL DEFAULT false,
    "archivee" BOOLEAN NOT NULL DEFAULT false,
    "dernierMessageA" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "metadonnees" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_jeux_de_donnees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "source" TEXT NOT NULL,
    "requete" JSONB NOT NULL,
    "colonnes" JSONB NOT NULL,
    "lignes" JSONB NOT NULL,
    "nbLignes" INTEGER NOT NULL,
    "tronque" BOOLEAN NOT NULL DEFAULT false,
    "provenance" JSONB NOT NULL,
    "empreintePerimetre" TEXT NOT NULL,
    "empreinteSource" TEXT,
    "calculeA" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_jeux_de_donnees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_artefacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "racineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "spec" JSONB NOT NULL,
    "jeuxDeDonneesIds" JSONB NOT NULL,
    "enregistre" BOOLEAN NOT NULL DEFAULT false,
    "enregistreA" TIMESTAMP(3),
    "auteur" TEXT NOT NULL DEFAULT 'assistant',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_artefacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_partages" (
    "id" TEXT NOT NULL,
    "ressourceType" TEXT NOT NULL,
    "ressourceId" TEXT NOT NULL,
    "deUserId" TEXT NOT NULL,
    "aUserId" TEXT NOT NULL,
    "message" TEXT,
    "vuA" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_partages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_epingles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artefactRacineId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_epingles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_rapports_programmes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "artefactRacineId" TEXT NOT NULL,
    "frequence" TEXT NOT NULL,
    "jourSemaine" INTEGER,
    "jourMois" INTEGER,
    "heure" TEXT NOT NULL,
    "destinataires" JSONB NOT NULL,
    "formats" JSONB NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "prochainEnvoiA" TIMESTAMP(3) NOT NULL,
    "dernierEnvoiA" TIMESTAMP(3),
    "dernierStatut" TEXT,
    "dernierErreur" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_rapports_programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "parametres" JSONB NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'proposee',
    "resultat" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeeA" TIMESTAMP(3),

    CONSTRAINT "assistant_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_avis" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" INTEGER NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_avis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_usages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "fournisseur" TEXT NOT NULL,
    "modele" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "tokensEntree" INTEGER NOT NULL DEFAULT 0,
    "tokensSortie" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheLecture" INTEGER,
    "tokensCacheEcriture" INTEGER,
    "coutUsd" DECIMAL(12,6) NOT NULL,
    "dureeMs" INTEGER NOT NULL,
    "erreur" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_pieces_jointes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "nomFichier" TEXT NOT NULL,
    "typeMime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "chemin" TEXT NOT NULL,
    "contenu" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_pieces_jointes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametres_application" (
    "id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "parametres_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "assistant_conversations_userId_updatedAt_idx" ON "assistant_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "assistant_messages_conversationId_createdAt_idx" ON "assistant_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_jeux_de_donnees_userId_createdAt_idx" ON "assistant_jeux_de_donnees"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_jeux_de_donnees_conversationId_idx" ON "assistant_jeux_de_donnees"("conversationId");

-- CreateIndex
CREATE INDEX "assistant_artefacts_userId_enregistre_idx" ON "assistant_artefacts"("userId", "enregistre");

-- CreateIndex
CREATE INDEX "assistant_artefacts_conversationId_idx" ON "assistant_artefacts"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_artefacts_racineId_version_key" ON "assistant_artefacts"("racineId", "version");

-- CreateIndex
CREATE INDEX "assistant_partages_aUserId_createdAt_idx" ON "assistant_partages"("aUserId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_partages_deUserId_idx" ON "assistant_partages"("deUserId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_partages_ressourceType_ressourceId_aUserId_key" ON "assistant_partages"("ressourceType", "ressourceId", "aUserId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_epingles_userId_artefactRacineId_key" ON "assistant_epingles"("userId", "artefactRacineId");

-- CreateIndex
CREATE INDEX "assistant_rapports_programmes_actif_prochainEnvoiA_idx" ON "assistant_rapports_programmes"("actif", "prochainEnvoiA");

-- CreateIndex
CREATE INDEX "assistant_rapports_programmes_userId_idx" ON "assistant_rapports_programmes"("userId");

-- CreateIndex
CREATE INDEX "assistant_actions_userId_statut_idx" ON "assistant_actions"("userId", "statut");

-- CreateIndex
CREATE INDEX "assistant_actions_conversationId_idx" ON "assistant_actions"("conversationId");

-- CreateIndex
CREATE INDEX "assistant_actions_messageId_idx" ON "assistant_actions"("messageId");

-- CreateIndex
CREATE INDEX "assistant_avis_createdAt_idx" ON "assistant_avis"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_avis_messageId_userId_key" ON "assistant_avis"("messageId", "userId");

-- CreateIndex
CREATE INDEX "assistant_usages_createdAt_idx" ON "assistant_usages"("createdAt");

-- CreateIndex
CREATE INDEX "assistant_usages_userId_createdAt_idx" ON "assistant_usages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_usages_conversationId_idx" ON "assistant_usages"("conversationId");

-- CreateIndex
CREATE INDEX "assistant_pieces_jointes_userId_createdAt_idx" ON "assistant_pieces_jointes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_pieces_jointes_conversationId_idx" ON "assistant_pieces_jointes"("conversationId");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_idx" ON "tasks"("assignedToId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "parametres_application_cle_key" ON "parametres_application"("cle");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_jeux_de_donnees" ADD CONSTRAINT "assistant_jeux_de_donnees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_jeux_de_donnees" ADD CONSTRAINT "assistant_jeux_de_donnees_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_artefacts" ADD CONSTRAINT "assistant_artefacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_artefacts" ADD CONSTRAINT "assistant_artefacts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_partages" ADD CONSTRAINT "assistant_partages_deUserId_fkey" FOREIGN KEY ("deUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_partages" ADD CONSTRAINT "assistant_partages_aUserId_fkey" FOREIGN KEY ("aUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_epingles" ADD CONSTRAINT "assistant_epingles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_rapports_programmes" ADD CONSTRAINT "assistant_rapports_programmes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "assistant_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_avis" ADD CONSTRAINT "assistant_avis_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "assistant_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_avis" ADD CONSTRAINT "assistant_avis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_usages" ADD CONSTRAINT "assistant_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_usages" ADD CONSTRAINT "assistant_usages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_usages" ADD CONSTRAINT "assistant_usages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "assistant_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_pieces_jointes" ADD CONSTRAINT "assistant_pieces_jointes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_pieces_jointes" ADD CONSTRAINT "assistant_pieces_jointes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

