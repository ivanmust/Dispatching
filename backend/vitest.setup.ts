import "dotenv/config";

// Use a separate test database so integration test data (incidents, etc.)
// never appears in the app's dev database.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
} else {
  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/cad";
  try {
    const u = new URL(url);
    u.pathname = "/cad_test";
    process.env.DATABASE_URL = u.toString();
  } catch {
    process.env.DATABASE_URL = url.replace(/\/[^/]*$/, "/cad_test");
  }
}
