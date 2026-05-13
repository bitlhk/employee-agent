import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { SecretHandle } from "../../../../shared/lib/secret-handle";

describe("SecretHandle", () => {
  it("redacts toString and toJSON", () => {
    const secret = SecretHandle.of("super-secret-token")!;

    expect(String(secret)).toBe("[REDACTED]");
    expect(secret.toJSON()).toBe("[REDACTED]");
    expect(JSON.stringify({ auth: secret })).not.toContain("super-secret-token");
    expect(JSON.stringify({ auth: secret })).toContain("[REDACTED]");
  });

  it("redacts node inspect / console-style formatting", () => {
    const secret = SecretHandle.of("console-secret")!;

    expect(inspect({ auth: secret })).not.toContain("console-secret");
    expect(inspect({ auth: secret })).toContain("[REDACTED]");
  });

  it("only exposes the raw value inside use()", () => {
    const secret = SecretHandle.of("raw-token")!;

    const seen = secret.use((raw) => `Bearer ${raw}`);

    expect(seen).toBe("Bearer raw-token");
  });
});
