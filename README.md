# mathpack

Printable math practice for grades K through 12, without
opening a browser or wrestling a PDF editor. mathpack talks
to the Mathter service and gives you three things: the list
of skills that exist right now and the grades each one
covers, a straight answer about how many packs your
account has left this month, and the pack itself — a PDF
written straight into your output folder, ready to print.

The three tools:

- `list_skills` — which skills are on offer and which
  grades each covers. This list is public, so no API key
  is sent on this call.
- `check_allowance` — how many packs the account has left,
  which plan it is on, and the date the allowance resets.
- `generate_worksheet_pack` — build a pack for one skill
  and grade, with control over theme, style, difficulty,
  title, worksheet and problem counts, answer keys, cover
  and lesson pages, worked solutions, single-number focus
  drills, charts, timed mode, diagrams, blank graphs, unit
  system, and a seed that reproduces an identical pack.
  Only `skill` and `grade` are required.

Generated files are named
`mathter-grade-<grade>-<skill>-<YYYY-MM-DD-HHmm>.pdf`
after the moment they were made, and a name that is
already taken gains a `-2`, `-3`, … suffix — names never
collide, and a finished pack is never overwritten. The
tool answers with the absolute path of the file it wrote,
and nothing else.

## Configuration

```bash
export MATHTER_API_KEY="..."     # required for check_allowance and generate_worksheet_pack
export MATHTER_BASE_URL="https://mathter.ca"   # optional override
export MATHTER_OUT_DIR="/path/to/folder"       # optional; defaults to your Downloads folder
```

The key goes out only as the bearer header of the
allowance and generate calls — never to the public skills
endpoint, never into a file, and never into an answer:
every result and error text is filtered for the key value
before it comes back. When a call fails, the answer is a
plain sentence about what happened: the key was not
accepted, the month's credits are gone, that style is not
on the account's plan, Mathter is rate-limiting, the
renderer is busy, the configuration was rejected, or the
service is unreachable.

## CLI

```bash
npx @reneturcios/mathpack list_skills
npx @reneturcios/mathpack check_allowance
npx @reneturcios/mathpack generate_worksheet_pack '{"skill":"multiplication","grade":4,"title":"Times tables","chart":"blank"}'
npx @reneturcios/mathpack --version
```

The generate subcommand prints the absolute path of the
PDF it wrote. Exit codes: `0` on success, `1` on a runtime
error, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/mathpack mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "mathpack": {
      "command": "npx",
      "args": ["-y", "@reneturcios/mathpack", "mcp"],
      "env": {
        "MATHTER_API_KEY": "..."
      }
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/mathpack
docker run --rm -e MATHTER_API_KEY="..." ghcr.io/cloudcorprecords/mathpack check_allowance
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch, fake writer, fake clock, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
