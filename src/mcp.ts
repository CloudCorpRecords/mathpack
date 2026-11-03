/**
 * mathpack MCP server. Tools: list_skills, check_allowance,
 * generate_worksheet_pack.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item: the upstream JSON
 * for the two read tools, and the absolute path of the
 * written PDF for generation. Failures come back as isError
 * results carrying the documented error sentences.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  checkAllowance,
  generateWorksheetPack,
  listSkills,
  VERSION,
} from "./math.js";

const TOOLS = [
  {
    name: "list_skills",
    description:
      "Asks mathter.ca which skills exist right now and which grades each one covers. No key is sent — that list is public.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "check_allowance",
    description:
      "Tells you how many packs your account has left, which plan it is on, and the date the allowance resets.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "generate_worksheet_pack",
    description:
      "Makes the pack. Only `skill` and `grade` are required; everything else has a sensible default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chart: {
          anyOf: [
            { type: "string" },
            {
              properties: {
                mode: { enum: ["filled", "blank"], type: "string" },
              },
              required: ["mode"],
              type: "object",
            },
          ],
          description:
            "The string \"blank\", or an object { \"mode\": \"filled\" | \"blank\" }; the string form is normalised to { \"mode\": \"blank\" } before sending.",
        },
        diagrams: { description: "Include diagrams.", type: "boolean" },
        difficulty: {
          description: "Difficulty. Defaults to medium.",
          enum: ["easy", "medium", "hard"],
          type: "string",
        },
        focus: {
          description: "Single-number drill, e.g. the 7 times table.",
          type: "number",
        },
        focusOrder: { description: "Order for the focus drill.", type: "string" },
        grade: { description: "Grade, 0 (kindergarten) to 12.", type: "integer" },
        graphBlank: { description: "Include blank graphs.", type: "boolean" },
        includeAnswerKeys: {
          description: "Include answer keys. On by default.",
          type: "boolean",
        },
        includeCover: { description: "Include a cover page.", type: "boolean" },
        includeLesson: { description: "Include a lesson page.", type: "boolean" },
        problemsPerPage: {
          description: "Problems per page. Defaults to 12.",
          type: "integer",
        },
        seed: {
          description: "Seed to reproduce an identical pack.",
          type: "integer",
        },
        shopName: { description: "Shop name printed on the pack.", type: "string" },
        skill: {
          description:
            "The skill to drill, e.g. multiplication; must be one list_skills returns.",
          type: "string",
        },
        style: {
          description: "Pack style.",
          enum: ["modern", "classic", "notebook", "studio", "ledger", "blueprint"],
          type: "string",
        },
        theme: {
          description: "One of ten colour palettes. Defaults to teal.",
          type: "string",
        },
        timed: { description: "Timed drill mode.", type: "boolean" },
        title: {
          description: "Pack title. Defaults to Math Lesson; trimmed at 80 chars.",
          type: "string",
        },
        unitSystem: {
          description: "Unit system.",
          enum: ["metric", "imperial"],
          type: "string",
        },
        workedSolutions: { description: "Include worked solutions.", type: "boolean" },
        worksheetCount: {
          description: "Number of worksheets in the pack.",
          type: "integer",
        },
      },
      required: ["skill", "grade"],
    },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "mathpack", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "list_skills":
        out = await listSkills();
        break;
      case "check_allowance":
        out = await checkAllowance();
        break;
      case "generate_worksheet_pack":
        out = await generateWorksheetPack(a);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
