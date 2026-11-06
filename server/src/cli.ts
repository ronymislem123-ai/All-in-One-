import { loadConfig } from './config';
import { createContext } from './bootstrap';
import { createBackup, listBackups, offlineRestore, verifyBackup } from './modules/backup';
import { seedDemo } from './seed/demo';

const HELP = `OMEGA Infinity – Kommandozeile
  backup [Notiz]                                Verifizierte Sicherung erstellen
  backups                                       Sicherungen auflisten
  verify <name>                                 Sicherung prüfen (Prüfsumme + Integrität)
  restore-offline <name> --server-gestoppt      Notfall-Wiederherstellung bei GESTOPPTEM Server
                                                (aktuelle Datenbank wird beiseitegelegt, nicht gelöscht)
  seed-demo                                     Beispielprojekt anlegen (nur bei leerer Bibliothek)`;

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();

if (cmd === 'restore-offline') {
  if (!args[0] || !args.includes('--server-gestoppt')) {
    console.error('Bitte zuerst den Server stoppen und dann ausführen:\n  restore-offline <sicherungsname> --server-gestoppt');
    process.exit(2);
  }
  try {
    const r = await offlineRestore(config, args[0]);
    console.log(`Wiederhergestellt aus ${r.restored}.`);
    console.log(r.previous ? `Bisherige Datenbank aufbewahrt als ${r.previous}` : 'Es gab keine bisherige Datenbank.');
    console.log(`Inhalt: ${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    process.exit(0);
  } catch (e) {
    console.error(`Wiederherstellung abgebrochen: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}

const ctx = await createContext(config);
try {
  switch (cmd) {
    case 'backup': {
      const meta = await createBackup(ctx, 'manual', args.join(' ') || 'CLI-Sicherung');
      console.log(`Sicherung erstellt: ${meta.name} (${meta.size} Bytes, ${meta.encrypted ? 'verschlüsselt' : 'unverschlüsselt'})`);
      break;
    }
    case 'backups':
      for (const b of listBackups(ctx)) console.log(`${b.createdAt}  ${b.kind.padEnd(14)} ${b.verified?.ok ? 'OK ' : '?? '} ${b.name}`);
      break;
    case 'verify': {
      if (!args[0]) throw new Error('Name der Sicherung fehlt:  verify <name>');
      const m = await verifyBackup(ctx, args[0]);
      console.log(`${m.verified?.ok ? 'OK' : 'FEHLER'} – ${m.verified?.detail ?? 'keine Angabe'}`);
      if (!m.verified?.ok) process.exitCode = 1;
      break;
    }
    case 'seed-demo':
      console.log(seedDemo(ctx));
      break;
    default:
      console.log(HELP);
      process.exitCode = 2;
  }
} catch (e) {
  console.error(`Fehler: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  ctx.db.close();
}
