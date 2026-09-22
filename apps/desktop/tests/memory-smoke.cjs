const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'btk-memory-smoke-'));
const output = path.join(root, 'artifacts');

function powershell(script) {
  return execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' }).trim();
}
function sample(pid) {
  return JSON.parse(powershell(`
    $ids = [Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${Number(pid)})
    $all = @(Get-CimInstance Win32_Process)
    $born = ($all | Where-Object ProcessId -eq ${Number(pid)} | Select-Object -First 1).CreationDate
    if (-not $born) { throw 'memory sample root process exited' }
    $all = @($all | Where-Object { $_.CreationDate -ge $born })
    do { $count = $ids.Count; foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while($count -ne $ids.Count)
    $rows = @(foreach($n in $ids) { $p = Get-Process -Id $n -ErrorAction SilentlyContinue; if($p) { [pscustomobject]@{pid=$p.Id;name=$p.ProcessName;started_utc=$p.StartTime.ToUniversalTime().ToString('o');private_bytes=$p.PrivateMemorySize64;working_set_bytes=$p.WorkingSet64;cpu_seconds=$p.CPU} } })
    ConvertTo-Json -InputObject $rows -Compress`));
}
function summarize(rows) {
  return { processes: rows.length, private_mib: +(rows.reduce((n, p) => n + p.private_bytes, 0) / 1048576).toFixed(1),
    app_private_mib: +(rows.filter(p => ['AEGIS Agent Ops Preview', 'btk-desktop-core'].includes(p.name)).reduce((n, p) => n + p.private_bytes, 0) / 1048576).toFixed(1),
    working_set_sum_mib: +(rows.reduce((n, p) => n + p.working_set_bytes, 0) / 1048576).toFixed(1), rows };
}

(async () => {
  const exe = process.env.BTK_DESKTOP_TEST_EXE || path.join(root, 'release/win-unpacked/AEGIS Agent Ops Preview.exe');
  const host = fs.readFileSync(path.join(path.dirname(exe), 'resources/core/btk-agent-runtime.exe'));
  const subsystem = host.readUInt16LE(host.readUInt32LE(0x3c) + 24 + 68);
  assert.equal(subsystem, 2, 'runtime must use Windows GUI subsystem, not a console subsystem');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: exe, args: [`--user-data-dir=${temporary}`], env });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.btk?.native);
    await page.evaluate(() => window.btk.personal.mode('enterprise'));
    await page.evaluate(() => window.btk.snapshot());
    await page.waitForTimeout(5000);
    const first = summarize(sample(app.process().pid));
    await page.waitForTimeout(5000);
    const second = summarize(sample(app.process().pid));
    const agent = await page.evaluate(() => window.btk.agentStatus());
    assert.ok(['stopped', 'unknown'].includes(agent.status), 'never start the operational runtime during a memory test');
    const fingerprints = Buffer.from(JSON.stringify(second.rows)).toString('base64');
    await app.close(); app = null;
    await new Promise(resolve => setTimeout(resolve, 1000));
    const remaining = JSON.parse(powershell(`
      $before = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${fingerprints}')) | ConvertFrom-Json
      $rows = @(foreach($old in $before) { $p = Get-Process -Id $old.pid -ErrorAction SilentlyContinue; if($p -and $p.StartTime.ToUniversalTime().ToString('o') -eq $old.started_utc) { $p.Id } })
      ConvertTo-Json -InputObject $rows -Compress`));
    assert.deepEqual(remaining, [], 'closing the UI must release its Electron and bridge processes');
    const result = { version: require('../package.json').version, measured_at: new Date().toISOString(),
      runtime_pe_subsystem: subsystem, idle_after_5s: first, idle_after_10s: second, ui_processes_after_close: remaining,
      prior_observation: { version: '0.3.0', private_mib: 307.3, comparison: 'Same PC, separate launches; not a controlled production-load benchmark.' },
      service_workload: 'not_started', agent_status: agent.status };
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'memory-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    if (app) await app.close();
    if (path.dirname(temporary) === path.resolve(os.tmpdir())) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
