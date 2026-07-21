param(
    # Required: working mode. Scan = scan silence regions (legacy, unreliable on high-sample-rate wav);
    # Slice = cut single-file wavs according to slice.json;
    # EvenSplit = split a single wav into N equal parts (count from -Count);
    # EvenSplitBatch = batch process a directory, read counts from -SliceInfo txt.
    [Parameter(Mandatory=$true)]
    [ValidateSet("Scan","Slice","EvenSplit","EvenSplitBatch")]
    [string]$Mode,

    # Scan/EvenSplit mode required: source wav file path.
    [string]$WavPath,

    # Slice mode required: slice.json file path.
    [string]$SliceJson,

    # EvenSplit mode required: number of equal parts to split the wav into.
    [int]$Count,

    # EvenSplitBatch mode required: path to sliceinfo.txt. Format per line:
    #   <wav-filename> <count>
    # Lines starting with # or empty lines are ignored.
    # If a wav in BatchDir is not listed, a warning is printed and the file is skipped.
    [string]$SliceInfo,

    # EvenSplitBatch mode required: directory containing wav files to batch process.
    [string]$BatchDir,

    # [Scan only] Silence threshold (normalized amplitude 0.0~1.0). Samples with peak below
    # this value are treated as silence. Default 0.02 fits clean recordings; raise it for
    # noisy material (e.g. 0.05, 0.1, 0.2). Higher = easier to detect silence = more slices.
    [double]$SilenceThreshold = 0.02,

    # [Scan only] Minimum silence duration in ms. Silence shorter than this is NOT treated
    # as a slice boundary, to avoid false cuts on short pauses inside a single effect.
    # Default 80ms fits common effects; lower it (e.g. 30) for tight packs, raise it (e.g. 200) for sparse packs.
    [int]$MinSilenceMs = 80,

    # [Scan only] Minimum slice duration in ms. Slices shorter than this are discarded (debounce).
    # Default 50ms filters out noise pulses; lower it (e.g. 20) to keep very short effects.
    [int]$MinSliceMs = 50,

    # [Scan only] Head trim in ms. Slice start is moved earlier by this amount to avoid
    # cutting off the attack. Default 20ms; raise it (e.g. 50) if attacks are clipped.
    [int]$HeadTrimMs = 20,

    # [Scan only] Tail trim in ms. Slice end is moved later by this amount to avoid
    # cutting off the release. Default 30ms; raise it (e.g. 80) if tails are clipped.
    [int]$TailTrimMs = 30,

    # [Scan only] Sample step. Read 1 sample out of every N for amplitude detection.
    # N=1 is most accurate but slowest. Raise it (e.g. 10, 100) for speed on large files
    # at the cost of precision (may miss very short silence).
    [int]$SampleStep = 1
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
    if (-not $fmtFound) { throw "fmt chunk not found" }
    if ($dataOffset -lt 0) { throw "data chunk not found" }
    if ($audioFormat -ne 1) { throw "Unsupported audio format (only PCM 1 supported): $audioFormat" }
    return [pscustomobject]@{
        Bytes = $bytes
        AudioFormat = $audioFormat
        Channels = $channels
        SampleRate = $sampleRate
        BitsPerSample = $bytesPerSample * 8
        BytesPerSample = $bytesPerSample
        DataOffset = $dataOffset
        DataLength = $dataLength
        DurationSec = [Math]::Round($dataLength / ($sampleRate * $channels * $bytesPerSample), 3)
    }
}

function Get-SampleAmplitude($wav, $sampleIndex) {
    $byteOffset = $wav.DataOffset + ($sampleIndex * $wav.Channels * $wav.BytesPerSample)
    if ($byteOffset + $wav.BytesPerSample -gt $wav.Bytes.Length) { return 0.0 }
    switch ($wav.BitsPerSample) {
        8 { return ([double]$wav.Bytes[$byteOffset] - 128.0) / 128.0 }
        16 {
            $val = [BitConverter]::ToInt16($wav.Bytes, $byteOffset)
            return [double]$val / 32768.0
        }
        24 {
            $b0 = [int]$wav.Bytes[$byteOffset]
            $b1 = [int]$wav.Bytes[$byteOffset + 1]
            $b2 = [int]$wav.Bytes[$byteOffset + 2]
            $val = ($b2 -shl 16) -bor ($b1 -shl 8) -bor $b0
            if ($val -band 0x800000) { $val = $val -bor 0xFF000000 }
            return [double]$val / 8388608.0
        }
        32 {
            $val = [BitConverter]::ToInt32($wav.Bytes, $byteOffset)
            return [double]$val / 2147483648.0
        }
        default { return 0.0 }
    }
}

