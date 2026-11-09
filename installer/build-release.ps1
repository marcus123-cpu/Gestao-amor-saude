param([string]$Version = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $root
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'version.txt') -Raw).Trim() }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versão inválida. Use MAJOR.MINOR.PATCH.' }

$buildRoot = [IO.Path]::GetFullPath((Join-Path $root 'build'))
$stage = [IO.Path]::GetFullPath((Join-Path $buildRoot 'stage'))
if (-not $stage.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Pasta de montagem fora do projeto.' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

if (-not (Test-Path 'node_modules\@playwright\cli\playwright-cli.js')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' } }
python -m PyInstaller --noconfirm --clean --onedir --windowed --name AgendaClara --additional-hooks-dir installer\hooks --distpath build\pyinstaller-dist --workpath build\pyinstaller-work --specpath build app.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller falhou.' }
Copy-Item -Path 'build\pyinstaller-dist\AgendaClara\*' -Destination $stage -Recurse -Force

$appFiles = @('index.html','app.js','calendar.js','connection.js','dashboard.js','enhancements.js','operations.js','performance.js','rooms.js','workflow.js',
              'style.css','connection.css','dark.css','operations.css','reference.css','workflow.css','version.txt','Abrir Agenda Clara.ps1')
foreach ($file in $appFiles) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage -Force }
Set-Content -LiteralPath (Join-Path $stage 'version.txt') -Value $Version -Encoding ascii
Copy-Item -LiteralPath 'assets' -Destination (Join-Path $stage 'assets') -Recurse -Force
Copy-Item -LiteralPath 'node_modules' -Destination (Join-Path $stage 'node_modules') -Recurse -Force
$nodeExe = (Get-Command node -ErrorAction Stop).Source
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $stage 'node.exe') -Force

$botRoot = if ($env:AMEI_BOT_DIR) { $env:AMEI_BOT_DIR } else { Join-Path $root 'bot' }
$botDest = Join-Path $stage 'bot'
New-Item -ItemType Directory -Path $botDest -Force | Out-Null
foreach ($file in @('amei_api.js','agenda_overview_amei.js')) {
    $source = Join-Path $botRoot $file
    if (-not (Test-Path -LiteralPath $source)) { throw "Falta $source" }
    Copy-Item -LiteralPath $source -Destination $botDest -Force
}

$browserSource = $env:PLAYWRIGHT_CHROMIUM_DIR
if (-not $browserSource) {
    $browserSource = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'ms-playwright') -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'chrome-win64\chrome.exe') } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $browserSource) {
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $buildRoot 'browsers'
    .\node_modules\.bin\playwright.cmd install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar o Chromium.' }
    $browserSource = Get-ChildItem $env:PLAYWRIGHT_BROWSERS_PATH -Directory -Filter 'chromium-*' |
        Where-Object { Test-Path (Join-Path $_.FullName 'chrome-win64\chrome.exe') } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $browserSource) { throw 'Chromium não encontrado.' }
$browserDest = Join-Path $stage 'browser'
New-Item -ItemType Directory -Path $browserDest -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $browserSource 'chrome-win64') -Destination $browserDest -Recurse -Force

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Instale o Inno Setup 6 para gerar o instalador.' }
& $iscc "/DAppVersion=$Version" 'installer\AgendaClara.iss'
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup falhou.' }
$installer = Join-Path $root "release\AgendaClara-Setup-$Version.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw 'Instalador não gerado.' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$installer.sha256" -Value "$hash  AgendaClara-Setup-$Version.exe" -Encoding ascii
Write-Output "Instalador: $installer"
Write-Output "SHA256: $hash"
