$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $env:LOCALAPPDATA 'AgendaClara\data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$env:AGENDA_CLARA_DATA_DIR = $dataDir
$env:AGENDA_CLARA_NODE = Join-Path $appDir 'node.exe'
$env:AGENDA_CLARA_BROWSER_EXE = Join-Path $appDir 'browser\chrome-win64\chrome.exe'

function Test-LocalPanel {
    try {
        $response = Invoke-WebRequest 'http://127.0.0.1:8777/api/state' -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

if (-not (Test-LocalPanel)) {
    try {
        $localVersion = [version]((Get-Content (Join-Path $appDir 'version.txt') -Raw).Trim())
        $release = Invoke-RestMethod 'https://api.github.com/repos/marcus123-cpu/Gestao-amor-saude/releases/latest' -Headers @{ 'User-Agent'='AgendaClara-Updater'; 'Accept'='application/vnd.github+json' } -TimeoutSec 8
        $remoteVersion = [version]($release.tag_name -replace '^v','')
        if ($remoteVersion -gt $localVersion) {
            $asset = $release.assets | Where-Object { $_.name -eq "AgendaClara-Setup-$remoteVersion.exe" } | Select-Object -First 1
            $sumAsset = $release.assets | Where-Object { $_.name -eq "AgendaClara-Setup-$remoteVersion.sha256" } | Select-Object -First 1
            if ($asset -and $sumAsset) {
                $download = Join-Path $env:TEMP "AgendaClara-Setup-$remoteVersion.exe"
                $sumDownload = "$download.sha256"
                Invoke-WebRequest $asset.browser_download_url -OutFile $download -TimeoutSec 300
                Invoke-WebRequest $sumAsset.browser_download_url -OutFile $sumDownload -TimeoutSec 30
                $expected = ((Get-Content $sumDownload -Raw).Trim() -split '\s+')[0].ToUpperInvariant()
                $actual = (Get-FileHash $download -Algorithm SHA256).Hash.ToUpperInvariant()
                if ($expected -ne $actual) { throw 'A assinatura de integridade da atualização não confere.' }
                $updated = Start-Process -FilePath $download -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
                if ($updated.ExitCode -ne 0) { throw "O instalador retornou $($updated.ExitCode)." }
            }
        }
    } catch {
        # Sem internet ou Release: abre a versão instalada. Dados locais não são tocados.
    }
    Start-Process -FilePath (Join-Path $appDir 'AgendaClara.exe') -WorkingDirectory $appDir -WindowStyle Hidden | Out-Null
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        if (Test-LocalPanel) { break }
        Start-Sleep -Milliseconds 500
    }
}
Start-Process 'http://127.0.0.1:8777/'
