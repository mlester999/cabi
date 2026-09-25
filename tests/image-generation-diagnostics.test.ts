import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auditRows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({ insert: async (row: Record<string, unknown>) => { mocks.auditRows.push(row); return { error: null }; } }),
  }),
}));

import { imageDiagnosticErrorCategory, logImageDatabaseFailure, persistImageDatabaseFailure, sanitizeImageDatabaseError } from "@/lib/image-generation/diagnostics";

describe("safe image database diagnostics", () => {
  afterEach(() => {
    delete process.env.IMAGE_GENERATION_DIAGNOSTICS;
    mocks.auditRows.length = 0;
    vi.restoreAllMocks();
  });

  it("extracts a safe missing-column detail without preserving the raw database message", () => {
    const result = sanitizeImageDatabaseError({
      code: "42703",
      message: 'column "reference_conditioned" does not exist; prompt was PRIVATE_TEXT and key sk-secret',
      constraint: "image_generations_reference_version_check",
    });
    expect(result).toEqual({
      code: "42703",
      table: "image_generations",
      constraint: "image_generations_reference_version_check",
      column: "reference_conditioned",
      reason: "missing_column",
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TEXT|sk-secret/u);
  });

  it("recognizes PostgREST schema-cache column failures", () => {
    expect(sanitizeImageDatabaseError({
      code: "PGRST204",
      message: "Could not find the 'pipeline_request_id' column of 'image_generations' in the schema cache",
    })).toMatchObject({ code: "PGRST204", table: "image_generations", column: "pipeline_request_id", reason: "missing_column_or_schema_cache" });
  });

  it("drops unsafe text and invalid identifiers from database error objects", () => {
    expect(sanitizeImageDatabaseError({
      code: "not-a-sqlstate-with-secret",
      message: "private row contents and API key sk-secret",
      constraint: "constraint name with spaces and secret",
    })).toEqual({ code: null, table: "image_generations", constraint: null, column: null, reason: "database_write_failed" });
  });

  it("logs only allowlisted metadata when diagnostics are enabled", () => {
    process.env.IMAGE_GENERATION_DIAGNOSTICS = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logImageDatabaseFailure({
      requestId: "trace-safe-id",
      operation: "insert",
      error: { code: "23503", message: "foreign key failed for private wallet contents" },
    });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("23503");
    expect(logged).toContain("foreign_key_violation");
    expect(logged).not.toContain("private wallet contents");
  });

  it("stores structured DB diagnostics without raw database text", async () => {
    await persistImageDatabaseFailure({
      requestId: "trace-safe-id",
      operation: "insert",
      error: {
        code: "PGRST204",
        message: "Could not find the 'pipeline_request_id' column of 'image_generations' in the schema cache; prompt PRIVATE_PROMPT and key sk-secret",
      },
      walletAccountId: "wallet-safe-id",
    });

    expect(mocks.auditRows).toHaveLength(1);
    expect(mocks.auditRows[0]).toMatchObject({
      action: "image_generation.database_failure",
      request_id: "trace-safe-id",
      target_type: "image_generations",
      metadata_json: {
        operation: "insert",
        database: { code: "PGRST204", table: "image_generations", column: "pipeline_request_id", reason: "missing_column_or_schema_cache" },
      },
    });
    expect(JSON.stringify(mocks.auditRows)).not.toMatch(/PRIVATE_PROMPT|sk-secret/u);
  });
});

describe("image HTTP error categories", () => {
  it("does not call every HTTP 400 an unsafe-prompt rejection", () => {
    expect(imageDiagnosticErrorCategory({ httpStatus: 400, error: "PROVIDER_ERROR" })).toBe("provider_error");
    expect(imageDiagnosticErrorCategory({ httpStatus: 400, error: "UNSAFE_PROMPT" })).toBe("unsafe_prompt");
  });
});
