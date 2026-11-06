import type { Ctx } from '../context';
import { createApp } from '../modules/apps';
import { categoryIdBySlug } from '../modules/categories';
import { createNode } from '../modules/nodes';

/**
 * Optional starter content (CLI `npm run seed:demo`): OMEGA Infinity describes itself, with module code paths
 * that match this repository – handy to try the Code Explorer and the code status right away.
 * Only runs on an empty project library.
 */
export function seedDemo(ctx: Ctx): string {
  if (ctx.db.get(`SELECT 1 FROM nodes WHERE deleted_at IS NULL LIMIT 1`)) return 'Projektbibliothek ist nicht leer – keine Beispieldaten angelegt.';
  const meta = { actor: 'user' as const };
  const project = createNode(ctx, meta, {
    kind: 'project', name: 'OMEGA Infinity', summary: 'Persönliches digitales Betriebssystem – Projektzentrale, App Library, Idea Hub, Code Explorer.',
    description: 'Zentrale Plattform für alle Projekte, Ideen und Anwendungen. Claude bleibt die Entwicklungsumgebung, GitHub die Quelle der Codebasis.',
    categoryId: categoryIdBySlug(ctx, 'web-apps'), lifecycleStatus: 'in_development', priority: 0, progress: 70, icon: 'orbit', color: '#8b93ff', favorite: true,
    tags: ['omega', 'plattform'],
  });
  const mods: [string, string, string, 'technical' | 'organizational'][] = [
    ['Server & API', 'server/src', 'Hono-Server, Datenbank, Domänenmodule und Integrationen', 'technical'],
    ['Web-Oberfläche', 'web/src', 'React-Oberfläche mit Designsystem', 'technical'],
    ['MCP-Server', 'mcp/src', 'Brücke von Claude Code zur Ingest-API', 'technical'],
    ['Gemeinsames Domänenmodell', 'shared/src', 'Statusmodell und Ingest-Schema', 'technical'],
    ['Dokumentation', 'docs', 'Architektur, Entscheidungen, Bedienungsanleitung', 'organizational'],
  ];
  for (const [name, codePath, summary, nature] of mods) {
    const m = createNode(ctx, meta, { kind: 'module', parentId: project.id, name, codePath, summary, nature, lifecycleStatus: 'in_development' });
    if (name === 'Server & API') {
      for (const [sub, p] of [['Backup & Restore', 'server/src/modules/backup.ts'], ['Claude-Ingest', 'server/src/modules/ingest.ts'], ['GitHub-Integration', 'server/src/modules/github']]) {
        createNode(ctx, meta, { kind: 'submodule', parentId: m.id, name: sub, codePath: p, nature: 'technical', lifecycleStatus: 'in_development' });
      }
    }
  }
  createApp(ctx, meta, { name: 'AI Idea Hub', kind: 'internal', nodeId: project.id, launchUrl: '/ideas', summary: 'Ideenbibliothek mit 144 kuratierten Ideen', icon: 'lightbulb', color: '#f2b84b', features: ['36 Kategorien', 'Entdeckungsmodi', 'Idee → Projekt'] });
  return 'Beispielprojekt „OMEGA Infinity“ mit Modulen und einer internen App angelegt.';
}
