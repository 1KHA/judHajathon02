-- CreateIndex
CREATE INDEX "Judge_sessionId_idx" ON "Judge"("sessionId");

-- AddForeignKey
ALTER TABLE "Judge" ADD CONSTRAINT "Judge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
