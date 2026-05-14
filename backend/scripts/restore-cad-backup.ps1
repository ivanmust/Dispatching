# Restore PostgreSQL custom-format dump (pg_dump -Fc) into the DB from backend/.env
# Usage (from repo root or anywhere):
#   powershell -File backend\scripts\restore-cad-backup.ps1 -DumpPath "C:\path\to\cad-backup.dump"
#
# Default dump path: cad-backup.dump in the dispatch-master repo root (parent of backend).

param(
  [string]$DumpPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "cad-backup.dump")
)

$ErrorActionPreference = "Stop"
$backendDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $backendDir ".env"
if (-not (Test-Path $envFile)) { throw "Missing .env at $envFile" }
if (-not (Test-Path $DumpPath)) { throw "Dump not found: $DumpPath`nCopy cad-backup.dump there or pass -DumpPath." }

$cfg = node -e @"
const fs = require('fs');
const envPath = process.argv[1];
const raw = fs.readFileSync(envPath, 'utf8');
const line = raw.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
if (!line) { console.error('DATABASE_URL missing'); process.exit(1); }
const v = line.slice('DATABASE_URL='.length).trim();
const u = new URL(v.replace(/^postgres:/i, 'http:'));
const db = (u.pathname || '/').replace(/^\//, '') || 'cad';
console.log(JSON.stringify({
  user: decodeURIComponent(u.username || 'postgres'),
  pass: decodeURIComponent(u.password || ''),
  host: u.hostname || 'localhost',
  port: u.port || '5432',
  db
}));
"@ $envFile

if (-not $cfg) { throw "Failed to parse DATABASE_URL" }
$j = $cfg | ConvertFrom-Json

$pgRestore = @(
  "${env:ProgramFiles}\PostgreSQL\18\bin\pg_restore.exe",
  "${env:ProgramFiles}\PostgreSQL\17\bin\pg_restore.exe",
  "${env:ProgramFiles}\PostgreSQL\16\bin\pg_restore.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $pgRestore) {
  throw "pg_restore.exe not found under Program Files\PostgreSQL\{16,17,18}\bin. Add PostgreSQL bin to PATH or install PostgreSQL."
}

$env:PGPASSWORD = $j.pass
Write-Host "Restoring into $($j.db) on $($j.host):$($j.port) as $($j.user) ..."
Write-Host "Using: $pgRestore"
& $pgRestore --clean --if-exists -h $j.host -p $j.port -U $j.user -d $j.db -v $DumpPath
$exit = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($exit -ne 0) { throw "pg_restore exited with $exit" }
Write-Host "Done. Restart the backend and sign in with usernames from the old database."
