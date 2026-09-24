// Offline asset conversion only; Sharp is not an application dependency.
// See assets/branding/README.md for the pinned, temporary tool installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require(path.resolve(process.argv[2]));

async function generate() {
  const directory = fileURLToPath(new URL('../assets/branding', import.meta.url));
  const source = await fs.readFile(path.join(directory, 'langtify-wordmark.svg'), 'utf8');
  const light = await sharp(Buffer.from(source)).trim().png().toBuffer();
  const dark = await sharp(Buffer.from(source.replaceAll('#5b5cf6', '#8b8cff')))
    .trim()
    .png()
    .toBuffer();
  for (const [name, input] of [
    ['light', light],
    ['dark', dark],
  ]) {
    await sharp(input).toFile(path.join(directory, `wordmark-${name}.png`));
    const foreground = await sharp(input).resize({ width: 640 }).png().toBuffer();
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
      .composite([{ input: foreground, gravity: 'centre' }])
      .png()
      .toFile(path.join(directory, `foreground-${name}.png`));
  }
  const foreground = path.join(directory, 'foreground-light.png');
  await sharp(foreground)
    .flatten({ background: '#FFFFFF' })
    .toFile(path.join(directory, 'icon.png'));
  await sharp(foreground).tint('#FFFFFF').toFile(path.join(directory, 'monochrome.png'));
  await sharp(path.join(directory, 'icon.png'))
    .resize(64, 64)
    .toFile(path.join(directory, 'favicon.png'));
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
