import { z } from "zod";

/**
 * Filenames arrive from the client and are echoed straight back into a
 * Content-Disposition header, so path separators become dashes and control
 * characters (which could forge a response header) are dropped before the name
 * reaches the database or S3.
 */
const sanitize = (name: string) =>
  name.replace(/[/\\]/g, "-").replace(/[\u0000-\u001f\u007f]/g, "");

export const filename = z
  .string()
  .trim()
  .min(1, "Name cannot be empty")
  .max(255, "Name cannot be longer than 255 characters")
  .transform(sanitize)
  .refine((s) => s.length > 0 && s !== "." && s !== "..", "Name is not a valid filename");
