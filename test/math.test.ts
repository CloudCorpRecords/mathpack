import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  buildGenerateBody,
  checkAllowance,
  generateWorksheetPack,
  listSkills,
  resolveOutDir,
} from "../src/math.js";
import type { FetchFn, FetchResponseLike, FileWriter } from "../src/types.js";

const KEY = "sk-live-KEY-shaped-1234567890";
const FIXED_NOW = () => new Date(2026, 9, 4, 15, 32);
const PDF_BYTES = new TextEncoder().encode("%PDF-fake-bytes");

interface RecordedCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function makeResponse(status: number, body = "", bytes?: Uint8Array): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    arrayBuffer: async () => {
      const data = bytes ?? new TextEncoder().encode(body);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    },
  };
}

function fakeFetch(
  handler: (call: RecordedCall) => FetchResponseLike | Promise<FetchResponseLike>,
): { fetchFn: FetchFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchFn, calls };
}

class FakeWriter implements FileWriter {
  dirs: string[] = [];
  files = new Map<string, Uint8Array>();
  existing = new Set<string>();
  async ensureDir(dir: string): Promise<void> {
    this.dirs.push(dir);
  }
  async exists(p: string): Promise<boolean> {
    return this.existing.has(p) || this.files.has(p);
  }
  async writeFile(p: string, data: Uint8Array): Promise<void> {
    this.files.set(p, data);
  }
}

async function rejectsWith(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, message);
    return true;
  });
}

const authedEnv = { MATHTER_API_KEY: KEY, MATHTER_OUT_DIR: "/tmp/outpacks" };

describe("list_skills", () => {
  it("passes the upstream JSON through and sends no auth header ever", async () => {
    const payload = '{"skills":[{"name":"multiplication","grades":[3,4,5]}]}';
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, payload));
    const out = await listSkills({ fetchFn, env: { MATHTER_API_KEY: KEY } });
    assert.equal(out, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://mathter.ca/api/skills");
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.headers, undefined);
  });

  it("honours a custom base URL with a trailing slash", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "{}"));
    await listSkills({ fetchFn, env: { MATHTER_BASE_URL: "https://example.test/" } });
    assert.equal(calls[0].url, "https://example.test/api/skills");
  });

  it("maps 429 on skills to the public-skill-list sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(429, "slow down"));
    await rejectsWith(listSkills({ fetchFn, env: {} }), "Mathter is rate-limiting the public skill list");
  });

  it("maps 503 to the renderer-busy sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(503, ""));
    await rejectsWith(listSkills({ fetchFn, env: {} }), "The renderer is busy");
  });

  it("maps a throwing fetch to unreachable", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error("socket hangup");
    };
    await rejectsWith(listSkills({ fetchFn, env: {} }), "Mathter is unreachable");
  });

  it("maps another non-2xx to the generic HTTP sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(500, "oops"));
    await rejectsWith(listSkills({ fetchFn, env: {} }), "Mathter error: HTTP 500");
  });
});

describe("check_allowance", () => {
  it("refuses with the pinned sentence when the key is absent, before any request", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "{}"));
    await rejectsWith(checkAllowance({ fetchFn, env: {} }), "MATHTER_API_KEY is not set");
    assert.equal(calls.length, 0);
  });

  it("sends the key as a bearer header and passes the JSON through", async () => {
    const payload = '{"packsLeft":4,"plan":"pro","resetsOn":"2026-11-01"}';
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, payload));
    const out = await checkAllowance({ fetchFn, env: authedEnv });
    assert.equal(out, payload);
    assert.equal(calls[0].url, "https://mathter.ca/api/allowance");
    assert.equal(calls[0].init?.headers?.Authorization, `Bearer ${KEY}`);
  });

  it("maps 401 to the key-not-accepted sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(401, "bad key"));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "Mathter did not accept the API key");
  });

  it("maps 402 to the out-of-credits sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(402, ""));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "Out of worksheet credits for the month");
  });

  it("maps a 403 mentioning credits to the out-of-credits sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(403, "no credits remaining"));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "Out of worksheet credits for the month");
  });

  it("maps a 403 mentioning allowance to the out-of-credits sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(403, "monthly allowance exhausted"));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "Out of worksheet credits for the month");
  });

  it("maps a plain 403 to the not-allowed sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(403, "forbidden"));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "This account is not allowed to generate packs");
  });

  it("maps 429 on allowance to the key rate-limit sentence", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(429, ""));
    await rejectsWith(checkAllowance({ fetchFn, env: authedEnv }), "Mathter is rate-limiting this API key");
  });

  it("does not leak the key when an upstream error body is the key itself", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(500, `failure for key ${KEY}`));
    await assert.rejects(checkAllowance({ fetchFn, env: authedEnv }), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Mathter error: HTTP 500");
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  });

  it("filters the key out of a successful upstream body", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(200, `{"echo":"${KEY}","packsLeft":1}`));
    const out = await checkAllowance({ fetchFn, env: authedEnv });
    assert.ok(!out.includes(KEY));
    assert.ok(out.includes("[redacted]"));
  });
});

