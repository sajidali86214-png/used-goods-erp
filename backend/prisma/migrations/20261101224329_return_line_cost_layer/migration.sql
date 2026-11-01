-- AlterTable
ALTER TABLE "ReturnLine" ADD COLUMN     "costLayerId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "CostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

