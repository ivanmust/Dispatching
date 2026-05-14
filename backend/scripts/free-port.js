const { execSync } = require("node:child_process");

function parsePortArg() {
  const raw = process.argv[2] || "3003";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function unique(values) {
  return [...new Set(values)];
}

function pidsListeningOnWindows(port) {
  const out = execSync("netstat -ano -p tcp", { encoding: "utf8", timeout: 8000 });
  const lines = out.split(/\r?\n/).filter(Boolean);
  const pids = [];
  for (const line of lines) {
    if (!line.includes(`:${port}`)) continue;
    if (!(line.includes("LISTENING") || line.includes("LISTEN"))) continue;
    const cols = line.trim().split(/\s+/);
    const pidRaw = cols[cols.length - 1];
    const pid = Number(pidRaw);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return unique(pids);
}

function pidsListeningOnUnix(port) {
  const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" });
  return unique(
    out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0)
  );
}

function killPid(pid) {
  if (process.platform === "win32") {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    return;
  }
  process.kill(pid, "SIGKILL");
}

function main() {
  const port = parsePortArg();
  let pids = [];
  try {
    pids = process.platform === "win32" ? pidsListeningOnWindows(port) : pidsListeningOnUnix(port);
  } catch {
    // Nothing listening or lookup command not available. Safe to continue.
    return;
  }

  for (const pid of pids) {
    try {
      killPid(pid);
      console.log(`[predev] Freed port ${port} by stopping PID ${pid}`);
    } catch {
      // ignore and continue; dev server startup will still surface conflicts if any remain
    }
  }
}

main();

