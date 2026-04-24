param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$toolScript = Join-Path $PSScriptRoot "tools\extract_collision_boxes.ps1"
& $toolScript @RemainingArgs
