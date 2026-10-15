import { isIterable } from "./iterable.js";
// Secret redaction extracted from StarNet; see LICENSE and NOTICE.md.
const SECRET_PATTERNS: [RegExp, string][] = [
  // A MASKED or TRUNCATED key is still part of a key. OpenAI's 401 echoes `Incorrect API key provided:
  // sk-proj-Ab12****…Wx9Z`, and a truncated log line ends `sk-or-v1-abc…`. The mask characters break every
  // full-key pattern below, so the visible head/tail went into diag.errors.json verbatim (reported against
  // 0.12.4). Any vendor-prefixed token that contains a mask run (** / •• / … / ...) is scrubbed whole.
  // The prefix needs its separator, so prose like "skip..." is never touched.
  [
    /\b(?:(?:sk|pk|rk|xai|pplx|glpat|xox[abeprs])-|sk_(?:live|test)_|(?:gsk|hf|gh[pousr]|whk|ntn|lin_api)_|AIza|ya29\.)[-_.A-Za-z0-9]*?(?:[*•]{2,}|…|\.{3})(?:[-_A-Za-z0-9*•…]|\.{3})*/g,
    "[redacted-key]",
  ],
  [
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
    "[redacted-private-key]",
  ],
  [/sk-or-v1-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"], // OpenRouter
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"], // Anthropic
  [/sk-proj-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"], // OpenAI project key
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[redacted-key]"], // Stripe secret/restricted
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g, "[redacted-key]"], // AWS access key id
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted-key]"], // Google credentials use the API key prefix below.
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, "[redacted-key]"], // Google OAuth access token
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, "[redacted-key]"], // Classic GitHub credential
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, "[redacted-key]"], // GitHub fine-grained PAT
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]"], // GitLab PAT
  [/\bxox[abeprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-key]"], // Slack credentials include bot, user, app, refresh and config variants.
  [/\bxapp-\d-[A-Za-z0-9-]{10,}\b/g, "[redacted-key]"], // Slack app-level (Socket Mode) token
  [/\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g, "[redacted-token]"], // Discord bot token
  [/\bsyt_[A-Za-z0-9_]{10,}\b/g, "[redacted-token]"], // Matrix (Synapse) access token
  [/\b1\/\/0[A-Za-z0-9_-]{30,}/g, "[redacted-token]"], // Google OAuth refresh token
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, "[redacted-key]"], // Groq
  [/\bpplx-[A-Za-z0-9]{20,}\b/g, "[redacted-key]"], // Perplexity
  [/\bntn_[A-Za-z0-9]{20,}\b/g, "[redacted-key]"], // Notion integration token
  [/\blin_api_[A-Za-z0-9]{20,}\b/g, "[redacted-key]"], // Linear API key
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[redacted-key]"], // SendGrid
  [/\bwhk_[A-Za-z0-9_-]{20,}/g, "[redacted-secret]"], // StarNet line-trigger webhook credentials live in routing/triggers.js.
  [/\bhf_[A-Za-z0-9]{30,}\b/g, "[redacted-key]"], // HuggingFace
  [/\bxai-[A-Za-z0-9]{20,}\b/g, "[redacted-key]"], // xAI
  [/\bAC[a-f0-9]{32}\b/g, "[redacted-key]"], // Twilio account SID
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]"], // JWT
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, "[redacted-token]"], // Telegram bot credentials used by this app.
  [/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"], // generic OpenAI-style (broad — keep last)
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/g, "Bearer [redacted-key]"], // Authorization header containing a Bearer credential
  // Synthetic/local connectors frequently use ordinary canaries rather than vendor-shaped tokens. Scrub
  // explicit credential assignments too, including URL query strings, so upstream diagnostics cannot turn a
  // `password=...` or `client_secret: ...` value into a credential disclosure.
  // JSON (`"refresh_token": "…"`) and quoted-YAML forms too: the quote between the key and the colon, and the one
  // opening the value, used to stop this rule cold — so `cat codex/tokens.json` reached the model verbatim.
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|bot[_-]?token|webhook[_-]?secret|password|passwd|authorization)\b(["']?\s*[=:]\s*["']?)(?!\[redacted-)[^\s&,;"']{4,}/gi,
    "$1$2[redacted-secret]",
  ],
];
/* KNOWN-VALUE redaction. Shape patterns only catch vendor-shaped secrets; a service key, a custom connector
     token, a Mistral key or a rotated OAuth token has no shape at all. The host (index.js) registers ONE source
     that returns every secret value it currently holds (provider keys, channel tokens, OAuth access/refresh
     tokens, connector tokens/headers/env, service keys, the API/IPC tokens). Every redact() call scrubs those
     exact strings first, so `echo $MY_SERVICE_KEY` in a shell, a server echoing a key in an error body, or a
     token in a log line can never reach the model, the bus, a transcript or diagnostics — whatever its shape.
     The source is read once per top-level redact() call; values shorter than KNOWN_MIN are ignored (too likely
     to collide with ordinary text). A throwing source degrades to shape-only redaction, never to a crash. */
const KNOWN_MIN = 8;
let knownSecretSource: (() => unknown) | null = null;
export function setKnownSecretSource(fn?: (() => unknown) | null) {
  knownSecretSource = typeof fn === "function" ? fn : null;
}
function knownSecrets() {
  if (!knownSecretSource) return null;
  let raw;
  try {
    raw = knownSecretSource();
  } catch {
    return null;
  }
  if (!isIterable(raw)) return null;
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t.length >= KNOWN_MIN && t.indexOf("[redacted-") < 0) seen.add(t);
  }
  if (seen.size === 0) return null;
  // longest first: a key that contains another known key is scrubbed whole, never left as a partial tail
  return Array.from(seen).sort((a, b) => b.length - a.length);
}
function redactStr(input: string, known: string[] | null): string {
  let s = input;
  if (known)
    for (const secret of known)
      if (s.includes(secret)) s = s.split(secret).join("[redacted-secret]");
  for (const [pattern, replacement] of SECRET_PATTERNS) s = s.replace(pattern, replacement);
  return s;
}
const SECRET_FIELD =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|authorization|cookie|credentials?)$/i;
function redactWith(x: unknown, known: string[] | null): unknown {
  if (typeof x === "string") return redactStr(x, known);
  if (Array.isArray(x)) return x.map((v) => redactWith(v, known));
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    // own keys only, and never re-create an object-model key: a parsed '__proto__' member would otherwise
    // re-parent the copy (and an inherited, polluted key would be copied into every redacted payload).
    for (const [k, value] of Object.entries(x)) {
      if (k === "__proto__") continue;
      o[k] = SECRET_FIELD.test(k) ? "[redacted-secret]" : redactWith(value, known);
    }
    return o;
  }
  return x;
}
export function redact(x: string): string;
export function redact(x: unknown): unknown;
export function redact(x: unknown): unknown {
  return redactWith(x, knownSecrets());
}
