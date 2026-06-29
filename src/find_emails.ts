import fs from 'fs';
import path from 'path';

function findFile(dir: string, fileName: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Evitar node_modules y .git
        if (file !== 'node_modules' && file !== '.git' && file !== 'venv' && file !== '.agents') {
          results = results.concat(findFile(fullPath, fileName));
        }
      } else if (file.toLowerCase() === fileName.toLowerCase()) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    // ignorar
  }
  return results;
}

const found = findFile('d:\\Rstudio', 'emails.json');
console.log('Archivos emails.json encontrados:', found);
