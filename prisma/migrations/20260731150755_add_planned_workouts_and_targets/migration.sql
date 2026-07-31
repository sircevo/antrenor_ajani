-- AlterTable
ALTER TABLE "style_profiles" ADD COLUMN     "dailyCalorieTarget" INTEGER,
ADD COLUMN     "proteinTargetG" INTEGER;

-- CreateTable
CREATE TABLE "planned_workouts" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "exercises" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planned_workouts_date_idx" ON "planned_workouts"("date");
