import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

// 360x480 placeholder PNG (avoids 1x1 "broken" thumbnails for seed imports)
const DEFAULT_COVER_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAWgAAAHgCAYAAACIBvdgAAAFQElEQVR42u3UoQ0AIRREQfovD4HCkKDwd8FB6OITRswWsOKlXOoCIJ50pvUBQCACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAjwb6+ycAgQg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaQKABEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaGcACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMItEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAIt0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBogCsDDUA8Gwg3tuje8X9vAAAAAElFTkSuQmCC',
  'base64'
);

function resolveCovergenPython(rootDir) {
  if (process.env.COVERGEN_PYTHON) return process.env.COVERGEN_PYTHON;
  const venvPython = path.join(rootDir, 'server_py', 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  const py3 = '/usr/bin/python3';
  if (fs.existsSync(py3)) return py3;
  return null;
}

function tryGenerateCover(rootDir, pdfPath, outPngPath) {
  const python = resolveCovergenPython(rootDir);
  const script = path.join(rootDir, 'server_py', 'covergen.py');
  if (!python || !fs.existsSync(script) || !fs.existsSync(pdfPath)) return false;

  const res = spawnSync(python, [script, pdfPath, outPngPath, '--max-width', '640'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe']
  });
  if (res.status === 0) return true;

  const stderr = (res.stderr || '').trim();
  if (stderr) console.warn('covergen failed:', stderr);
  return false;
}

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
      if (!tryGenerateCover(ROOT_DIR, destPdfPath, destCoverPath)) {
        fs.writeFileSync(destCoverPath, DEFAULT_COVER_BUFFER);
      }

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
