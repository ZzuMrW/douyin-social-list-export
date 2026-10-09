[CmdletBinding()]
param([switch]$CheckOnly, [string]$NodePath, [string]$ChromePath)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows 10/11 is required.' }
if ($PSVersionTable.PSVersion -lt [version]'5.1') { throw 'PowerShell 5.1+ is required.' }

function Refresh-TaskPath {
    $taskMachine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $taskUser = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$taskMachine;$taskUser;$env:Path"
}
function Find-TaskNode {
    $taskCandidates = @($NodePath)
    $taskCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($taskCommand) { $taskCandidates += $taskCommand.Source }
    $taskCandidates += @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))
    foreach ($taskCandidate in ($taskCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $taskCandidate -PathType Leaf)) { continue }
        try {
            $taskProbe = & $taskCandidate -e 'console.log(JSON.stringify({version:process.versions.node,ok:Number(process.versions.node.split(".")[0])>=22&&typeof fetch==="function"&&typeof WebSocket==="function"}))' 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $taskInfo = $taskProbe | ConvertFrom-Json
            if ($taskInfo.ok) { return @{ path = $taskCandidate; version = $taskInfo.version } }
        } catch { continue }
    }
    return $null
}
function Find-TaskChrome {
    $taskCandidates = @($ChromePath)
    $taskCommand = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($taskCommand) { $taskCandidates += $taskCommand.Source }
    foreach ($taskRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($taskRoot) { $taskCandidates += Join-Path $taskRoot 'Google\Chrome\Application\chrome.exe' }
    }
    foreach ($taskCandidate in ($taskCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $taskCandidate -PathType Leaf) {
            return @{ path = $taskCandidate; version = (Get-Item -LiteralPath $taskCandidate).VersionInfo.ProductVersion }
        }
    }
    return $null
}
function Install-TaskDependency([string]$PackageId) {
    $taskWinget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $taskWinget) {
        throw "Missing $PackageId; WinGet unavailable. Official installers: https://nodejs.org/ and https://www.google.com/chrome/ . WinGet: https://learn.microsoft.com/windows/package-manager/winget/ ."
    }
    Write-Host "Installing missing dependency: $PackageId"
    & $taskWinget.Source install --id $PackageId --exact --source winget --silent --disable-interactivity | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "WinGet failed for $PackageId (exit $LASTEXITCODE). Resolve reported permissions, network or agreements; security settings were not changed." }
    Refresh-TaskPath
}
$taskNode = Find-TaskNode
$taskChrome = Find-TaskChrome
$taskMissing = @()
if (-not $taskNode) { $taskMissing += 'Node.js 22+ with global fetch/WebSocket' }
if (-not $taskChrome) { $taskMissing += 'Google Chrome' }
if (-not $CheckOnly) {
    if (-not $taskNode) { Install-TaskDependency 'OpenJS.NodeJS.LTS'; $taskNode = Find-TaskNode }
    if (-not $taskChrome) { Install-TaskDependency 'Google.Chrome'; $taskChrome = Find-TaskChrome }
    if (-not $taskNode -or -not $taskChrome) { throw 'Installed runtime discovery failed. Reopen shell or pass -NodePath / -ChromePath.' }
    $taskMissing = @()
}
[ordered]@{
    ready = [bool]($taskNode -and $taskChrome)
    checkOnly = [bool]$CheckOnly
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    nodePath = if ($taskNode) { $taskNode.path } else { $null }
    nodeVersion = if ($taskNode) { $taskNode.version } else { $null }
    chromePath = if ($taskChrome) { $taskChrome.path } else { $null }
    chromeVersion = if ($taskChrome) { $taskChrome.version } else { $null }
    wingetAvailable = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
    missing = @($taskMissing)
    npmDependencies = @()
} | ConvertTo-Json -Depth 4
