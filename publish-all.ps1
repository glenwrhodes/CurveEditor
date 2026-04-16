<#
.SYNOPSIS
    Bump versions, build, and publish all three Curve Editor packages in lockstep:
      - packages/curve-eval-js    -> npm
      - packages/curve-eval-py    -> PyPI
      - extension                 -> VS Code Marketplace

.PARAMETER Bump
    Semantic version bump type: patch (default), minor, or major.
    Alternatively, pass -Version "1.2.3" to set an explicit version.

.PARAMETER Version
    Explicit version string (e.g. "1.2.3"). Overrides -Bump when supplied.

.PARAMETER SkipTests
    Skip running the JS and Python test suites before publishing.

.PARAMETER SkipJs
    Skip the npm publish step (useful if only the extension or Python changed).

.PARAMETER SkipPy
    Skip the PyPI publish step.

.PARAMETER SkipExtension
    Skip the VS Code Marketplace publish step.

.PARAMETER SkipGit
    Skip the "commit version bump + push" step at the end. Useful for dry runs.

.PARAMETER DryRun
    Print what would happen without running any publish commands.

.EXAMPLE
    # Patch release (0.1.1 -> 0.1.2), everything
    .\publish-all.ps1

.EXAMPLE
    # Minor bump, skip tests
    .\publish-all.ps1 -Bump minor -SkipTests

.EXAMPLE
    # Jump to a specific version
    .\publish-all.ps1 -Version 1.0.0

.EXAMPLE
    # Only publish the extension (runtime libs unchanged)
    .\publish-all.ps1 -SkipJs -SkipPy

.NOTES
    Requirements:
      - You must be logged in to npm (cached token or passkey)
      - ~/.pypirc must have your PyPI API token
      - vsce login has been done for publisher TinyMooshGamesInc
      - git working tree should be clean
#>

[CmdletBinding()]
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch',

    [string]$Version,

    [switch]$SkipTests,
    [switch]$SkipJs,
    [switch]$SkipPy,
    [switch]$SkipExtension,
    [switch]$SkipGit,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$repoRoot = $PSScriptRoot
$extensionDir = Join-Path $repoRoot 'extension'
$jsDir = Join-Path $repoRoot 'packages/curve-eval-js'
$pyDir = Join-Path $repoRoot 'packages/curve-eval-py'

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Ok([string]$msg) {
    Write-Host "    $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
    Write-Host "    $msg" -ForegroundColor Yellow
}

function Invoke-OrDry([string]$label, [scriptblock]$action) {
    if ($DryRun) {
        Write-Warn "DRY RUN — would: $label"
    }
    else {
        & $action
    }
}

function Get-CurrentVersion {
    $pkgPath = Join-Path $extensionDir 'package.json'
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    return $pkg.version
}

function Get-NextVersion([string]$current, [string]$bumpType) {
    $parts = $current.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($bumpType) {
        'major' { $major++; $minor = 0; $patch = 0 }
        'minor' { $minor++; $patch = 0 }
        'patch' { $patch++ }
    }
    return "$major.$minor.$patch"
}

function Set-JsonVersion([string]$path, [string]$newVersion) {
    $content = Get-Content $path -Raw
    $new = [regex]::Replace(
        $content,
        '"version"\s*:\s*"[^"]+"',
        "`"version`": `"$newVersion`""
    )
    Set-Content -Path $path -Value $new -NoNewline
}

function Set-PyVersion([string]$path, [string]$newVersion) {
    $content = Get-Content $path -Raw
    $new = [regex]::Replace(
        $content,
        'version\s*=\s*"[^"]+"',
        "version = `"$newVersion`"",
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase,
        1  # first match only (the [project] table)
    )
    Set-Content -Path $path -Value $new -NoNewline
}

# ── Preflight ────────────────────────────────────────────────────────────

Write-Step 'Preflight'

if (-not $SkipGit -and -not $DryRun) {
    $gitStatus = git -C $repoRoot status --porcelain
    if ($gitStatus) {
        Write-Error "Working tree is not clean. Commit or stash changes first, or pass -SkipGit.`n$gitStatus"
        exit 1
    }
    Write-Ok 'Git working tree clean'
}

$currentVersion = Get-CurrentVersion
$newVersion = if ($Version) { $Version } else { Get-NextVersion $currentVersion $Bump }

Write-Host "    Current version:  $currentVersion" -ForegroundColor Gray
Write-Host "    New version:      $newVersion" -ForegroundColor Green

if (-not $DryRun) {
    $confirm = Read-Host "`nProceed? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host 'Aborted.'
        exit 0
    }
}

# ── Bump versions ────────────────────────────────────────────────────────

Write-Step "Bumping versions to $newVersion"

