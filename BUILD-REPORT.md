# mathpack — Build Report (Batch 21)

Rebuild of the `mathter-mcp` MCP server (npm `mathter-mcp`,
registry `ca.mathter/mathter`) from the firsthand spec in
`specs-batch21/mathpack.md`. Built 2026-10-27.

## Identity

- npm: `@reneturcios/mathpack` @ 0.1.0, bin `mathpack` → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/mathpack`
  (matches `package.json` `mcpName`, `server.json` `name`, and
  the Dockerfile `io.modelcontextprotocol.server.name` label)
- server.json description (94 chars, verified):
  "Printable K-12 math worksheet packs from Mathter: skills list,
  allowance, and pack generation."
- server.json: npm package entry carries `"version": "0.1.0"`;
  the OCI entry (`ghcr.io/cloudcorprecords/mathpack:0.1.0`)
  carries **no** `version` field.

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/swissreg/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md (fresh
prose), LICENSE (MIT, © 2026 Rene Turcios), CHANGELOG.md
(single 0.1.0 entry dated 2026-10-27), src/index.ts,
src/cli.ts, src/mcp.ts, src/types.ts, src/math.ts (core),
test/math.test.ts, and the four workflows under
.github/workflows/ (publish-container adapted:
IMAGE ghcr.io/cloudcorprecords/mathpack, smoke assertion on
server name `mathpack`). Plus this BUILD-REPORT.md.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`), explicit
  JSON-schema literals for all 3 tools (list_skills,
  check_allowance, generate_worksheet_pack); no McpServer/zod.
  Tool descriptions are the fixture's; per-property
  descriptions, enums, the chart anyOf shape and the
  `required: ["skill","grade"]` list are exactly the fixture's;
  `required` is present only on generate_worksheet_pack.
- `src/math.ts`: wires GET /api/skills with NO auth header
  ever, GET /api/allowance and POST /api/generate with the
  key only as `Authorization: Bearer <key>`; the upstream JSON
  of the two read tools passes through as the text result.
  Every result and error text is filtered for the key value
  before returning. The exact status→sentence error mapping
  from the spec's troubleshooting table is implemented
  (key absent, 401, 402 / 403-with-credits-or-allowance-body,
  403-with-style-body, other 403, 429 split by public vs keyed
  call, 503, 400/422, other non-2xx as `Mathter error:
  HTTP <status>`, throwing fetch as unreachable). Grade is
  validated as an integer 0–12 with the pinned sentence;
  missing and wrong-typed arguments use the pinned
  per-argument sentences. The title is trimmed at 80 chars
  before sending; the chart string `"blank"` is normalised
  to `{"mode":"blank"}`; only provided options are sent,
  plus skill and grade. Generation writes the returned PDF
  bytes through an injectable writer into the out dir
  (created if missing) under
  `mathter-grade-<grade>-<skill>-<YYYY-MM-DD-HHmm>.pdf`
  in local time from the injectable clock, with `-2`/`-3`
  collision suffixes; the result text is the absolute
  written path and nothing else. Configuration comes from
  MATHTER_API_KEY / MATHTER_BASE_URL (default
  https://mathter.ca) / MATHTER_OUT_DIR (default the user's
  Downloads folder, or the system temp folder when there is
  none).
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version`; unknown subcommand → usage on
  stderr, exit 2; isError results exit 1.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`: exit 0.
- `npm test`: **43 tests, 43 pass, 0 fail** — fake fetch +
  fake writer + fake clock only, never a live network call.
  Covers every pinned error sentence, key filtering
  (including a key-shaped upstream error body asserting the
  key does not leak, and filtering of a successful body),
  no-auth on skills, bearer auth on allowance/generate,
  chart normalisation (string and object), title trim at
  80 chars, only-provided-options request shaping, grade
  boundaries 0 and 12, the exact output filename from the
  fake clock, and the `-2`/`-3` collision suffixes.
- `node dist/cli.js --version`: `0.1.0`; unknown command
  (`nonsense`): usage on stderr, exit 2.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/mathter-mcp-tools-original.json --rebuild
  "stdio:node builds/mathpack/dist/cli.js mcp" --out
  builds/mathpack/parity-out` → **verdict=PASS
  parity_pct=100.0, 3/3 tools, no schema diffs**.
- Lockfile: Route 3 only — clean temp dir with package.json
  alone, `npm install --package-lock-only --ignore-scripts
  --offline`; parses, name `@reneturcios/mathpack`, **128
  package entries**. Dependencies installed in the build dir
  with `npm install --offline --ignore-scripts`.

## Gaps / deviations (verbatim from the spec)

- The original refuses to START without a key; the rebuild
  starts and answers per-tool with the pinned sentence, so
  `list_skills` (which needs no key) still works — recorded
  deviation.
- Endpoint paths (`/api/skills`, `/api/allowance`,
  `/api/generate`) and the PDF-bytes response shape are
  documented reconstructions: the README pins `POST
  https://mathter.ca/api/generate` and calls the client "a
  thin HTTP client over two endpoints", but does not print
  the other two paths. The status→sentence mapping is a
  reconstruction keyed on the README's pinned sentences.
- No live call was made; behaviour is proven against fake
  fetch only.
- server.json description (94 chars, measured): "Printable
  K-12 math worksheet packs from Mathter: skills list,
  allowance, and pack generation."
- No push, no publish.
