-- AlterTable
ALTER TABLE "style_profiles" ADD COLUMN     "onboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tone" TEXT;
