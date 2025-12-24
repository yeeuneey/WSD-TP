-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "providerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_providerId_key" ON "User"("providerId");
