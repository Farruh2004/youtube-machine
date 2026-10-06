# YouTube Machine — yangilash.
# Manba "update-source.txt" faylida: "<egasi>/<repozitoriy> <branch>". Ochiq repozitoriy tokensiz yuklanadi,
# yopiq bo'lsa GitHub token so'raladi. "data" papkasi (kalitlar, kanallar, videolar) hech qachon o'zgarmaydi.
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$apiBase = if ($env:YTM_GITHUB_API) { $env:YTM_GITHUB_API } else { 'https://api.github.com' }
$here = (Get-Location).Path

$source = 'Farruh2004/youtube-machine main'
if (Test-Path 'update-source.txt') { $source = ('' + (Get-Content 'update-source.txt' -Raw)).Trim() }
$repo, $ref = $source -split '\s+', 2
if (-not $ref) { $ref = 'main' }

function Read-Token {
  $t = ''
  if (Test-Path 'data/db.json') { try { $t = '' + (Get-Content 'data/db.json' -Raw -Encoding UTF8 | ConvertFrom-Json).settings.githubToken } catch { } }
  if (-not $t.Trim() -and (Test-Path 'data/github-token.txt')) { $t = '' + (Get-Content 'data/github-token.txt' -Raw) }
  return $t.Trim()
}

function Get-Status($headers) {
  try { Invoke-RestMethod -Uri "$apiBase/repos/$repo" -Headers $headers -UseBasicParsing | Out-Null; return 200 }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { throw } }
}

$h = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'youtube-machine' }
$token = Read-Token
if ($token) { $h.Authorization = "Bearer $token" }
$code = Get-Status $h

if ($code -ne 200 -and -not $token) {
  # Yopiq repozitoriy: token kerak
  Write-Host ''
  Write-Host "Repozitoriy ($repo) yopiq - GitHub token kerak. Uni shu yerga joylang (sichqonchaning ong tugmasi), keyin Enter:"
  $token = ('' + (Read-Host 'Token')).Trim()
  if (-not $token) { throw 'Token kiritilmadi' }
  New-Item -ItemType Directory -Force 'data' | Out-Null
  Set-Content 'data/github-token.txt' $token
  $h.Authorization = "Bearer $token"
  $code = Get-Status $h
}

if ($code -ne 200) {
  Remove-Item 'data/github-token.txt' -Force -ErrorAction SilentlyContinue
  Write-Host ''
  if ($code -eq 401) { Write-Host 'TOKEN NOTOGRI yoki muddati tugagan.' -ForegroundColor Yellow }
  else { Write-Host "Bu token $repo repozitoriyasini kora olmayapti." -ForegroundColor Yellow }
  Write-Host 'Yangi token oling: github.com/settings/tokens/new - faqat "repo" katagini belgilang.'
  Write-Host 'Eski token ochirildi - yangilash.bat ni qayta bosing, token qayta soraladi.'
  Write-Host 'Agar token API kalitlar sahifasida kiritilgan bolsa, uni u yerda ham almashtiring.'
  exit 2
}

$tempRoot = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
$zip = Join-Path $tempRoot 'ytm-update.zip'
$tmp = Join-Path $tempRoot 'ytm-update'
Invoke-WebRequest -Uri "$apiBase/repos/$repo/zipball/$ref" -Headers $h -OutFile $zip -UseBasicParsing
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force

# Dastur arxiv ildizida (ochiq repozitoriy) yoki youtube-machine papkasida (archref) bo'lishi mumkin
$app = $null
foreach ($d in Get-ChildItem $tmp -Directory) {
  foreach ($c in @((Join-Path $d.FullName 'youtube-machine'), $d.FullName)) {
    if (-not $app -and (Test-Path (Join-Path $c 'server.js'))) { $app = $c }
  }
}
if (-not $app) { throw 'Arxivda dastur topilmadi' }

if (Get-Command robocopy -ErrorAction SilentlyContinue) {
  robocopy $app $here /E /XD data /XF yangilash.bat /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw ('Nusxalashda xato: ' + $LASTEXITCODE) }
} else {
  Get-ChildItem $app -Force | Where-Object { $_.Name -ne 'data' -and $_.Name -ne 'yangilash.bat' } | Copy-Item -Destination $here -Recurse -Force
}
# Ishlab turgan yangilash.bat'ni o'zi almashtira olmaydi — yangisi yonida qoladi, bat oxirida almashtiradi
$nb = Join-Path $app 'yangilash.bat'
if (Test-Path $nb) { Copy-Item $nb (Join-Path $here 'yangilash.new.bat') -Force }
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
exit 0