function Get-ChannelAmplitude($wav, $sampleIndex) {
    $maxAmp = 0.0
    for ($c = 0; $c -lt $wav.Channels; $c++) {
        $byteOffset = $wav.DataOffset + ($sampleIndex * $wav.Channels + $c) * $wav.BytesPerSample
        if ($byteOffset + $wav.BytesPerSample -gt $wav.Bytes.Length) { continue }
        $amp = 0.0
        switch ($wav.BitsPerSample) {
            8 { $amp = ([double]$wav.Bytes[$byteOffset] - 128.0) / 128.0 }
            16 {
                $val = [BitConverter]::ToInt16($wav.Bytes, $byteOffset)
                $amp = [double]$val / 32768.0
            }
            24 {
                $b0 = [int]$wav.Bytes[$byteOffset]
                $b1 = [int]$wav.Bytes[$byteOffset + 1]
                $b2 = [int]$wav.Bytes[$byteOffset + 2]
                $val = ($b2 -shl 16) -bor ($b1 -shl 8) -bor $b0
                if ($val -band 0x800000) { $val = $val -bor 0xFF000000 }
                $amp = [double]$val / 8388608.0
            }
            32 {
                $val = [BitConverter]::ToInt32($wav.Bytes, $byteOffset)
                $amp = [double]$val / 2147483648.0
            }
        }
        $absAmp = [Math]::Abs($amp)
        if ($absAmp -gt $maxAmp) { $maxAmp = $absAmp }
    }
    return $maxAmp
}

function Invoke-EvenSplit($wavPath, $count) {
    if ($count -lt 1) { throw "EvenSplit requires -Count >= 1 (got $count)" }
    $wav = Read-WavHeader -path $wavPath
    Write-Host "[EvenSplit] wav: $wavPath"
    Write-Host "[EvenSplit] format=$($wav.AudioFormat) ch=$($wav.Channels) rate=$($wav.SampleRate) bits=$($wav.BitsPerSample) duration=$($wav.DurationSec)s count=$count"

    $totalSamples = [int]($wav.DataLength / ($wav.Channels * $wav.BytesPerSample))
    $samplesPerPart = [int]([Math]::Floor($totalSamples / [double]$count))
    if ($samplesPerPart -lt 1) { throw "wav too short: totalSamples=$totalSamples cannot split into $count parts" }

    $slices = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $count; $i++) {
        $startSample = $i * $samplesPerPart
        $endSample = if ($i -eq $count - 1) { $totalSamples } else { ($i + 1) * $samplesPerPart }
        $peak = 0.0
        $stepProbe = [Math]::Max(1, [int](($endSample - $startSample) / 50))
        for ($k = $startSample; $k -lt $endSample; $k += $stepProbe) {
            $a = Get-ChannelAmplitude -wav $wav -sampleIndex $k
            if ($a -gt $peak) { $peak = $a }
        }
        [void]$slices.Add([pscustomobject]@{
            name = "slice_$($($i + 1).ToString('00'))"
            start = [Math]::Round($startSample / [double]$wav.SampleRate, 3)
            end = [Math]::Round($endSample / [double]$wav.SampleRate, 3)
            _peak = [Math]::Round($peak, 3)
        })
    }

    $fileName = [System.IO.Path]::GetFileName($wavPath)
    $fileBase = [System.IO.Path]::GetFileNameWithoutExtension($wavPath)
    $jsonPath = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($wavPath), "$fileBase.slice.json")
    $result = [ordered]@{
        source = $fileName
        outputDir = "../$fileBase/"
        _scanMeta = [ordered]@{
            mode = "EvenSplit"
            sampleRate = $wav.SampleRate
            channels = $wav.Channels
            bitsPerSample = $wav.BitsPerSample
            duration = $wav.DurationSec
            count = $count
        }
        slices = $slices
    }
    $json = $result | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[EvenSplit] done: $jsonPath"
    Write-Host "[EvenSplit] slices: $($slices.Count)"
    foreach ($s in $slices) {
        Write-Host "  $($s.name)  start=$($s.start)s  end=$($s.end)s  peak=$($s._peak)"
    }
}

