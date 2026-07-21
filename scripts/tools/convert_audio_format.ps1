param(
    # Required: input file or directory. If directory, scans all .wav files (recursively if -Recurse).
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    # Required: output directory. Subdirectory structure under $InputPath is preserved.
    [string]$OutputDir,

    # Target sample rate in Hz. Default 44100 (CD quality).
    [int]$TargetSampleRate = 44100,

    # Target bits per sample. Must be 8, 16, or 24. Default 16.
    [ValidateSet(8,16,24)]
    [int]$TargetBitsPerSample = 16,

    # Target channel count. 1 = mono, 2 = stereo. Default 1.
    [ValidateSet(1,2)]
    [int]$TargetChannels = 1,

    # If set, recursively scan subdirectories under $InputPath.
    [switch]$Recurse,

    # If set, overwrite existing output files. Default: skip existing.
    [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-WavHeader([string]$path) {
    if (-not (Test-Path $path)) { throw "WAV not found: $path" }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -lt 44) { throw "WAV too small: $($bytes.Length) bytes" }
    $riff = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
    if ($riff -ne "RIFF") { throw "Not a RIFF file: $riff" }
    $wave = [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4)
    if ($wave -ne "WAVE") { throw "Not a WAVE file: $wave" }
    $fmtFound = $false
    $audioFormat = 0; $channels = 0; $sampleRate = 0; $bytesPerSample = 0
    $dataOffset = -1; $dataLength = 0
    $pos = 12
    while ($pos + 8 -le $bytes.Length) {
        $chunkId = [System.Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
        $chunkSize = [BitConverter]::ToInt32($bytes, $pos + 4)
        if ($chunkId -eq "fmt ") {
            $audioFormat = [BitConverter]::ToInt16($bytes, $pos + 8)
            $channels = [BitConverter]::ToInt16($bytes, $pos + 10)
            $sampleRate = [BitConverter]::ToInt32($bytes, $pos + 12)
            $bitsPerSample = [BitConverter]::ToInt16($bytes, $pos + 22)
            $bytesPerSample = $bitsPerSample / 8
            $fmtFound = $true
        } elseif ($chunkId -eq "data") {
            $dataOffset = $pos + 8
            $dataLength = $chunkSize
            break
        }
        if ($chunkSize -le 0) { break }
        $pos += 8 + $chunkSize
        if ($chunkSize % 2 -ne 0) { $pos += 1 }
    }
    if (-not $fmtFound) { throw "fmt chunk not found in $path" }
    if ($dataOffset -lt 0) { throw "data chunk not found in $path" }
    if ($audioFormat -ne 1) { throw "Unsupported audio format (only PCM 1 supported): $audioFormat in $path" }
    return [pscustomobject]@{
        Bytes = $bytes
        AudioFormat = $audioFormat
        Channels = $channels
        SampleRate = $sampleRate
        BitsPerSample = $bytesPerSample * 8
        BytesPerSample = $bytesPerSample
        DataOffset = $dataOffset
        DataLength = $dataLength
    }
}

function Read-AllSamples($wav) {
    $totalSamples = [int]($wav.DataLength / ($wav.Channels * $wav.BytesPerSample))
    $samples = New-Object 'double[][]' $totalSamples
    for ($i = 0; $i -lt $totalSamples; $i++) {
        $ch = New-Object 'double[]' $wav.Channels
        for ($c = 0; $c -lt $wav.Channels; $c++) {
            $byteOffset = $wav.DataOffset + ($i * $wav.Channels + $c) * $wav.BytesPerSample
            switch ($wav.BitsPerSample) {
                8 { $ch[$c] = ([double]$wav.Bytes[$byteOffset] - 128.0) / 128.0 }
                16 {
                    $val = [BitConverter]::ToInt16($wav.Bytes, $byteOffset)
                    $ch[$c] = [double]$val / 32768.0
                }
                24 {
                    $b0 = [int]$wav.Bytes[$byteOffset]
                    $b1 = [int]$wav.Bytes[$byteOffset + 1]
                    $b2 = [int]$wav.Bytes[$byteOffset + 2]
                    $val = ($b2 -shl 16) -bor ($b1 -shl 8) -bor $b0
                    if ($val -band 0x800000) { $val = $val -bor 0xFF000000 }
                    $ch[$c] = [double]$val / 8388608.0
                }
                32 {
                    $val = [BitConverter]::ToInt32($wav.Bytes, $byteOffset)
                    $ch[$c] = [double]$val / 2147483648.0
                }
            }
        }
        $samples[$i] = $ch
    }
    return ,$samples
}

function Convert-Channels($samples, $srcChannels, $dstChannels) {
    if ($srcChannels -eq $dstChannels) { return ,$samples }
    $total = $samples.Length
    $out = New-Object 'double[][]' $total
    for ($i = 0; $i -lt $total; $i++) {
        $src = $samples[$i]
        $dst = New-Object 'double[]' $dstChannels
        if ($srcChannels -eq 2 -and $dstChannels -eq 1) {
            $dst[0] = ($src[0] + $src[1]) / 2.0
        } elseif ($srcChannels -eq 1 -and $dstChannels -eq 2) {
            $dst[0] = $src[0]; $dst[1] = $src[0]
        } else {
            $minCh = [Math]::Min($srcChannels, $dstChannels)
            for ($c = 0; $c -lt $minCh; $c++) { $dst[$c] = $src[$c] }
            for ($c = $minCh; $c -lt $dstChannels; $c++) { $dst[$c] = 0.0 }
        }
        $out[$i] = $dst
    }
    return ,$out
}

function Resample-Linear($samples, $srcRate, $dstRate) {
    if ($srcRate -eq $dstRate) { return ,$samples }
    $srcCount = $samples.Length
    $srcChannels = $samples[0].Length
    $dstCount = [int]([Math]::Round(($srcCount * $dstRate) / [double]$srcRate))
    if ($dstCount -lt 1) { $dstCount = 1 }
    $out = New-Object 'double[][]' $dstCount
    $ratio = [double]$srcRate / [double]$dstRate
    for ($i = 0; $i -lt $dstCount; $i++) {
        $srcIdx = $i * $ratio
        $j = [int]([Math]::Floor($srcIdx))
        $f = $srcIdx - $j
        $dst = New-Object 'double[]' $srcChannels
        if ($j + 1 -lt $srcCount) {
            $s0 = $samples[$j]; $s1 = $samples[$j + 1]
            for ($c = 0; $c -lt $srcChannels; $c++) {
                $dst[$c] = $s0[$c] * (1.0 - $f) + $s1[$c] * $f
            }
        } else {
            $s0 = $samples[[Math]::Min($j, $srcCount - 1)]
            for ($c = 0; $c -lt $srcChannels; $c++) { $dst[$c] = $s0[$c] }
        }
        $out[$i] = $dst
    }
    return ,$out
}

function Write-WavFile($outPath, $samples, $sampleRate, $bitsPerSample, $channels) {
    $bytesPerSample = $bitsPerSample / 8
    $bytesPerFrame = $channels * $bytesPerSample
    $dataLen = $samples.Length * $bytesPerFrame
    $out = New-Object byte[] (44 + $dataLen)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("RIFF"), 0, $out, 0, 4)
    [BitConverter]::GetBytes([int](36 + $dataLen)).CopyTo($out, 4)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("WAVE"), 0, $out, 8, 4)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("fmt "), 0, $out, 12, 4)
    [BitConverter]::GetBytes([int]16).CopyTo($out, 16)
    [BitConverter]::GetBytes([int16]1).CopyTo($out, 20)
    [BitConverter]::GetBytes([int16]$channels).CopyTo($out, 22)
    [BitConverter]::GetBytes([int]$sampleRate).CopyTo($out, 24)
    [BitConverter]::GetBytes([int]($sampleRate * $bytesPerFrame)).CopyTo($out, 28)
    [BitConverter]::GetBytes([int16]$bytesPerFrame).CopyTo($out, 32)
    [BitConverter]::GetBytes([int16]$bitsPerSample).CopyTo($out, 34)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("data"), 0, $out, 36, 4)
    [BitConverter]::GetBytes([int]$dataLen).CopyTo($out, 40)
    $dataStart = 44
    for ($i = 0; $i -lt $samples.Length; $i++) {
        $ch = $samples[$i]
        for ($c = 0; $c -lt $channels; $c++) {
            $v = $ch[$c]
            if ($v -gt 1.0) { $v = 1.0 } elseif ($v -lt -1.0) { $v = -1.0 }
            $byteOff = $dataStart + ($i * $channels + $c) * $bytesPerSample
            switch ($bitsPerSample) {
                8 { $out[$byteOff] = [byte][int]([Math]::Round($v * 127.0 + 128.0)) }
                16 {
                    $ival = [int][Math]::Round($v * 32767.0)
                    if ($ival -gt 32767) { $ival = 32767 } elseif ($ival -lt -32768) { $ival = -32768 }
                    $b = [BitConverter]::GetBytes([int16]$ival)
                    $out[$byteOff] = $b[0]; $out[$byteOff + 1] = $b[1]
                }
                24 {
                    $ival = [int][Math]::Round($v * 8388607.0)
                    if ($ival -gt 8388607) { $ival = 8388607 } elseif ($ival -lt -8388608) { $ival = -8388608 }
                    $uval = [uint32]$ival
                    if ($ival -lt 0) { $uval = [uint32]($ival -band 0xFFFFFF) }
                    $out[$byteOff] = [byte]($uval -band 0xFF)
                    $out[$byteOff + 1] = [byte](($uval -shr 8) -band 0xFF)
                    $out[$byteOff + 2] = [byte](($uval -shr 16) -band 0xFF)
                }
            }
        }
    }
    [System.IO.File]::WriteAllBytes($outPath, $out)
}