describe("generate_worksheet_pack validation", () => {
  it("refuses with the pinned sentence when the key is absent", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await rejectsWith(
      generateWorksheetPack({ skill: "multiplication", grade: 4 }, { fetchFn, env: {}, writer: new FakeWriter() }),
      "MATHTER_API_KEY is not set",
    );
    assert.equal(calls.length, 0);
  });

  it("reports a missing skill by name", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await rejectsWith(
      generateWorksheetPack({ grade: 4 }, { fetchFn, env: authedEnv, writer: new FakeWriter() }),
      "generate_worksheet_pack: missing required argument: skill",
    );
  });

  it("reports a missing grade by name", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await rejectsWith(
      generateWorksheetPack({ skill: "multiplication" }, { fetchFn, env: authedEnv, writer: new FakeWriter() }),
      "generate_worksheet_pack: missing required argument: grade",
    );
  });

  it("rejects a wrong-typed skill", async () => {
    assert.throws(() => buildGenerateBody({ skill: 42, grade: 4 }), {
      message: "generate_worksheet_pack: argument skill has the wrong type",
    });
  });

  it("rejects wrong-typed options by name", async () => {
    for (const [name, value] of [
      ["theme", 7],
      ["worksheetCount", 2.5],
      ["problemsPerPage", "12"],
      ["includeAnswerKeys", "yes"],
      ["focus", "7"],
      ["seed", 1.5],
      ["shopName", true],
    ] as Array<[string, unknown]>) {
      assert.throws(() => buildGenerateBody({ skill: "addition", grade: 2, [name]: value }), {
        message: `generate_worksheet_pack: argument ${name} has the wrong type`,
      });
    }
  });

  it("rejects an out-of-enum style as the wrong type", async () => {
    assert.throws(() => buildGenerateBody({ skill: "addition", grade: 2, style: "neon" }), {
      message: "generate_worksheet_pack: argument style has the wrong type",
    });
  });

  it("rejects grades outside 0-12 and non-integer grades with the grade sentence", async () => {
    for (const grade of [13, -1, 4.5, "4", Number.NaN]) {
      assert.throws(() => buildGenerateBody({ skill: "addition", grade }), {
        message: "grade must be an integer from 0 to 12",
      });
    }
  });

  it("accepts the boundary grades 0 and 12", async () => {
    assert.equal(buildGenerateBody({ skill: "counting", grade: 0 }).grade, 0);
    assert.equal(buildGenerateBody({ skill: "algebra", grade: 12 }).grade, 12);
  });
});

describe("generate_worksheet_pack request shaping", () => {
  it("sends only the provided options plus skill and grade", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await generateWorksheetPack(
      { skill: "multiplication", grade: 4, difficulty: "hard", seed: 9 },
      { fetchFn, env: authedEnv, writer: new FakeWriter(), now: FIXED_NOW },
    );
    assert.deepEqual(JSON.parse(calls[0].init?.body ?? "{}"), {
      skill: "multiplication",
      grade: 4,
      difficulty: "hard",
      seed: 9,
    });
  });

  it("posts to /api/generate with the bearer header and JSON content type", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await generateWorksheetPack(
      { skill: "multiplication", grade: 4 },
      { fetchFn, env: authedEnv, writer: new FakeWriter(), now: FIXED_NOW },
    );
    assert.equal(calls[0].url, "https://mathter.ca/api/generate");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.headers?.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].init?.headers?.["Content-Type"], "application/json");
  });

  it("trims the title at 80 chars before sending", async () => {
    const { fetchFn, calls } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    await generateWorksheetPack(
      { skill: "addition", grade: 1, title: "T".repeat(120) },
      { fetchFn, env: authedEnv, writer: new FakeWriter(), now: FIXED_NOW },
    );
    const body = JSON.parse(calls[0].init?.body ?? "{}") as { title: string };
    assert.equal(body.title.length, 80);
    assert.equal(body.title, "T".repeat(80));
  });

  it("normalises the string chart \"blank\" to {mode:\"blank\"}", async () => {
    const body = buildGenerateBody({ skill: "graphs", grade: 6, chart: "blank" });
    assert.deepEqual(body.chart, { mode: "blank" });
  });

  it("passes an object chart's mode through", async () => {
    const body = buildGenerateBody({ skill: "graphs", grade: 6, chart: { mode: "filled" } });
    assert.deepEqual(body.chart, { mode: "filled" });
  });

  it("rejects other chart shapes as the wrong type", async () => {
    for (const chart of ["filled", { mode: "half" }, 3, ["blank"]]) {
      assert.throws(() => buildGenerateBody({ skill: "graphs", grade: 6, chart }), {
        message: "generate_worksheet_pack: argument chart has the wrong type",
      });
    }
  });
});