function Invoke-EvenSplitBatch($batchDir, $sliceInfoPath) {
    if (-not (Test-Path $batchDir)) { throw "BatchDir not found: $batchDir" }
    if (-not (Test-Path $sliceInfoPath)) { throw "SliceInfo not found: $sliceInfoPath" }
    $batchAbs = (Resolve-Path $batchDir).Path
    $infoAbs = (Resolve-Path $sliceInfoPath).Path
    Write-Host "[EvenSplitBatch] batchDir: $batchAbs"
    Write-Host "[EvenSplitBatch] sliceInfo: $infoAbs"

    $info = @{}
    $lines = [System.IO.File]::ReadAllLines($infoAbs)
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $fname = $null; $cnt = 0; $ok = $false
        if ($trimmed.StartsWith('"')) {
            # Quoted filename: "file name.wav" 6  (filename may contain spaces)
            $endQuote = $trimmed.IndexOf('"', 1)
            if ($endQuote -gt 1) {
                $fname = $trimmed.Substring(1, $endQuote - 1)
                $rest = $trimmed.Substring($endQuote + 1).Trim()
                if ([int]::TryParse($rest, [ref]$cnt)) { $ok = $true }
            }
            if (-not $ok) {
                Write-Warning "[EvenSplitBatch] bad line ignored: '$line' (expected: `"<filename>`" <count>)"
                continue
            }
        } else {
            # Unquoted filename: filename.wav 6  (filename must not contain spaces)
            $parts = $trimmed -split '\s+'
            if ($parts.Length -lt 2) {
                Write-Warning "[EvenSplitBatch] bad line ignored: '$line' (expected: `"<filename>`" <count> or <filename> <count>)"
                continue
            }
            if (-not [int]::TryParse($parts[-1], [ref]$cnt)) {
                Write-Warning "[EvenSplitBatch] bad count ignored: '$line' (last token must be integer)"
                continue
            }
            $fname = ($parts[0..($parts.Length - 2)] -join ' ')
        }
        if ($info.ContainsKey($fname)) {
            Write-Warning "[EvenSplitBatch] duplicate entry for $fname, last value wins"
        }
        $info[$fname] = $cnt
    }
    Write-Host "[EvenSplitBatch] sliceinfo loaded: $($info.Count) entries"
    if ($info.Count -eq 0) {
        throw "sliceinfo.txt has no valid entries"
    }

    $wavFiles = [System.IO.Directory]::GetFiles($batchAbs, "*.wav", [System.IO.SearchOption]::TopDirectoryOnly)
    Write-Host "[EvenSplitBatch] found $($wavFiles.Count) wav file(s) in batchDir"
    if ($wavFiles.Count -eq 0) {
        Write-Warning "[EvenSplitBatch] no wav files in $batchAbs"
        return
    }

    $processed = 0; $skipped = 0
    foreach ($wav in $wavFiles) {
        $fname = [System.IO.Path]::GetFileName($wav)
        if (-not $info.ContainsKey($fname)) {
            Write-Warning "[EvenSplitBatch] WARNING: '$fname' not listed in sliceinfo.txt, skipping"
            $skipped++
            continue
        }
        $cnt = $info[$fname]
        Write-Host ""
        Write-Host "[EvenSplitBatch] processing $fname (count=$cnt)"
        try {
            Invoke-EvenSplit -wavPath $wav -count $cnt
            $processed++
        } catch {
            Write-Warning "[EvenSplitBatch] FAILED on $fname : $($_.Exception.Message)"
            $skipped++
        }
    }
    Write-Host ""
    Write-Host "[EvenSplitBatch] done: processed=$processed skipped=$skipped"
    if ($skipped -gt 0) {
        Write-Warning "[EvenSplitBatch] $skipped file(s) skipped. Check warnings above."
    }
}

