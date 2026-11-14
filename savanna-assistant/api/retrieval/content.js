import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONTENT_DIR = join(HERE, '..', '..', 'content');

// Each content/*.json file is an array of:
// { id, lang: "en"|"am", title, text, url, topic }
export function loadPassages(dir = DEFAULT_CONTENT_DIR) {
  const passages = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const list = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const p of list) {
      if (!p.id || !p.lang || !p.title || !p.text) throw new Error(`Bad passage in ${file}: ${JSON.stringify(p).slice(0, 80)}`);
      passages.push({ url: '', topic: '', ...p });
    }
  }
  return passages;
}