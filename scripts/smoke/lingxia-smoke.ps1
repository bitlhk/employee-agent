param(
  [string]$BaseUrl = $env:SMOKE_BASE_URL,
  [string]$AdoptId = $env:SMOKE_ADOPT_ID,
  [string]$SessionCookie = $env:SMOKE_SESSION_COOKIE,
  [string]$ReportDir = $env:SMOKE_REPORT_DIR,
  [switch]$Headed
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:15180" }
if (-not $AdoptId) { $AdoptId = "lgc-ofnmjm4joj" }
if (-not $ReportDir) { $ReportDir = "tests/smoke/employee-agent/reports" }

$env:SMOKE_BASE_URL = $BaseUrl
$env:SMOKE_ADOPT_ID = $AdoptId
$env:SMOKE_REPORT_DIR = $ReportDir
if ($SessionCookie) { $env:SMOKE_SESSION_COOKIE = $SessionCookie }
if ($Headed) { $env:SMOKE_HEADED = "1" }

node tests/smoke/employee-agent/playwright-runner.mjs
