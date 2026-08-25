<#
  Prove the US exit from THIS side — run on the operator machine, after verify-exit.sh passes there.

  ---------------------------------------------------------------------------
  WHY BOTH SIDES CHECK, WHEN THE HOST ALREADY RAN THE SAME TESTS

  The two machines cannot see the same failures.

  The host proves the daemon authenticates and egresses locally. It CANNOT prove the port is
  private, because from the host every address is reachable — a proxy bound to 0.0.0.0 and a
  proxy bound to the tailnet look identical from localhost.

  This side proves the opposite pair: that the tunnel carries the connection, that the exit is
  genuinely US, and — the one that matters — that an anonymous request from a *different*
  machine is still refused. An open proxy discovered from here is a real discovery; discovered
  from localhost it is a guess.

  ---------------------------------------------------------------------------
  WHAT THIS DELIBERATELY DOES NOT DO

  It does not judge the exit. `redbot proxy vet` does that, over 8 samples and 6 hours, and it is
  the only thing whose PASS may be acted on. A green run here means "worth vetting", never "ready
  to sign in through". The stability question in particular cannot be answered in one burst:
  the whole reason the vet window is hours long is that a rotating pool holds one address for
  minutes at a time.

  Usage:
    $env:REDBOT_PROXY_PASS='...'
    pwsh tools/exit/verify-exit.ps1 -ProxyHost 100.64.0.2 -Port 8888 -User redbot

  The password comes from the environment, never a parameter — a password passed as an argument
  lands in the process list and in PSReadLine history.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $ProxyHost,
  [int] $Port = 8888,
  [string] $User = 'redbot'
)

$ErrorActionPreference = 'Stop'
$proxy = "http://${ProxyHost}:${Port}"
$whoami = 'https://api.ipify.org'
$plain = 'http://example.com/'
$geoApi = 'http://ip-api.com/json/{0}?fields=status,query,country,countryCode,regionName,city,isp,as,proxy,hosting'

$failed = $false
function Pass($m) { Write-Host "  PASS  $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:failed = $true }
function Warn($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }

if (-not $env:REDBOT_PROXY_PASS) {
  Write-Host "REDBOT_PROXY_PASS is not set. Set it in the environment, not as a parameter:"
  Write-Host "  `$env:REDBOT_PROXY_PASS='...'"
  exit 2
}

$cred = [pscredential]::new($User, (ConvertTo-SecureString $env:REDBOT_PROXY_PASS -AsPlainText -Force))

Write-Host ''
Write-Host "Checking the exit at $proxy"
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '1. The tunnel carries a connection'
try {
  $tcp = [System.Net.Sockets.TcpClient]::new()
  $reached = $tcp.ConnectAsync($ProxyHost, $Port).Wait(8000)
  $tcp.Close()
  if ($reached) { Pass "$ProxyHost`:$Port answers" }
  else { Fail "nothing answered at $ProxyHost`:$Port within 8s. Is the tailnet up (tailscale status) and the US machine awake?" }
} catch {
  Fail "could not reach $ProxyHost`:$Port — $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# THE CHECK THAT MATTERS, and the reason it is worth running from a second machine.
Write-Host ''
Write-Host '2. An UNAUTHENTICATED request must still be refused'
$anonStatus = $null
try {
  $r = Invoke-WebRequest -Uri $plain -Proxy $proxy -TimeoutSec 20 -MaximumRedirection 0 -SkipHttpErrorCheck
  $anonStatus = [int]$r.StatusCode
} catch {
  if ($_.Exception.Response) { $anonStatus = [int]$_.Exception.Response.StatusCode }
}
if ($anonStatus -eq 407) {
  Pass 'refused with 407 — authentication is on, and it is on for the whole network, not just for strangers on the host'
} elseif ($null -eq $anonStatus) {
  Warn 'no clear answer — check 1 probably already failed'
} else {
  Write-Host ''
  Write-Host '  ################################################################' -ForegroundColor Red
  Write-Host "  #  OPEN PROXY. An anonymous request was answered with $anonStatus." -ForegroundColor Red
  Write-Host '  #  Anyone who reaches this port browses as that household.     ' -ForegroundColor Red
  Write-Host '  #  STOP. Tell the host to shut tinyproxy down NOW, then fix    ' -ForegroundColor Red
  Write-Host '  #  BasicAuth or replace it with 3proxy.                        ' -ForegroundColor Red
  Write-Host '  ################################################################' -ForegroundColor Red
  $failed = $true
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '3. Where an authenticated request comes out'
$exitIp = $null
try {
  $exitIp = (Invoke-WebRequest -Uri $whoami -Proxy $proxy -ProxyCredential $cred -TimeoutSec 25).Content.Trim()
  if ($exitIp -match '^\d{1,3}(\.\d{1,3}){3}$') { Pass "exits from $exitIp" }
  else { Fail "unexpected answer from the address service: '$exitIp'" }
} catch {
  Fail "the authenticated request failed — $($_.Exception.Message). A 407 here means the credential and the BasicAuth line disagree; anything else means CONNECT is not getting through (check ConnectPort 443)."
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '4. Whether that address is a US home line'
if ($exitIp) {
  try {
    $geo = Invoke-RestMethod -Uri ($geoApi -f $exitIp) -TimeoutSec 20
    if ($geo.status -ne 'success') {
      Warn "the address service could not classify $exitIp"
    } else {
      Write-Host "        $($geo.city), $($geo.regionName), $($geo.countryCode) — $($geo.isp) [$($geo.as)]"
      if ($geo.countryCode -eq 'US') { Pass 'United States' } else { Fail "country is $($geo.countryCode), not US" }
      if ($geo.hosting) {
        Warn 'flagged as a hosting/datacenter address. Expected for a paid ISP proxy; NOT expected for a real household — if this is meant to be someone home connection, something is routing through a datacenter.'
      } else {
        Pass 'not flagged as hosting — this is the residential classification a paid ISP proxy cannot get'
      }
      if ($geo.proxy) { Warn 'flagged as a proxy/VPN address by this service' } else { Pass 'not on a public proxy list' }
      Write-Host ''
      Write-Host "        Timezone to set on the account: match $($geo.city). align.ts knows"
      Write-Host '        America/New_York, Chicago, Denver, Phoenix, Los_Angeles, Anchorage.'
    }
  } catch {
    Warn "could not classify the address — $($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------------------
Write-Host ''
if (-not $failed) {
  Write-Host 'Every check passed. The exit is private, authenticated, and US.' -ForegroundColor Green
  Write-Host ''
  Write-Host 'This does NOT mean it is ready to sign an account in through. Next, and only next:'
  Write-Host ''
  Write-Host "  `$env:REDBOT_PROXY_HOST='$ProxyHost'"
  Write-Host "  `$env:REDBOT_PROXY_PORT='$Port'"
  Write-Host "  `$env:REDBOT_PROXY_USER='$User'"
  Write-Host "  `$env:REDBOT_PROXY_PASS=... (already set)"
  Write-Host '  node dist/cli.js proxy vet --country US --region "<city above>"'
  Write-Host ''
  Write-Host 'Report-only, writes nothing. Run the full window — not --quick — then bind with a handle.'
  exit 0
}
Write-Host 'Something above failed. Do not sign any account in through this exit until it is fixed.' -ForegroundColor Red
exit 1
