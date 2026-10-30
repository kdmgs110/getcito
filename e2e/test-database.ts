/** Tests must only connect to a local database. */
export function testDatabaseUrl(): string {
  const value = process.env.E2E_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/getcito";
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("E2E_DATABASE_URL must point to a local test database");
  }
  return value;
}