$filesToBump = @(
    @{ Path = Join-Path $extensionDir 'package.json'; Kind = 'json' }
    @{ Path = Join-Path $jsDir 'package.json';         Kind = 'json' }
    @{ Path = Join-Path $pyDir 'pyproject.toml';       Kind = 'py'   }
)

foreach ($f in $filesToBump) {
    Invoke-OrDry "set version=$newVersion in $($f.Path)" {
        if ($f.Kind -eq 'json') {
            Set-JsonVersion $f.Path $newVersion
        }
        else {
            Set-PyVersion $f.Path $newVersion
        }
        Write-Ok "Updated $($f.Path)"
    }
}

# ── Tests ────────────────────────────────────────────────────────────────

if (-not $SkipTests) {
    Write-Step 'Running JS tests'
    Invoke-OrDry 'npm test (curve-eval-js)' {
        Push-Location $jsDir
        try { npx jest --no-coverage } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'JS tests failed' }
        Write-Ok 'JS tests passed'
    }

    Write-Step 'Running Python tests'
    Invoke-OrDry 'pytest (curve-eval-py)' {
        Push-Location $pyDir
        try { python -m pytest tests/ -q } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Python tests failed' }
        Write-Ok 'Python tests passed'
    }
}
else {
    Write-Warn 'Skipping tests (-SkipTests)'
}

# ── Build & publish: JS ──────────────────────────────────────────────────

if (-not $SkipJs) {
    Write-Step "Publishing curve-eval@$newVersion to npm"

    Invoke-OrDry 'build curve-eval-js' {
        Push-Location $jsDir
        try { node build.mjs } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'JS build failed' }
        Write-Ok 'JS build complete'
    }

    Invoke-OrDry 'npm publish --access public' {
        Push-Location $jsDir
        try { npm publish --access public } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'npm publish failed' }
        Write-Ok 'Published to npm'
    }
}
else {
    Write-Warn 'Skipping npm publish (-SkipJs)'
}

# ── Build & publish: Python ──────────────────────────────────────────────

if (-not $SkipPy) {
    Write-Step "Publishing curve-eval@$newVersion to PyPI"

    Invoke-OrDry 'clean dist/' {
        $distPath = Join-Path $pyDir 'dist'
        if (Test-Path $distPath) { Remove-Item -Recurse -Force $distPath }
        Write-Ok 'Cleaned old dist/'
    }

    Invoke-OrDry 'python -m build' {
        Push-Location $pyDir
        try { python -m build } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Python build failed' }
        Write-Ok 'Python build complete'
    }

    Invoke-OrDry 'python -m twine upload dist/*' {
        Push-Location $pyDir
        try {
            # -Filter handles spaces/globbing safely
            $files = Get-ChildItem -Path 'dist' -File
            python -m twine upload @($files.FullName)
        }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'PyPI upload failed' }
        Write-Ok 'Published to PyPI'
    }
}
else {
    Write-Warn 'Skipping PyPI publish (-SkipPy)'
}

# ── Build & publish: VS Code Marketplace ─────────────────────────────────

if (-not $SkipExtension) {
    Write-Step "Publishing curve-editor@$newVersion to VS Code Marketplace"

    Invoke-OrDry 'build extension bundle' {
        Push-Location $extensionDir
        try { npm run build } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
        Write-Ok 'Extension bundle built'
    }

    Invoke-OrDry 'vsce publish' {
        Push-Location $extensionDir
        try { npx @vscode/vsce publish } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'vsce publish failed' }
        Write-Ok 'Published to VS Code Marketplace'
    }
}
else {
    Write-Warn 'Skipping Marketplace publish (-SkipExtension)'
}

# ── Git commit + push ────────────────────────────────────────────────────

if (-not $SkipGit) {
    Write-Step 'Committing version bump'

    Invoke-OrDry "git commit + push for v$newVersion" {
        Push-Location $repoRoot
        try {
            git add `
                (Join-Path $extensionDir 'package.json') `
                (Join-Path $jsDir 'package.json') `
                (Join-Path $pyDir 'pyproject.toml')

            git commit -m "Release v$newVersion"
            git tag "v$newVersion"
            git push origin main
            git push origin "v$newVersion"
        }
        finally { Pop-Location }
        Write-Ok "Committed, tagged, and pushed v$newVersion"
    }
}
else {
    Write-Warn 'Skipping git commit (-SkipGit)'
}

Write-Host "`n==> Done. Released v$newVersion." -ForegroundColor Green
Write-Host '    - npm:        https://www.npmjs.com/package/curve-eval' -ForegroundColor Gray
Write-Host '    - PyPI:       https://pypi.org/project/curve-eval/' -ForegroundColor Gray
Write-Host '    - VS Marketplace: https://marketplace.visualstudio.com/items?itemName=TinyMooshGamesInc.curve-editor' -ForegroundColor Gray