function Invoke-EvenSplit($wavPath, $count) {
    if ($count -lt 1) { throw "EvenSplit requires -Count >= 1 (got $count)" }
    $wav = Read-WavHeader -path $wavPath
    Write-Host "[EvenSplit] wav: $wavPath"
    Write-Host "[EvenSplit] format=$($wav.AudioFormat) ch=$($wav.Channels) rate=$($wav.SampleRate) bits=$($wav.BitsPerSample) duration=$($wav.DurationSec)s count=$count"

    $totalSamples = [int]($wav.DataLength / ($wav.Channels * $wav.BytesPerSample))
    $samplesPerPart = [int]([Math]::Floor($totalSamples / [double]$count))
    if ($samplesPerPart -lt 1) { throw "wav too short: totalSamples=$totalSamples cannot split into $count parts" }

    $slices = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $count; $i++) {
        $startSample = $i * $samplesPerPart
        $endSample = if ($i -eq $count - 1) { $totalSamples } else { ($i + 1) * $samplesPerPart }
        $peak = 0.0
        $stepProbe = [Math]::Max(1, [int](($endSample - $startSample) / 50))
        for ($k = $startSample; $k -lt $endSample; $k += $stepProbe) {
            $a = Get-ChannelAmplitude -wav $wav -sampleIndex $k
            if ($a -gt $peak) { $peak = $a }
        }
        [void]$slices.Add([pscustomobject]@{
            name = "slice_$($($i + 1).ToString('00'))"
            start = [Math]::Round($startSample / [double]$wav.SampleRate, 3)
            end = [Math]::Round($endSample / [double]$wav.SampleRate, 3)
            _peak = [Math]::Round($peak, 3)
        })
    }

    $fileName = [System.IO.Path]::GetFileName($wavPath)
    $fileBase = [System.IO.Path]::GetFileNameWithoutExtension($wavPath)
    $jsonPath = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($wavPath), "$fileBase.slice.json")
    $result = [ordered]@{
        source = $fileName
        outputDir = "../$fileBase/"
        _scanMeta = [ordered]@{
            mode = "EvenSplit"
            sampleRate = $wav.SampleRate
            channels = $wav.Channels
            bitsPerSample = $wav.BitsPerSample
            duration = $wav.DurationSec
            count = $count
        }
        slices = $slices
    }
    $json = $result | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[EvenSplit] done: $jsonPath"
    Write-Host "[EvenSplit] slices: $($slices.Count)"
    foreach ($s in $slices) {
        Write-Host "  $($s.name)  start=$($s.start)s  end=$($s.end)s  peak=$($s._peak)"
    }
}

function Invoke-EvenSplitBatch($batchDir, $sliceInfoPath) {
    if (-not (Test-Path $batchDir)) { throw "BatchDir not found: $batchDir" }
    if (-not (Test-Path $sliceInfoPath)) { throw "SliceInfo not found: $sliceInfoPath" }
    $batchAbs = (Resolve-Path $batchDir).Path
    $infoAbs = (Resolve-Path $sliceInfoPath).Path
    Write-Host "[EvenSplitBatch] batchDir: $batchAbs"
    Write-Host "[EvenSplitBatch] sliceInfo: $infoAbs"

    $info = @{}
    $lines = [System.IO.File]::ReadAllLines($infoAbs)
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $fname = $null; $cnt = 0; $ok = $false
        if ($trimmed.StartsWith('"')) {
            # Quoted filename: "file name.wav" 6  (filename may contain spaces)
            $endQuote = $trimmed.IndexOf('"', 1)
            if ($endQuote -gt 1) {
                $fname = $trimmed.Substring(1, $endQuote - 1)
                $rest = $trimmed.Substring($endQuote + 1).Trim()
                if ([int]::TryParse($rest, [ref]$cnt)) { $ok = $true }
            }
            if (-not $ok) {
                Write-Warning "[EvenSplitBatch] bad line ignored: '$line' (expected: `"<filename>`" <count>)"
                continue
            }
        } else {
            # Split on whitespace; last token = count, everything before = filename (may contain spaces)
            $parts = $trimmed -split '\s+'
            if ($parts.Length -lt 2) {
                Write-Warning "[EvenSplitBatch] bad line ignored: '$line' (expected: `"<filename>`" <count> or <filename> <count>)"
                continue
            }
            if (-not [int]::TryParse($parts[-1], [ref]$cnt)) {
                Write-Warning "[EvenSplitBatch] bad count ignored: '$line' (last token must be integer)"
                continue
            }
            $fname = ($parts[0..($parts.Length - 2)] -join ' ')
        }
        if ($info.ContainsKey($fname)) {
            Write-Warning "[EvenSplitBatch] duplicate entry for $fname, last value wins"
        }
        $info[$fname] = $cnt
    }
    Write-Host "[EvenSplitBatch] sliceinfo loaded: $($info.Count) entries"
    if ($info.Count -eq 0) {
        throw "sliceinfo.txt has no valid entries"
    }

    $wavFiles = [System.IO.Directory]::GetFiles($batchAbs, "*.wav", [System.IO.SearchOption]::TopDirectoryOnly)
    Write-Host "[EvenSplitBatch] found $($wavFiles.Count) wav file(s) in batchDir"
    if ($wavFiles.Count -eq 0) {
        Write-Warning "[EvenSplitBatch] no wav files in $batchAbs"
        return
    }

    $processed = 0; $skipped = 0
    foreach ($wav in $wavFiles) {
        $fname = [System.IO.Path]::GetFileName($wav)
        if (-not $info.ContainsKey($fname)) {
            Write-Warning "[EvenSplitBatch] WARNING: '$fname' not listed in sliceinfo.txt, skipping"
            $skipped++
            continue
        }
        $cnt = $info[$fname]
        Write-Host ""
        Write-Host "[EvenSplitBatch] processing $fname (count=$cnt)"
        try {
            Invoke-EvenSplit -wavPath $wav -count $cnt
            $processed++
        } catch {
            Write-Warning "[EvenSplitBatch] FAILED on $fname : $($_.Exception.Message)"
            $skipped++
        }
    }
    Write-Host ""
    Write-Host "[EvenSplitBatch] done: processed=$processed skipped=$skipped"
    if ($skipped -gt 0) {
        Write-Warning "[EvenSplitBatch] $skipped file(s) skipped. Check warnings above."
    }
}

