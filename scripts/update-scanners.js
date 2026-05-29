import fs from 'fs';
import path from 'path';

const scannersDir = 'src/scanners';
const files = fs.readdirSync(scannersDir).filter(f => f.endsWith('.ts') && f !== 'index.ts');

for (const file of files) {
  const filePath = path.join(scannersDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes('supportedLanguages')) continue;

  const replaceStr = file === 'jest.ts' ? `supportedLanguages: ['node'],\n  async run` : `supportedLanguages: 'all',\n  async run`;
  content = content.replace(/async run/, replaceStr);
  fs.writeFileSync(filePath, content);
}

console.log('Bulk updated scanners with supportedLanguages.');