import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PAPERS_DIR = path.join(DATA_DIR, 'papers');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const SEED_DIRS = [
  path.join(DATA_DIR, 'seed-papers'),
  path.join(DATA_DIR, 'seed-papers-v2'),
  path.join(DATA_DIR, 'seed-papers-final')
];

// 1x1 transparent PNG
const DEFAULT_COVER_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function main() {
  console.log('Starting import...');
  
  if (!fs.existsSync(PAPERS_DIR)) {
    fs.mkdirSync(PAPERS_DIR, { recursive: true });
  }

  let index = [];
  if (fs.existsSync(INDEX_FILE)) {
    try {
      index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse existing index, starting fresh.');
    }
  }

  const existingFilenames = new Set(index.map(i => i.originalFilename));
  let count = 0;

  for (const seedDir of SEED_DIRS) {
    if (!fs.existsSync(seedDir)) {
      console.log(`Skipping missing dir: ${seedDir}`);
      continue;
    }

    const files = fs.readdirSync(seedDir);
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.pdf')) continue;
      if (existingFilenames.has(file)) {
        continue;
      }

      const id = crypto.randomUUID();
      const paperDir = path.join(PAPERS_DIR, id);
      fs.mkdirSync(paperDir, { recursive: true });

      const srcPath = path.join(seedDir, file);
      const destPdfPath = path.join(paperDir, 'paper.pdf');
      const destCoverPath = path.join(paperDir, 'cover.png');
      const destMetaPath = path.join(paperDir, 'metadata.json');

      fs.copyFileSync(srcPath, destPdfPath);
      fs.writeFileSync(destCoverPath, DEFAULT_COVER_BUFFER);

      const stats = fs.statSync(srcPath);
      const title = path.basename(file, '.pdf').replace(/_/g, ' ');
      
      const metadata = {
        title,
        originalFilename: file,
        tags: ['seed'],
        uploadedAt: new Date().toISOString(),
        sizeBytes: stats.size
      };

      fs.writeFileSync(destMetaPath, JSON.stringify(metadata, null, 2));

      index.unshift({ id, ...metadata });
      existingFilenames.add(file);
      count++;
    }
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`Import complete. Imported ${count} new papers. Total papers: ${index.length}`);
}

main().catch(console.error);
