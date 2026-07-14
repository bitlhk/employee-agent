const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Wraps legacy plaintext secrets so they cannot leak through stringification,
 * JSON serialization, or console inspection. The raw value is only available
 * inside the synchronous `use` closure.
 */
export class SecretHandle {
  private constructor(private readonly value: string) {}

  static of(raw: string | null | undefined): SecretHandle | null {
    if (!raw) return null;
    return new SecretHandle(raw);
  }

  use<T>(fn: (raw: string) => T): T {
    return fn(this.value);
  }

  toString(): string {
    return "[REDACTED]";
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  valueOf(): string {
    return "[REDACTED]";
  }

  [INSPECT_CUSTOM](): string {
    return "[REDACTED]";
  }
}
