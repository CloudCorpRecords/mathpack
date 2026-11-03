/**
 * mathpack types.
 *
 * Three tools over the Mathter service: a public skill list,
 * an account allowance check, and worksheet-pack generation
 * that writes a PDF to disk. Upstream access, file writing,
 * the clock and the environment are all injectable so the
 * core can be tested with fakes and no network.
 */

/** Arguments for generate_worksheet_pack; only skill and grade are required. */
export interface GenerateArgs {
  skill?: unknown;
  grade?: unknown;
  theme?: unknown;
  style?: unknown;
  difficulty?: unknown;
  title?: unknown;
  worksheetCount?: unknown;
  problemsPerPage?: unknown;
  includeAnswerKeys?: unknown;
  includeCover?: unknown;
  includeLesson?: unknown;
  workedSolutions?: unknown;
  focus?: unknown;
  focusOrder?: unknown;
  chart?: unknown;
  timed?: unknown;
  diagrams?: unknown;
  graphBlank?: unknown;
  unitSystem?: unknown;
  shopName?: unknown;
  seed?: unknown;
  [key: string]: unknown;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Injectable file writer, so tests can use an in-memory fake. */
export interface FileWriter {
  /** Create the directory (and parents) if it does not exist. */
  ensureDir(dir: string): Promise<void>;
  /** Whether a file already exists at the path. */
  exists(path: string): Promise<boolean>;
  /** Write bytes to the path. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

/** Runtime dependencies for the core, all injectable in tests. */
export interface MathDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** File writer. Defaults to node:fs/promises. */
  writer?: FileWriter;
  /** Clock used for the output filename timestamp. */
  now?: () => Date;
  /** Environment (MATHTER_* variables). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Home directory override, used to resolve the default out dir. */
  homeDir?: string;
}
