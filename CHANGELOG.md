# Changelog

## 0.1.0 (2026-10-27)

- Initial release: three MCP tools and matching CLI
  subcommands over the Mathter service — `list_skills`
  (the public skill list, no key sent), `check_allowance`
  (packs left, plan, and reset date for the account), and
  `generate_worksheet_pack` (build a worksheet pack and
  write the returned PDF to the output folder under a
  collision-proof timestamped name).
- The API key is sent only as a bearer header on the
  allowance and generate calls and is filtered out of
  every result and error text.