function Invoke-Scan($wavPath, $silenceThreshold, $minSilenceMs, $minSliceMs, $headTrimMs, $tailTrimMs, $sampleStep) {
    $wav = Read-WavHeader -path $wavPath
    Write-Host "[Scan] wav: $wavPath"
    Write-Host "[Scan] format=$($wav.AudioFormat) ch=$($wav.Channels) rate=$($wav.SampleRate) bits=$($wav.BitsPerSample) duration=$($wav.DurationSec)s"

    $totalSamples = [int]($wav.DataLength / ($wav.Channels * $wav.BytesPerSample))
    $samplesPerMs = $wav.SampleRate / 1000.0
    $minSilenceSamples = [int]($minSilenceMs * $samplesPerMs)
    $minSliceSamples = [int]($minSliceMs * $samplesPerMs)
    $headTrimSamples = [int]($headTrimMs * $samplesPerMs)
    $tailTrimSamples = [int]($tailTrimMs * $samplesPerMs)

    # ---- Probe: sample and report amplitude distribution ----
    $probeCount = 1000
    $probeStep = [int]([Math]::Max(1, [Math]::Floor($totalSamples / $probeCount)))
    $probeAmps = New-Object System.Collections.ArrayList
    $minAmp = 1.0; $maxAmp = 0.0; $sumAmp = 0.0; $silentCount = 0
    for ($i = 0; $i -lt $totalSamples; $i += $probeStep) {
        $amp = Get-ChannelAmplitude -wav $wav -sampleIndex $i
        [void]$probeAmps.Add($amp)
        if ($amp -lt $minAmp) { $minAmp = $amp }
        if ($amp -gt $maxAmp) { $maxAmp = $amp }
        $sumAmp += $amp
        if ($amp -lt $silenceThreshold) { $silentCount++ }
    }
    $meanAmp = $sumAmp / $probeAmps.Count
    $sorted = $probeAmps | Sort-Object
    $p50 = $sorted[[int]($sorted.Count * 0.50)]
    $p90 = $sorted[[int]($sorted.Count * 0.90)]
    $p99 = $sorted[[int]($sorted.Count * 0.99)]
    $silentPct = [Math]::Round(100.0 * $silentCount / $probeAmps.Count, 1)
    Write-Host "[Scan] amplitude probe (n=$($probeAmps.Count), step=$probeStep samples):"
    Write-Host "  min=$([Math]::Round($minAmp, 4)) max=$([Math]::Round($maxAmp, 4)) mean=$([Math]::Round($meanAmp, 4))"
    Write-Host "  p50=$([Math]::Round($p50, 4)) p90=$([Math]::Round($p90, 4)) p99=$([Math]::Round($p99, 4))"
    Write-Host "  samples below threshold($silenceThreshold): $silentCount / $($probeAmps.Count) = $silentPct%"
    $suggestedThreshold = [Math]::Round([Math]::Max($meanAmp * 2, $p50 * 1.5), 4)
    Write-Host "  suggested -SilenceThreshold: $suggestedThreshold (max(mean*2, p50*1.5))"
    if ($maxAmp -lt 0.001) {
        Write-Warning "[Scan] max amplitude too low ($maxAmp). Amplitude calc may be broken (bit-depth parse? channel offset?). Aborting."
        return
    }
    if ($silentPct -lt 1.0) {
        Write-Warning "[Scan] silent samples below 1 percent. Current threshold $silenceThreshold is too low. Try $suggestedThreshold or higher."
    } elseif ($silentPct -gt 99.0) {
        Write-Warning "[Scan] silent samples above 99 percent. Current threshold $silenceThreshold is too high (almost everything treated as silence). Try $suggestedThreshold or lower."
    }
    # ---- Probe end ----

    # ---- Windowed amplitude detection (5ms windows) ----
    # At high sample rates (e.g. 192kHz), per-sample silence classification produces too much
    # high-frequency oscillation (amp bouncing around threshold). Group samples into 5ms
    # windows and classify each window by its peak amplitude.
    $windowMs = 5
    $windowSamples = [int]([Math]::Max(1, [Math]::Floor($wav.SampleRate * $windowMs / 1000.0)))
    $numWindows = [int]($totalSamples / $windowSamples)
    if ($numWindows -lt 1) { $numWindows = 1 }
    Write-Host "[Scan] window: ${windowMs}ms = $windowSamples samples, total windows = $numWindows"

    $windowPeaks = New-Object 'double[]' $numWindows
    $isSilent = New-Object 'bool[]' $numWindows
    for ($w = 0; $w -lt $numWindows; $w++) {
        $startSample = $w * $windowSamples
        $endSample = [Math]::Min($startSample + $windowSamples, $totalSamples)
        $peak = 0.0
        # Sample up to 50 points per window for peak estimation (fast + good enough)
        $stepInWin = [Math]::Max(1, [int](($endSample - $startSample) / 50))
        for ($i = $startSample; $i -lt $endSample; $i += $stepInWin) {
            $amp = Get-ChannelAmplitude -wav $wav -sampleIndex $i
            if ($amp -gt $peak) { $peak = $amp }
        }
        $windowPeaks[$w] = $peak
        $isSilent[$w] = ($peak -lt $silenceThreshold)
    }

    # Convert ms thresholds to window units (ceil to be safe)
    $minSilenceWindows = [int]([Math]::Ceiling($minSilenceMs / $windowMs))
    $minSliceWindows = [int]([Math]::Ceiling($minSliceMs / $windowMs))
    $headTrimWindows = [int]([Math]::Ceiling($headTrimMs / $windowMs))
    $tailTrimWindows = [int]([Math]::Ceiling($tailTrimMs / $windowMs))
    Write-Host "[Scan] windowed thresholds: minSilence=$minSilenceWindows minSlice=$minSliceWindows headTrim=$headTrimWindows tailTrim=$tailTrimWindows"

    $slices = New-Object System.Collections.ArrayList
    $segmentStart = 0
    $inSilent = $isSilent[0]
    for ($w = 1; $w -lt $numWindows; $w++) {
        if ($isSilent[$w] -ne $inSilent) {
            $segmentEnd = $w
            if (-not $inSilent) {
                $segLen = $segmentEnd - $segmentStart
                if ($segLen -ge $minSliceWindows) {
                    $s = [Math]::Max(0, $segmentStart - $headTrimWindows)
                    $e = [Math]::Min($numWindows, $segmentEnd + $tailTrimWindows)
                    $peak = 0.0
                    for ($k = $s; $k -lt $e; $k++) {
                        if ($windowPeaks[$k] -gt $peak) { $peak = $windowPeaks[$k] }
                    }
                    [void]$slices.Add([pscustomobject]@{
                        name = "slice_$($($slices.Count + 1).ToString('00'))"
                        start = [Math]::Round($s * $windowSamples / $wav.SampleRate, 3)
                        end = [Math]::Round($e * $windowSamples / $wav.SampleRate, 3)
                        _peak = [Math]::Round($peak, 3)
                    })
                }
            } else {
                $silLen = $segmentEnd - $segmentStart
                if ($silLen -lt $minSilenceWindows) {
                    for ($k = $segmentStart; $k -lt $segmentEnd; $k++) { $isSilent[$k] = $false }
                }
            }
            $inSilent = $isSilent[$w]
            $segmentStart = $w
        }
    }
    if (-not $inSilent -and ($numWindows - $segmentStart) -ge $minSliceWindows) {
        $s = [Math]::Max(0, $segmentStart - $headTrimWindows)
        $e = $numWindows
        $peak = 0.0
        for ($k = $s; $k -lt $e; $k++) {
            if ($windowPeaks[$k] -gt $peak) { $peak = $windowPeaks[$k] }
        }
        [void]$slices.Add([pscustomobject]@{
            name = "slice_$($($slices.Count + 1).ToString('00'))"
            start = [Math]::Round($s * $windowSamples / $wav.SampleRate, 3)
            end = [Math]::Round($e * $windowSamples / $wav.SampleRate, 3)
            _peak = [Math]::Round($peak, 3)
        })
    }

    $fileName = [System.IO.Path]::GetFileName($wavPath)
    $fileBase = [System.IO.Path]::GetFileNameWithoutExtension($wavPath)
    $jsonPath = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($wavPath), "$fileBase.slice.json")
    $result = [ordered]@{
        source = $fileName
        outputDir = "../$fileBase/"
        _scanMeta = [ordered]@{
            sampleRate = $wav.SampleRate
            channels = $wav.Channels
            bitsPerSample = $wav.BitsPerSample
            duration = $wav.DurationSec
            silenceThreshold = $silenceThreshold
            minSilenceMs = $minSilenceMs
            minSliceMs = $minSliceMs
            headTrimMs = $headTrimMs
            tailTrimMs = $tailTrimMs
        }
        slices = $slices
    }
    $json = $result | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[Scan] done: $jsonPath"
    Write-Host "[Scan] slices found: $($slices.Count)"
    if ($slices.Count -eq 0) {
        Write-Warning "[Scan] no slices detected. Try -SilenceThreshold (current=$silenceThreshold) or -MinSilenceMs (current=$minSilenceMs)."
    } else {
        foreach ($s in $slices) {
            Write-Host "  $($s.name)  start=$($s.start)s  end=$($s.end)s  peak=$($s._peak)"
        }
    }
}

