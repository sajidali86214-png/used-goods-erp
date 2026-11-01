-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "code" TEXT,
ADD COLUMN     "nature" TEXT NOT NULL DEFAULT 'asset';

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

