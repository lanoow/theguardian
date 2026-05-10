import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(dir, fileName, defaults) {
    this.dir = dir;
    this.filePath = path.join(dir, fileName);
    this.defaults = defaults;
    fs.mkdirSync(dir, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.filePath)) {
      this.write(this.defaults);
      return structuredClone(this.defaults);
    }

    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) return structuredClone(this.defaults);
    return JSON.parse(raw);
  }

  write(value) {
    fs.writeFileSync(this.filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  update(mutator) {
    const value = this.read();
    const next = mutator(value) ?? value;
    this.write(next);
    return next;
  }
}
