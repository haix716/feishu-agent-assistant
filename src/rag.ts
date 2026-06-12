import fs from "fs";
import path from "path";
import { config } from "./config";

export interface SearchResult {
  fileName: string;
  folder: string;
  relativePath: string;
}

/**
 * Search local image files by keyword matching on filenames.
 * Images are stored in {IMAGE_SAVE_DIR}/{YYYYMMDD}/{timestamp}_{摘要}.jpg
 */
export function searchImages(query: string, limit = 10): SearchResult[] {
  const baseDir = path.resolve(config.imageSaveDir);
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  // Scan date subdirectories
  let dateFolders: string[];
  try {
    dateFolders = fs.readdirSync(baseDir).filter((name) => {
      const fullPath = path.join(baseDir, name);
      return fs.statSync(fullPath).isDirectory();
    });
  } catch {
    return [];
  }

  for (const folder of dateFolders.sort().reverse()) {
    const folderPath = path.join(baseDir, folder);
    let files: string[];
    try {
      files = fs
        .readdirSync(folderPath)
        .filter((f) => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f));
    } catch {
      continue;
    }

    for (const file of files) {
      // Remove extension and timestamp prefix for matching
      const nameWithoutExt = file.replace(/\.[^.]+$/, "");
      const nameForMatch = nameWithoutExt.replace(/^\d{14}_/, "");

      if (
        nameForMatch.toLowerCase().includes(queryLower) ||
        nameWithoutExt.toLowerCase().includes(queryLower)
      ) {
        results.push({
          fileName: file,
          folder,
          relativePath: `${folder}/${file}`,
        });
      }
    }

    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}
