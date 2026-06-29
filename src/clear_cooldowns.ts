import { getDatabase } from './core/database.js';

async function main() {
  try {
    const db = getDatabase();
    const result = db.prepare('UPDATE accounts SET cooldown_until = 0, cooldown_reason = NULL').run();
    console.log(`[Script] Cooldowns limpiados. Cuentas afectadas: ${result.changes}`);
    process.exit(0);
  } catch (err: any) {
    console.error('[Script] Error al limpiar cooldowns:', err.message);
    process.exit(1);
  }
}

main();
