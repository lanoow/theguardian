import { loadConfig, resolveStoragePath } from './config.js';
import { JsonStore } from '../services/json-store.js';

export function createContext() {
  const config = loadConfig();
  const dataDir = resolveStoragePath(config, 'dataDir');
  const transcriptDir = resolveStoragePath(config, 'transcriptDir');

  return {
    config,
    dataDir,
    transcriptDir,
    stores: {
      tickets: new JsonStore(dataDir, 'tickets.json', { tickets: [] }),
      polls: new JsonStore(dataDir, 'polls.json', { polls: [] }),
      stats: new JsonStore(dataDir, 'stats.json', { channels: {}, snapshots: {} }),
    },
  };
}
