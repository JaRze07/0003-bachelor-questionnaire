// CLI: node dist/backup.js <target-file>
// Online backup of the live database from a second, read-only connection. Safe while the server runs and
// correct in WAL mode, where copying `bachelor.db` alone would miss whatever is still in the -wal file.
import { DatabaseSync, backup } from 'node:sqlite';

const target = process.argv[2];
if (!target) { console.error('usage: node dist/backup.js <target-file>'); process.exit(2); }
const source = new DatabaseSync(process.env.DB_PATH ?? './data/bachelor.db', { readOnly: true });
await backup(source, target);
source.close();
console.log(`backup written: ${target}`);
