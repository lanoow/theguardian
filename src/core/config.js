import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

function readYaml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(raw) ?? {};
}

export function loadConfig() {
  const bot = readYaml(path.join(CONFIG_DIR, 'bot.yml'));
  const moduleDir = path.join(CONFIG_DIR, 'modules');
  const modules = {};

  for (const fileName of fs.readdirSync(moduleDir)) {
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) continue;
    const key = path.basename(fileName, path.extname(fileName));
    modules[key] = readYaml(path.join(moduleDir, fileName));
  }

  return {
    ...bot,
    modules,
  };
}

export function resolveStoragePath(config, key) {
  const dir = config.storage?.[key];
  return path.resolve(process.cwd(), dir ?? (key === 'dataDir' ? 'data' : 'transcripts'));
}
