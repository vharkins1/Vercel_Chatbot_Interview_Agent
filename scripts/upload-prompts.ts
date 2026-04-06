/**
 * Upload study prompt files to Vercel Blob.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_... npx tsx scripts/upload-prompts.ts
 *
 * This uploads all .txt and .json files from lib/study/prompts/ to
 * Vercel Blob under the "study-prompts/" prefix. Existing files with
 * the same name are overwritten.
 */

import { put } from "@vercel/blob";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const PROMPTS_DIR = join(process.cwd(), "lib", "study", "prompts");
const BLOB_PREFIX = "study-prompts/";

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Error: BLOB_READ_WRITE_TOKEN environment variable is required.");
    console.error("Get it from your Vercel project's Blob storage settings.");
    process.exit(1);
  }

  const files = readdirSync(PROMPTS_DIR).filter(
    (f) => f.endsWith(".txt") || f.endsWith(".json"),
  );

  console.log(`Uploading ${files.length} files to Vercel Blob...\n`);

  for (const file of files) {
    const content = readFileSync(join(PROMPTS_DIR, file), "utf-8");
    const blob = await put(`${BLOB_PREFIX}${file}`, content, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.endsWith(".json") ? "application/json" : "text/plain",
    });
    console.log(`  ✓ ${file} → ${blob.url}`);
  }

  console.log("\nDone! Prompts are now live in Vercel Blob.");
}

main().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
