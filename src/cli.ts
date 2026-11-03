#!/usr/bin/env node
/**
 * mathpack CLI.
 *
 *   mathpack list_skills
 *   mathpack check_allowance
 *   mathpack generate_worksheet_pack '<json>'
 *   mathpack mcp
 *   mathpack --version
 *
 * Each tool subcommand takes one JSON argument string with
 * the tool's arguments and prints the tool's text result:
 * the upstream JSON for the read tools, the written PDF
 * path for generation. Exit codes: 0 success, 1 runtime
 * error, 2 usage error.
 */
import { checkAllowance, generateWorksheetPack, listSkills, VERSION } from "./math.js";

const TOOL_NAMES = ["list_skills", "check_allowance", "generate_worksheet_pack"] as const;

function usage(): never {
  console.error(`Usage:
  mathpack <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  mathpack mcp
  mathpack --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "list_skills":
      return listSkills();
    case "check_allowance":
      return checkAllowance();
    case "generate_worksheet_pack":
      return generateWorksheetPack(args);
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