function Write-WavSlice($wav, $startSample, $endSample, $outPath) {
    $bytesPerFrame = $wav.Channels * $wav.BytesPerSample
    $startByte = $wav.DataOffset + ($startSample * $bytesPerFrame)
    $endByte = $wav.DataOffset + ($endSample * $bytesPerFrame)
    $dataLen = $endByte - $startByte
    if ($dataLen -le 0) { return $false }
    $out = New-Object byte[] (44 + $dataLen)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("RIFF"), 0, $out, 0, 4)
    [BitConverter]::GetBytes([int](36 + $dataLen)).CopyTo($out, 4)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("WAVE"), 0, $out, 8, 4)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("fmt "), 0, $out, 12, 4)
    [BitConverter]::GetBytes([int]16).CopyTo($out, 16)
    [BitConverter]::GetBytes([int16]$wav.AudioFormat).CopyTo($out, 20)
    [BitConverter]::GetBytes([int16]$wav.Channels).CopyTo($out, 22)
    [BitConverter]::GetBytes([int]$wav.SampleRate).CopyTo($out, 24)
    [BitConverter]::GetBytes([int]($wav.SampleRate * $bytesPerFrame)).CopyTo($out, 28)
    [BitConverter]::GetBytes([int16]$bytesPerFrame).CopyTo($out, 32)
    [BitConverter]::GetBytes([int16]$wav.BitsPerSample).CopyTo($out, 34)
    [System.Buffer]::BlockCopy([System.Text.Encoding]::ASCII.GetBytes("data"), 0, $out, 36, 4)
    [BitConverter]::GetBytes([int]$dataLen).CopyTo($out, 40)
    [System.Buffer]::BlockCopy($wav.Bytes, $startByte, $out, 44, $dataLen)
    [System.IO.File]::WriteAllBytes($outPath, $out)
    return $true
}

