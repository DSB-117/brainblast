import { describe, it, expect } from "vitest";
import { SupabaseVtiStore } from "../src/contrib/store.ts";

// A minimal in-memory PostgREST emulator: enough of Supabase's REST surface for
// the store's insert (ignore-duplicates) / has / list calls.
function mockSupabase() {
  const rows = new Map<string, any>();
  const fetchImpl = (async (input: any, init?: any) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

    if (method === "POST") {
      const items = JSON.parse(init.body);
      const inserted: any[] = [];
      for (const it of items) {
        if (!rows.has(it.trap_id)) {
          rows.set(it.trap_id, it.record); // record jsonb = the full vti
          inserted.push({ trap_id: it.trap_id });
        }
        // else: ignore-duplicates → not returned
      }
      return json(inserted, 201);
    }

    // GET
    const trapEq = url.searchParams.get("trap_id"); // "eq.<id>"
    if (trapEq) {
      const id = trapEq.replace(/^eq\./, "");
      return json(rows.has(id) ? [{ trap_id: id }] : []);
    }
    // list select=record
    return json([...rows.values()].map((record) => ({ record })));
  }) as unknown as typeof fetch;

  return { fetchImpl, rows };
}

describe("SupabaseVtiStore (PostgREST over fetch)", () => {
  function store() {
    const { fetchImpl } = mockSupabase();
    return new SupabaseVtiStore({ url: "https://proj.supabase.co", key: "service-role", fetchImpl });
  }

  it("inserts once and is idempotent at the database (ignore-duplicates)", async () => {
    const s = store();
    expect((await s.insert({ trapId: "a", title: "first" })).inserted).toBe(true);
    const dup = await s.insert({ trapId: "a", title: "retry" });
    expect(dup.inserted).toBe(false);
    expect(dup.reason).toMatch(/already present/i);
  });

  it("has() reflects presence and list() returns the full records", async () => {
    const s = store();
    expect(await s.has("x")).toBe(false);
    await s.insert({ trapId: "x", class: "unconfirmed-state" });
    await s.insert({ trapId: "y", class: "auth-bypass" });
    expect(await s.has("x")).toBe(true);
    const all = await s.list();
    expect(all.map((r) => r.trapId).sort()).toEqual(["x", "y"]);
    expect(all.find((r) => r.trapId === "x")?.class).toBe("unconfirmed-state");
  });

  it("rejects a record with no trapId without calling the DB", async () => {
    const s = store();
    expect((await s.insert({} as any)).inserted).toBe(false);
  });

  it("surfaces a DB error as a non-insert reason (does not throw)", async () => {
    const failing = new SupabaseVtiStore({
      url: "https://proj.supabase.co",
      key: "k",
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" }) as Response) as unknown as typeof fetch,
    });
    const r = await failing.insert({ trapId: "a" });
    expect(r.inserted).toBe(false);
    expect(r.reason).toMatch(/500/);
  });
});