function Convert-WavFile($srcPath, $dstPath, $targetSampleRate, $targetBitsPerSample, $targetChannels, $force) {
    if ((Test-Path $dstPath) -and -not $force) {
        Write-Host "  skip (exists): $dstPath"
        return "skipped"
    }
    $dstParent = [System.IO.Path]::GetDirectoryName($dstPath)
    if (-not (Test-Path $dstParent)) { New-Item -ItemType Directory -Path $dstParent -Force | Out-Null }
    $wav = Read-WavHeader -path $srcPath
    Write-Host "  src: $srcPath"
    Write-Host "    format=$($wav.AudioFormat) ch=$($wav.Channels) rate=$($wav.SampleRate) bits=$($wav.BitsPerSample)"
    $samples = Read-AllSamples -wav $wav
    if ($samples.Length -eq 0) {
        Write-Warning "  no samples in $srcPath, skipping"
        return "skipped"
    }
    if ($wav.Channels -ne $targetChannels) {
        $samples = Convert-Channels -samples $samples -srcChannels $wav.Channels -dstChannels $targetChannels
    }
    if ($wav.SampleRate -ne $targetSampleRate) {
        $samples = Resample-Linear -samples $samples -srcRate $wav.SampleRate -dstRate $targetSampleRate
    }
    Write-WavFile -outPath $dstPath -samples $samples -sampleRate $targetSampleRate -bitsPerSample $targetBitsPerSample -channels $targetChannels
    Write-Host "    -> $dstPath (ch=$targetChannels rate=$targetSampleRate bits=$targetBitsPerSample, samples=$($samples.Length))"
    return "converted"
}