function Invoke-Slice($sliceJsonPath) {
    if (-not (Test-Path $sliceJsonPath)) { throw "Slice JSON not found: $sliceJsonPath" }
    $jsonText = [System.IO.File]::ReadAllText($sliceJsonPath)
    $cfg = $jsonText | ConvertFrom-Json
    $jsonDir = [System.IO.Path]::GetDirectoryName($sliceJsonPath)
    $wavPath = [System.IO.Path]::Combine($jsonDir, $cfg.source)
    $outDir = [System.IO.Path]::Combine($jsonDir, $cfg.outputDir)
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $wav = Read-WavHeader -path $wavPath
    Write-Host "[Slice] source: $wavPath"
    Write-Host "[Slice] outputDir: $outDir"
    Write-Host "[Slice] format=$($wav.AudioFormat) ch=$($wav.Channels) rate=$($wav.SampleRate) bits=$($wav.BitsPerSample) duration=$($wav.DurationSec)s"
    if (-not $cfg.slices -or $cfg.slices.Count -eq 0) { throw "slices is empty in $sliceJsonPath" }
    $written = 0; $skipped = 0
    $totalSamples = [int]($wav.DataLength / ($wav.Channels * $wav.BytesPerSample))
    $durationSec = $wav.DurationSec
    foreach ($s in $cfg.slices) {
        if ($s.PSObject.Properties.Name -notcontains "name" -or [string]::IsNullOrWhiteSpace($s.name)) {
            Write-Warning "[Slice] skip slice without name"; $skipped++; continue
        }
        if ($s.PSObject.Properties.Name -notcontains "start" -or $s.PSObject.Properties.Name -notcontains "end") {
            Write-Warning "[Slice] skip $($s.name): missing start/end"; $skipped++; continue
        }
        $start = [double]$s.start; $end = [double]$s.end
        if ($start -ge $end) {
            Write-Warning "[Slice] skip $($s.name): start($start) >= end($end)"; $skipped++; continue
        }
        if ($start -lt 0 -or $end -gt $durationSec) {
            Write-Warning "[Slice] skip $($s.name): out of range (start=$start end=$end duration=$durationSec)"; $skipped++; continue
        }
        $startSample = [int]([Math]::Floor($start * $wav.SampleRate))
        $endSample = [int]([Math]::Ceiling($end * $wav.SampleRate))
        if ($endSample -gt $totalSamples) { $endSample = $totalSamples }
        if ($startSample -ge $endSample) {
            Write-Warning "[Slice] skip $($s.name): zero samples"; $skipped++; continue
        }
        $outPath = [System.IO.Path]::Combine($outDir, "$($s.name).wav")
        $ok = Write-WavSlice -wav $wav -startSample $startSample -endSample $endSample -outPath $outPath
        if ($ok) {
            $written++
            Write-Host "  $($s.name).wav  [$($start)s - $($end)s]  -> $outPath"
        } else {
            $skipped++
        }
    }
    Write-Host "[Slice] done: written=$written skipped=$skipped"
}

