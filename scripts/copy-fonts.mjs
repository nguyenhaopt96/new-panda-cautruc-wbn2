import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve('assets', 'fonts');
const destinationDir = path.resolve('dist', 'fonts');
const fontFiles = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];

fs.mkdirSync(destinationDir, { recursive: true });

for (const fileName of fontFiles) {
  const source = path.join(sourceDir, fileName);
  const destination = path.join(destinationDir, fileName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing bundled font: ${source}`);
  }
  fs.copyFileSync(source, destination);
}
