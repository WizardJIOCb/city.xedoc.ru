param([string]$Server = 'myserver')
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9_.@-]+$' -or $Server.StartsWith('-')) { throw 'Invalid SSH destination.' }
$project = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $project
try {
    $changes = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit all project changes before deploying.' }
    $releaseId = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $releaseId -notmatch '^[0-9a-f]{40}$') { throw 'Cannot read commit.' }
    $remoteLine = & git ls-remote https://github.com/WizardJIOCb/city.xedoc.ru.git refs/heads/main
    if ($LASTEXITCODE -ne 0 -or ($remoteLine -split '\s+')[0] -ne $releaseId) { throw 'Push this commit to GitHub main first.' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
    $metadata = @{ version = $package.version; commit = $releaseId; builtAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $project 'dist/version.json'), $metadata, (New-Object Text.UTF8Encoding $false))
    New-Item -ItemType Directory -Path (Join-Path $project 'work') -Force | Out-Null
    $archive = Join-Path $project "work/$releaseId.tar.gz"
    & tar.exe -czf $archive -C (Join-Path $project 'dist') .
    if ($LASTEXITCODE -ne 0) { throw 'Cannot package release.' }
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    & ssh -o BatchMode=yes -o ConnectTimeout=12 $Server 'mkdir -p /var/www/city.xedoc.ru/incoming /var/www/city.xedoc.ru/releases'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create deployment directories.' }
    & scp -o BatchMode=yes $archive "${Server}:/var/www/city.xedoc.ru/incoming/$releaseId.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Archive upload failed.' }
    & scp -o BatchMode=yes (Join-Path $PSScriptRoot 'activate-release.sh') "${Server}:/var/www/city.xedoc.ru/activate-release.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Activation script upload failed.' }
    $remoteHash = & ssh -o BatchMode=yes $Server "sha256sum /var/www/city.xedoc.ru/incoming/$releaseId.tar.gz"
    if ($LASTEXITCODE -ne 0 -or ($remoteHash -split '\s+')[0] -ne $archiveHash) { throw 'Uploaded archive checksum does not match.' }
    & ssh -o BatchMode=yes $Server "bash /var/www/city.xedoc.ru/activate-release.sh $releaseId"
    if ($LASTEXITCODE -ne 0) { throw 'Activation failed; inspect the remote output.' }
    $live = Invoke-RestMethod -Uri "https://city.xedoc.ru/version.json?release=$releaseId" -TimeoutSec 20
    if ($live.commit -ne $releaseId) { throw 'Public HTTPS release verification failed.' }
    $geo = Invoke-RestMethod -Uri 'https://city.xedoc.ru/api/geo/health' -TimeoutSec 15
    if (-not $geo.ok) { throw 'Public map API verification failed.' }
    Write-Host "Live: https://city.xedoc.ru/ ($releaseId)"
} finally {
    Pop-Location
}
