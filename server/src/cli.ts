import { loadConfig } from './config';
import { createContext } from './bootstrap';
import { createBackup, listBackups, verifyBackup } from './modules/backup';
import { seedDemo } from './seed/demo';

const [cmd, ...args] = process.argv.slice(2);
const ctx = await createContext(loadConfig());
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
      const m = await verifyBackup(ctx, args[0]);
      console.log(m.verified);
      break;
    }
    case 'seed-demo':
      console.log(seedDemo(ctx));
      break;
    default:
      console.log('Befehle: backup [Notiz] | backups | verify <name> | seed-demo');
  }
} finally {
  ctx.db.close();
}
