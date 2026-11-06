/**
 * Secret protection for the read-only Code Explorer (§14.5, §20.1).
 * 1) Sensitive files are never served at all (isSecretPath).
 * 2) Served text is scanned and secret-looking values are replaced (redactSecrets).
 */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.(?!example$|sample$|template$|dist$)[^/]+$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.(npmrc|pypirc|netrc|git-credentials|htpasswd)$/i,
  /(^|\/)(credentials|secrets?|service[-_]?account)[^/]*\.(json|ya?ml|toml|ini|txt)$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.ssh\//i,
  /\.tfstate(\.backup)?$/i,
];

export function isSecretPath(path: string): boolean {
  return SECRET_FILE_PATTERNS.some((re) => re.test(path));
}

const PLACEHOLDER = /^(\$\{.*\}|process\.env|os\.environ|env\(|<.*>|x{3,}|\*{3,}|changeme|change-me|your[-_].*|example.*|placeholder|dummy|test|null|none|undefined|todo)$/i;

const TOKEN_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '«privater Schlüssel entfernt»'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '«GitHub-Token entfernt»'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '«GitHub-Token entfernt»'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, '«API-Schlüssel entfernt»'],
  [/\bsk-[A-Za-z0-9]{32,}\b/g, '«API-Schlüssel entfernt»'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '«AWS-Schlüssel entfernt»'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '«Slack-Token entfernt»'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '«API-Schlüssel entfernt»'],
  [/\b(sk|rk)_(live|test)_[0-9a-zA-Z]{16,}\b/g, '«API-Schlüssel entfernt»'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '«Token entfernt»'],
];

const ASSIGNMENT = /((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)["']?\s*[:=]\s*)(["'`])([^"'`\n]{6,})\2/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]{3,})(@)/gi;

export function redactSecrets(text: string): { text: string; redactions: number } {
  let count = 0;
  let out = text;
  for (const [re, label] of TOKEN_PATTERNS) {
    out = out.replace(re, () => { count++; return label; });
  }
  out = out.replace(ASSIGNMENT, (m, prefix: string, q: string, value: string) => {
    if (PLACEHOLDER.test(value.trim()) || value.startsWith('«')) return m;
    count++;
    return `${prefix}${q}«entfernt»${q}`;
  });
  out = out.replace(URL_CREDENTIALS, (m, a: string, pw: string, b: string) => {
    if (PLACEHOLDER.test(pw)) return m;
    count++;
    return `${a}«entfernt»${b}`;
  });
  return { text: out, redactions: count };
}