describe("generate_worksheet_pack output file", () => {
  it("writes the PDF bytes and returns only the absolute path, with the pinned filename", async () => {
    const writer = new FakeWriter();
    const { fetchFn } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    const out = await generateWorksheetPack(
      { skill: "multiplication", grade: 4 },
      { fetchFn, env: authedEnv, writer, now: FIXED_NOW },
    );
    const expected = path.join("/tmp/outpacks", "mathter-grade-4-multiplication-2026-10-04-1532.pdf");
    assert.equal(out, expected);
    assert.deepEqual(writer.dirs, ["/tmp/outpacks"]);
    assert.deepEqual(writer.files.get(expected), PDF_BYTES);
  });

  it("appends -2, then -3, when the filename is taken", async () => {
    const writer = new FakeWriter();
    const stem = path.join("/tmp/outpacks", "mathter-grade-4-multiplication-2026-10-04-1532");
    writer.existing.add(`${stem}.pdf`);
    writer.existing.add(`${stem}-2.pdf`);
    const { fetchFn } = fakeFetch(() => makeResponse(200, "", PDF_BYTES));
    const out = await generateWorksheetPack(
      { skill: "multiplication", grade: 4 },
      { fetchFn, env: authedEnv, writer, now: FIXED_NOW },
    );
    assert.equal(out, `${stem}-3.pdf`);
    assert.ok(writer.files.has(`${stem}-3.pdf`));
  });

  it("falls back to the Downloads folder under the home dir when no out dir is set", () => {
    const outDir = resolveOutDir({ env: {}, homeDir: "/home/someone" });
    assert.equal(outDir, path.join("/home/someone", "Downloads"));
  });
});

describe("generate_worksheet_pack upstream errors", () => {
  const withStatus = (status: number, body = "") =>
    fakeFetch(() => makeResponse(status, body)).fetchFn;
  const attempt = (fetchFn: FetchFn) =>
    generateWorksheetPack(
      { skill: "multiplication", grade: 4, style: "studio" },
      { fetchFn, env: authedEnv, writer: new FakeWriter(), now: FIXED_NOW },
    );

  it("maps 401 to the key-not-accepted sentence", async () => {
    await rejectsWith(attempt(withStatus(401)), "Mathter did not accept the API key");
  });

  it("maps 402 to the out-of-credits sentence", async () => {
    await rejectsWith(attempt(withStatus(402)), "Out of worksheet credits for the month");
  });

  it("maps a 403 mentioning style to the style sentence", async () => {
    await rejectsWith(
      attempt(withStatus(403, "that style is not on your plan")),
      "That style is not available on this account's plan",
    );
  });

  it("maps a plain 403 to the not-allowed sentence", async () => {
    await rejectsWith(attempt(withStatus(403, "forbidden")), "This account is not allowed to generate packs");
  });

  it("maps 429 on generate to the key rate-limit sentence", async () => {
    await rejectsWith(attempt(withStatus(429)), "Mathter is rate-limiting this API key");
  });

  it("maps 503 to the renderer-busy sentence", async () => {
    await rejectsWith(attempt(withStatus(503)), "The renderer is busy");
  });

  it("maps 400 and 422 to the rejected-configuration sentence", async () => {
    await rejectsWith(attempt(withStatus(400)), "Mathter rejected that configuration");
    await rejectsWith(attempt(withStatus(422)), "Mathter rejected that configuration");
  });

  it("maps another non-2xx to the generic HTTP sentence", async () => {
    await rejectsWith(attempt(withStatus(418, "teapot")), "Mathter error: HTTP 418");
  });

  it("maps a throwing fetch to unreachable and never writes a file", async () => {
    const writer = new FakeWriter();
    const fetchFn: FetchFn = async () => {
      throw new Error("dns failed");
    };
    await rejectsWith(
      generateWorksheetPack(
        { skill: "multiplication", grade: 4 },
        { fetchFn, env: authedEnv, writer, now: FIXED_NOW },
      ),
      "Mathter is unreachable",
    );
    assert.equal(writer.files.size, 0);
  });

  it("does not leak the key from a key-shaped upstream error body on generate", async () => {
    const { fetchFn } = fakeFetch(() => makeResponse(500, `upstream echoed ${KEY}`));
    await assert.rejects(attempt(fetchFn), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  });
});
