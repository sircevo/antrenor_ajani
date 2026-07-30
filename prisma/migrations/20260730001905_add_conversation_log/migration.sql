-- CreateTable
CREATE TABLE "conversation_logs" (
    "id" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_logs_chatId_createdAt_idx" ON "conversation_logs"("chatId", "createdAt");
