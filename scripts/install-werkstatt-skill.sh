#!/usr/bin/env bash
# Installs the "werkstatt" skill and its hooks for ALL Claude Code sessions of this user (any repository, any chat).
#   bash scripts/install-werkstatt-skill.sh
# What it does: copies .claude/skills/werkstatt to ~/.claude/skills/werkstatt and merges the SessionStart /
# UserPromptSubmit hooks into ~/.claude/settings.json (existing settings are preserved). Re-run to update.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$HERE/.claude/skills/werkstatt"
DST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$DST/skills"
rm -rf "$DST/skills/werkstatt"
cp -R "$SRC" "$DST/skills/werkstatt"
# user-level reminder must not depend on the project dir
REMINDER="$DST/skills/werkstatt/REMINDER.md"
sed -i.bak "s#\`.claude/skills/werkstatt/SKILL.md\`#\`~/.claude/skills/werkstatt/SKILL.md\`#" "$REMINDER" && rm -f "$REMINDER.bak"
SETTINGS="$DST/settings.json"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
node - "$SETTINGS" "$REMINDER" <<'EOF'
const fs = require('fs');
const [file, reminder] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
s.hooks = s.hooks || {};
const cmd = `cat "${reminder}" 2>/dev/null || true`;
for (const ev of ['SessionStart', 'UserPromptSubmit']) {
  const list = (s.hooks[ev] = s.hooks[ev] || []);
  const has = list.some((g) => (g.hooks || []).some((h) => h.type === 'command' && String(h.command).includes('werkstatt/REMINDER.md')));
  if (!has) list.push({ hooks: [{ type: 'command', command: cmd, ...(ev === 'SessionStart' ? { statusMessage: 'Werkstatt wird vorbereitet' } : {}) }] });
}
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
console.log(`Hooks eingetragen in ${file}`);
EOF
echo "Skill installiert: $DST/skills/werkstatt"
echo "Ab der nächsten Claude-Code-Sitzung (jedes Repository, jeder Chat) wird die Werkstatt automatisch geöffnet und mitgeführt."
echo "Prüfen: in Claude Code /hooks öffnen oder /werkstatt eingeben."
