-- INTEGER tops out at 2 GB, but MAX_UPLOAD_BYTES is operator-tunable, so a
-- legitimately accepted upload could fail its metadata write. Widening only.
ALTER TABLE "File" ALTER COLUMN "size" SET DATA TYPE BIGINT;
