/**
 * mathpack core: three tools over the Mathter service.
 *
 * - list_skills asks the public endpoint which skills exist
 *   and which grades each covers. No API key is ever sent on
 *   that call.
 * - check_allowance reports how many packs the account has
 *   left, its plan, and the reset date.
 * - generate_worksheet_pack posts the provided options (plus
 *   the required skill and grade), receives PDF bytes, and
 *   writes them into the output directory under
 *   mathter-grade-<grade>-<skill>-<YYYY-MM-DD-HHmm>.pdf,
 *   appending -2, -3, ... when a name is already taken. The
 *   result text is the absolute path of the written file,
 *   and nothing else.
 *
 * The key is sent only as the Authorization bearer header
 * of the allowance and generate calls, and every piece of
 * result or error text is filtered for the key value before
 * it leaves this module. Upstream failures map onto the
 * documented sentences; a throwing fetch is "unreachable".
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  FetchFn,
  FetchResponseLike,
  FileWriter,
  GenerateArgs,
  MathDeps,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://mathter.ca";

type ToolKind = "skills" | "allowance" | "generate";

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

function envOf(deps: MathDeps): Record<string, string | undefined> {
  return deps.env ?? process.env;
}

function apiKey(deps: MathDeps): string | undefined {
  const key = envOf(deps).MATHTER_API_KEY;
  return key !== undefined && key !== "" ? key : undefined;
}

function baseUrl(deps: MathDeps): string {
  const raw = envOf(deps).MATHTER_BASE_URL;
  const base = raw !== undefined && raw !== "" ? raw : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

function requireKey(deps: MathDeps): string {
  const key = apiKey(deps);
  if (key === undefined) throw new Error("MATHTER_API_KEY is not set");
  return key;
}

async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

function fetchFn(deps: MathDeps): FetchFn {
  return deps.fetchFn ?? defaultFetch;
}

const defaultWriter: FileWriter = {
  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  },
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  async writeFile(p: string, data: Uint8Array): Promise<void> {
    await fs.writeFile(p, data);
  },
};

function writerOf(deps: MathDeps): FileWriter {
  return deps.writer ?? defaultWriter;
}

/** Remove every occurrence of the API key from a text about to be returned. */
export function filterKey(text: string, key: string | undefined): string {
  if (key === undefined || key === "") return text;
  return text.split(key).join("[redacted]");
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Map an upstream status (and, for 403s, its body) onto the
 * documented sentence for that outcome.
 */
export function errorSentence(kind: ToolKind, status: number, body: string): string {
  if (status === 401 && kind !== "skills") {
    return "Mathter did not accept the API key";
  }
  if (status === 402) return "Out of worksheet credits for the month";
  if (status === 403) {
    const lower = body.toLowerCase();
    if (lower.includes("credit") || lower.includes("allowance")) {
      return "Out of worksheet credits for the month";
    }
    if (lower.includes("style")) {
      return "That style is not available on this account's plan";
    }
    return "This account is not allowed to generate packs";
  }
  if (status === 429) {
    return kind === "skills"
      ? "Mathter is rate-limiting the public skill list"
      : "Mathter is rate-limiting this API key";
  }
  if (status === 503) return "The renderer is busy";
  if (status === 400 || status === 422) return "Mathter rejected that configuration";
  return `Mathter error: HTTP ${status}`;
}

interface UpstreamResult {
  res: FetchResponseLike;
  /** Error body text, read only when the status was not ok. */
  errorBody: string;
}

async function callUpstream(
  deps: MathDeps,
  kind: ToolKind,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<UpstreamResult> {
  const key = apiKey(deps);
  let res: FetchResponseLike;
  try {
    res = await fetchFn(deps)(url, init);
  } catch {
    throw new Error(filterKey("Mathter is unreachable", key));
  }
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    throw new Error(filterKey(errorSentence(kind, res.status, body), key));
  }
  return { res, errorBody: "" };
}

/* ------------------------------------------------------------------ */
/* 1. list_skills                                                      */
/* ------------------------------------------------------------------ */

export async function listSkills(deps: MathDeps = {}): Promise<string> {
  const { res } = await callUpstream(deps, "skills", `${baseUrl(deps)}/api/skills`, {
    method: "GET",
  });
  const text = await res.text();
  return filterKey(text, apiKey(deps));
}

/* ------------------------------------------------------------------ */
/* 2. check_allowance                                                  */
/* ------------------------------------------------------------------ */

export async function checkAllowance(deps: MathDeps = {}): Promise<string> {
  const key = requireKey(deps);
  const { res } = await callUpstream(deps, "allowance", `${baseUrl(deps)}/api/allowance`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return filterKey(text, key);
}

/* ------------------------------------------------------------------ */
/* 3. generate_worksheet_pack                                          */
/* ------------------------------------------------------------------ */

const STRING_OPTIONS = ["theme", "title", "focusOrder", "shopName"] as const;
const INTEGER_OPTIONS = ["worksheetCount", "problemsPerPage", "seed"] as const;
const BOOLEAN_OPTIONS = [
  "includeAnswerKeys",
  "includeCover",
  "includeLesson",
  "workedSolutions",
  "timed",
  "diagrams",
  "graphBlank",
] as const;
const ENUM_OPTIONS: Record<string, readonly string[]> = {
  style: ["modern", "classic", "notebook", "studio", "ledger", "blueprint"],
  difficulty: ["easy", "medium", "hard"],
  unitSystem: ["metric", "imperial"],
};

function wrongType(name: string): Error {
  return new Error(`generate_worksheet_pack: argument ${name} has the wrong type`);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Validate the raw argument bag and build the exact JSON body
 * to send: only the provided options, plus skill and grade,
 * with the title trimmed at 80 chars and a string chart
 * normalised to { "mode": "blank" }.
 */
export function buildGenerateBody(args: GenerateArgs): Record<string, unknown> {
  if (args.skill === undefined || args.skill === null) {
    throw new Error("generate_worksheet_pack: missing required argument: skill");
  }
  if (args.grade === undefined || args.grade === null) {
    throw new Error("generate_worksheet_pack: missing required argument: grade");
  }
  if (typeof args.skill !== "string") throw wrongType("skill");
  if (!isInteger(args.grade) || args.grade < 0 || args.grade > 12) {
    throw new Error("grade must be an integer from 0 to 12");
  }

  const body: Record<string, unknown> = { skill: args.skill, grade: args.grade };

  for (const name of STRING_OPTIONS) {
    const value = args[name];
    if (value === undefined) continue;
    if (typeof value !== "string") throw wrongType(name);
    body[name] = name === "title" ? value.slice(0, 80) : value;
  }
  for (const name of INTEGER_OPTIONS) {
    const value = args[name];
    if (value === undefined) continue;
    if (!isInteger(value)) throw wrongType(name);
    body[name] = value;
  }
  for (const name of BOOLEAN_OPTIONS) {
    const value = args[name];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw wrongType(name);
    body[name] = value;
  }
  for (const [name, allowed] of Object.entries(ENUM_OPTIONS)) {
    const value = args[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || !allowed.includes(value)) throw wrongType(name);
    body[name] = value;
  }
  if (args.focus !== undefined) {
    if (typeof args.focus !== "number") throw wrongType("focus");
    body.focus = args.focus;
  }
  if (args.chart !== undefined) {
    body.chart = normaliseChart(args.chart);
  }
  return body;
}

function normaliseChart(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === "blank") return { mode: "blank" };
    throw wrongType("chart");
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const mode = (value as Record<string, unknown>).mode;
    if (mode === "filled" || mode === "blank") return { mode };
    throw wrongType("chart");
  }
  throw wrongType("chart");
}

/** Resolve the output directory: MATHTER_OUT_DIR, else Downloads, else temp. */
export function resolveOutDir(deps: MathDeps): string {
  const env = envOf(deps);
  const configured = env.MATHTER_OUT_DIR;
  if (configured !== undefined && configured !== "") return path.resolve(configured);
  const home = deps.homeDir ?? os.homedir();
  if (home) return path.join(home, "Downloads");
  return os.tmpdir();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The timestamp segment of the output filename, in local time. */
export function timestampSegment(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

export async function generateWorksheetPack(
  args: GenerateArgs,
  deps: MathDeps = {},
): Promise<string> {
  const key = requireKey(deps);
  const body = buildGenerateBody(args);
  const { res } = await callUpstream(deps, "generate", `${baseUrl(deps)}/api/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());

  const writer = writerOf(deps);
  const outDir = resolveOutDir(deps);
  await writer.ensureDir(outDir);

  const now = (deps.now ?? (() => new Date()))();
  const stem = `mathter-grade-${String(body.grade)}-${String(body.skill)}-${timestampSegment(now)}`;
  let candidate = path.join(outDir, `${stem}.pdf`);
  let suffix = 2;
  while (await writer.exists(candidate)) {
    candidate = path.join(outDir, `${stem}-${suffix}.pdf`);
    suffix += 1;
  }
  await writer.writeFile(candidate, bytes);
  return filterKey(candidate, key);
}