# ---- Main ----

if (-not (Test-Path $InputPath)) { throw "InputPath not found: $InputPath" }

$inputAbs = (Resolve-Path $InputPath).Path
$outputAbs = $null
if ($OutputDir) {
    $resolved = Resolve-Path -LiteralPath $OutputDir -ErrorAction SilentlyContinue
    if ($resolved) { $outputAbs = $resolved.Path }
}
if (-not $outputAbs) {
    $outputAbs = [System.IO.Path]::Combine($inputAbs, "_converted")
    Write-Host "[Convert] OutputDir not provided or invalid. Using default: $outputAbs"
}
if (-not (Test-Path $outputAbs)) { New-Item -ItemType Directory -Path $outputAbs -Force | Out-Null }

Write-Host "[Convert] target: rate=$TargetSampleRate bits=$TargetBitsPerSample ch=$TargetChannels"
Write-Host "[Convert] input:  $inputAbs"
Write-Host "[Convert] output: $outputAbs"
Write-Host "[Convert] recursive: $($Recurse.IsPresent)"

$wavFiles = @()
if (Test-Path $inputAbs -PathType Leaf) {
    $wavFiles = @($inputAbs)
} else {
    $searchOpt = if ($Recurse) { [System.IO.SearchOption]::AllDirectories } else { [System.IO.SearchOption]::TopDirectoryOnly }
    $wavFiles = [System.IO.Directory]::GetFiles($inputAbs, "*.wav", $searchOpt)
}

Write-Host "[Convert] found $($wavFiles.Count) wav file(s)"

$converted = 0; $skipped = 0; $failed = 0
foreach ($src in $wavFiles) {
    $srcName = [System.IO.Path]::GetFileName($src)
    $srcDir = [System.IO.Path]::GetDirectoryName($src)
    $rel = if ($srcDir -eq $inputAbs) { "" } else { $srcDir.Substring($inputAbs.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar) }
    $dstDir = if ($rel) { [System.IO.Path]::Combine($outputAbs, $rel) } else { $outputAbs }
    $dst = [System.IO.Path]::Combine($dstDir, $srcName)
    try {
        $result = Convert-WavFile -srcPath $src -dstPath $dst -targetSampleRate $TargetSampleRate -targetBitsPerSample $TargetBitsPerSample -targetChannels $TargetChannels -force $Force
        if ($result -eq "converted") { $converted++ } else { $skipped++ }
    } catch {
        $failed++
        Write-Warning "  FAILED: $src -- $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "[Convert] done: converted=$converted skipped=$skipped failed=$failed"