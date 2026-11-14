-- Garde-fous de l'assistant IA (lot B, R10).
--
-- 1. Verrou du tour en cours par conversation : échéance (maintenant + 6 min) posée par un
--    UPDATE conditionnel, remise à NULL en fin de tour. Un verrou échu vaut libre.
ALTER TABLE "assistant_conversations" ADD COLUMN "tourEnCoursJusqua" TIMESTAMP(3);

-- 2. Idempotence de l'envoi : id du UIMessage fourni par le client. Les anciens messages et
--    les réponses de l'assistant restent à NULL ; PostgreSQL tient les NULL pour distincts,
--    la contrainte n'agit donc que sur les ids fournis.
ALTER TABLE "assistant_messages" ADD COLUMN "idClient" TEXT;

CREATE UNIQUE INDEX "assistant_messages_conversationId_idClient_key"
  ON "assistant_messages"("conversationId", "idClient");
