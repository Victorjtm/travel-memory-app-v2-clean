param(
    [string]$Fecha = "",
    [string]$DestDir = "",
    [string[]]$NombresManifest = @()
)

$Output = @{
    success = $false
    mensaje = ""
    videos = @()
}

try {
    if (-not $DestDir) {
        $DestDir = Join-Path $env:TEMP "mtp_dynamics_videos"
    }
    if (-not (Test-Path $DestDir)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    }

    $shell = New-Object -ComObject Shell.Application
    $thisPc = $shell.Namespace(17) # 17 = ssfDRIVES / This PC
    $phone = $null

    # 1. Localizar dispositivo móvil MTP
    foreach ($item in $thisPc.Items()) {
        if ($item.Path -match "usb#vid_2717" -or $item.Name -match "Redmi|Xiaomi|Android|Phone|Móvil|Movil") {
            $phone = $item.GetFolder
            if ($phone) { break }
        }
    }

    # Fallback si no coincidió por nombre: buscar primer dispositivo con almacenamiento interno
    if (-not $phone) {
        foreach ($item in $thisPc.Items()) {
            if ($item.Path -match "^::\{" -and $item.IsFolder) {
                $f = $item.GetFolder
                if ($f -and ($f.Items() | Where-Object { $_.Name -match "Almacenamiento|Internal|Storage" })) {
                    $phone = $f
                    break
                }
            }
        }
    }

    if (-not $phone) {
        $Output.mensaje = "No se detectó ningún dispositivo móvil MTP conectado por USB."
        Write-Output ($Output | ConvertTo-Json -Compress)
        exit 0
    }

    # 2. Localizar almacenamiento interno
    $storage = $null
    foreach ($it in $phone.Items()) {
        if ($it.Name -match "Almacenamiento|Internal|Storage|compartido") {
            $storage = $it.GetFolder
            break
        }
    }
    if (-not $storage) {
        $storage = $phone.Items().Item(0).GetFolder
    }

    if (-not $storage) {
        $Output.mensaje = "No se pudo acceder al almacenamiento interno del dispositivo."
        Write-Output ($Output | ConvertTo-Json -Compress)
        exit 0
    }

    # 3. Localizar carpetas objetivo:
    # Opción 1: DCIM/AudioPhotoApp/videos (Recomendada)
    # Opción 2: DCIM/AudioPhotoApp (Alternativa)
    $dcim = $null
    foreach ($it in $storage.Items()) {
        if ($it.Name -eq "DCIM") {
            $dcim = $it.GetFolder
            break
        }
    }

    $apa = $null
    $videosFolder = $null
    if ($dcim) {
        foreach ($it in $dcim.Items()) {
            if ($it.Name -eq "AudioPhotoApp") {
                $apa = $it.GetFolder
                break
            }
        }
        if ($apa) {
            foreach ($it in $apa.Items()) {
                if ($it.Name -eq "videos") {
                    $videosFolder = $it.GetFolder
                    break
                }
            }
        }
    }

    $foldersToSearch = @()
    if ($videosFolder) {
        $foldersToSearch += @{ Folder = $videosFolder; Name = "DCIM/AudioPhotoApp/videos" }
    }
    if ($apa) {
        $foldersToSearch += @{ Folder = $apa; Name = "DCIM/AudioPhotoApp" }
    }

    if ($foldersToSearch.Count -eq 0) {
        $Output.mensaje = "No se encontraron las carpetas DCIM/AudioPhotoApp en el dispositivo móvil."
        Write-Output ($Output | ConvertTo-Json -Compress)
        exit 0
    }

    $destShellFolder = $shell.Namespace($DestDir)
    $extractedFiles = @()
    $processedNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    function Matches-Date($fileName, $targetDate) {
        if (-not $targetDate) { return $true }
        
        $cleanTarget = $targetDate -replace "[^\d]",""
        if ($fileName -match $targetDate -or ($cleanTarget -and $fileName -match $cleanTarget)) { return $true }

        if ($fileName -match "(\d{13})") {
            try {
                $epoch = [int64]$matches[1]
                $dt = [DateTimeOffset]::FromUnixTimeMilliseconds($epoch).LocalDateTime
                $dtStr = $dt.ToString("yyyyMMdd")
                if ($dtStr -eq $cleanTarget -or $dt.ToString("yyyy-MM-dd") -eq $targetDate) { return $true }
            } catch {}
        }

        if ($cleanTarget.Length -eq 8) {
            $withHyphens = "$($cleanTarget.Substring(0,4))-$($cleanTarget.Substring(4,2))-$($cleanTarget.Substring(6,2))"
            if ($fileName -match $withHyphens) { return $true }
            $withUnderscores = "$($cleanTarget.Substring(0,4))_$($cleanTarget.Substring(4,2))_$($cleanTarget.Substring(6,2))"
            if ($fileName -match $withUnderscores) { return $true }
        }

        return $false
    }

    foreach ($fEntry in $foldersToSearch) {
        $fObj = $fEntry.Folder
        foreach ($item in $fObj.Items()) {
            if ($item.IsFolder) { continue }
            $name = $item.Name
            
            if ($name -notmatch "\.(mp4|3gp|mov)$") {
                if ($name -notmatch "^(VIDEO_|VID_)" -and $name -notmatch "\.mp4$") {
                    continue
                }
            }

            $normalizedName = if ($name -match "\.(mp4|3gp|mov)$") { $name } else { "$name.mp4" }

            if ($processedNames.Contains($normalizedName)) { continue }

            $coincide = $false
            if ($NombresManifest.Count -gt 0) {
                foreach ($nm in $NombresManifest) {
                    $nmClean = $nm -replace "\.(mp4|3gp|mov)$",""
                    $baseClean = $normalizedName -replace "\.(mp4|3gp|mov)$",""
                    if ($baseClean -match [regex]::Escape($nmClean) -or $nmClean -match [regex]::Escape($baseClean)) {
                        $coincide = $true
                        break
                    }
                }
            }

            if (-not $coincide -and $Fecha) {
                $coincide = Matches-Date $normalizedName $Fecha
            }

            if ($coincide) {
                $destShellFolder.CopyHere($item, 20)
                
                $expectedPath = Join-Path $DestDir $normalizedName
                $timeout = 0
                while (-not (Test-Path $expectedPath) -and $timeout -lt 30) {
                    Start-Sleep -Milliseconds 200
                    $timeout++
                }

                if (Test-Path $expectedPath) {
                    $fileInfo = Get-Item $expectedPath
                    $extractedFiles += @{
                        nombre = $normalizedName
                        ruta = $expectedPath
                        tamano = $fileInfo.Length
                        origen = $fEntry.Name
                    }
                    $processedNames.Add($normalizedName) | Out-Null
                }
            }
        }

        if ($extractedFiles.Count -gt 0 -and $fEntry.Name -eq "DCIM/AudioPhotoApp/videos") {
            break
        }
    }

    $Output.success = $true
    $Output.mensaje = "Búsqueda completada. Se extrajeron $($extractedFiles.Count) vídeos."
    $Output.videos = $extractedFiles
    Write-Output ($Output | ConvertTo-Json -Compress)

} catch {
    $Output.success = $false
    $Output.mensaje = "Error durante la extracción MTP: $($_.Exception.Message)"
    Write-Output ($Output | ConvertTo-Json -Compress)
}
