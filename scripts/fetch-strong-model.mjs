// Downloads KataGo's 9×9 network (98 MB) from the official KataGo release, verifies it and
// splits it into parts under public/models/kata9x9/ (GitHub Pages serves files < 100 MB, and
// the KataGo download server does not allow browser (CORS) downloads, so we self-host).
// Not committed to git: run in CI before the build, or locally when needed.
//
//   node scripts/fetch-strong-model.mjs [path/to/already-downloaded.bin.gz]

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const URL_ = 'https://github.com/lightvector/KataGo/releases/download/v1.13.2-kata9x9/kata9x9-b18c384nbt-20231025.bin.gz';
const SHA256 = 'a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61';
const SIZE = 97878277;
const PART = 25_000_000;
const OUT = path.resolve(import.meta.dirname, '..', 'public', 'models', 'kata9x9');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function existingOk() {
  try {
    const m = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    return m.sha256 === SHA256;
  } catch {
    return false;
  }
}

async function download() {
  // The release server sometimes cuts long downloads: resume with Range requests.
  const chunks = [];
  let got = 0;
  for (let attempt = 0; attempt < 20 && got < SIZE; attempt++) {
    try {
      const res = await fetch(URL_, { headers: got ? { Range: `bytes=${got}-` } : {} });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
      }
    } catch (e) {
      console.warn(`download interrupted at ${got} bytes (${e.message}), retrying`);
    }
  }
  return Buffer.concat(chunks);
}

async function main() {
  if (await existingOk()) {
    console.log('kata9x9 network already prepared');
    return;
  }
  const local = process.argv[2];
  const data = local ? await readFile(local) : await download();
  if (data.length !== SIZE || sha(data) !== SHA256) throw new Error(`network checksum mismatch (${data.length} bytes)`);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const parts = [];
  for (let off = 0, i = 0; off < data.length; off += PART, i++) {
    const name = `part-${i}.bin`;
    await writeFile(path.join(OUT, name), data.subarray(off, off + PART));
    parts.push(name);
  }
  const manifest = {
    name: 'kata9x9-b18c384nbt-20231025',
    source: URL_,
    sha256: SHA256,
    size: SIZE,
    parts,
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`kata9x9 network ready: ${parts.length} parts, ${SIZE} bytes`);
}

await main();
