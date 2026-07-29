-- CreateTable
CREATE TABLE "inbox_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "userId" BIGINT,
    "username" TEXT,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_events_processed_createdAt_idx" ON "inbox_events"("processed", "createdAt");