if ($Mode -eq "Scan") {
    if ([string]::IsNullOrWhiteSpace($WavPath)) { throw "Scan mode requires -WavPath <wav path>" }
    Invoke-Scan -wavPath $WavPath -silenceThreshold $SilenceThreshold -minSilenceMs $MinSilenceMs -minSliceMs $MinSliceMs -headTrimMs $HeadTrimMs -tailTrimMs $TailTrimMs -sampleStep $SampleStep
} elseif ($Mode -eq "Slice") {
    if ([string]::IsNullOrWhiteSpace($SliceJson)) { throw "Slice mode requires -SliceJson <json path>" }
    Invoke-Slice -sliceJsonPath $SliceJson
} elseif ($Mode -eq "EvenSplit") {
    if ([string]::IsNullOrWhiteSpace($WavPath)) { throw "EvenSplit mode requires -WavPath <wav path>" }
    if (-not $Count -or $Count -lt 1) { throw "EvenSplit mode requires -Count <integer >= 1>" }
    Invoke-EvenSplit -wavPath $WavPath -count $Count
} elseif ($Mode -eq "EvenSplitBatch") {
    if ([string]::IsNullOrWhiteSpace($BatchDir)) { throw "EvenSplitBatch mode requires -BatchDir <dir>" }
    if ([string]::IsNullOrWhiteSpace($SliceInfo)) { throw "EvenSplitBatch mode requires -SliceInfo <txt path>" }
    Invoke-EvenSplitBatch -batchDir $BatchDir -sliceInfoPath $SliceInfo
}