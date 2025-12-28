@echo off
echo INICIANDO MODO ACCESO EXTERNO (ngrok + frontend dinamico)
echo.

:: Variables
set CONFIG_FILE=src\assets\config.js
set NGROK_CONFIG=ngrok.yml
set NGROK_API=http://127.0.0.1:4040/api/tunnels

REM Resetear config.js a valor por defecto
echo window.NGROK_BACKEND_URL = 'http://localhost:3000'; > %CONFIG_FILE%
echo Config.js reseteado a localhost

REM Iniciar backend
echo Iniciando backend...
start cmd /k "npm run start:backend"
timeout /t 5 >nul

REM Iniciar frontend
echo Iniciando frontend...
start cmd /k "npm run start:frontend"
timeout /t 5 >nul

REM Iniciar ngrok usando el archivo de configuracion
echo Iniciando ngrok...
start "" cmd /k "ngrok start --all --config %NGROK_CONFIG%"
timeout /t 10 >nul

setlocal enabledelayedexpansion
echo Esperando a que ngrok este listo...

REM Obtener IP local
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "127.0.0.1"') do (
    for /f "tokens=1" %%j in ("%%i") do set LOCAL_IP=%%j
)
set LOCAL_IP=%LOCAL_IP: =%
echo IP local: %LOCAL_IP%

REM Intentar obtener URL del backend con metodo mejorado
set /a tries=0
set BACKEND_URL=

:wait_backend_tunnel
set /a tries+=1
echo Intento !tries!: Consultando API de ngrok...

REM Crear script temporal de PowerShell para obtener la URL
echo try { > temp_get_url.ps1
echo   $response = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 10 >> temp_get_url.ps1
echo   $backend = $response.tunnels ^| Where-Object { $_.config.addr -match "3000" } >> temp_get_url.ps1
echo   if ($backend) { >> temp_get_url.ps1
echo     Write-Output $backend[0].public_url >> temp_get_url.ps1
echo   } else { >> temp_get_url.ps1
echo     Write-Output "NOT_FOUND" >> temp_get_url.ps1
echo   } >> temp_get_url.ps1
echo } catch { >> temp_get_url.ps1
echo   Write-Output "ERROR" >> temp_get_url.ps1
echo } >> temp_get_url.ps1

for /f "delims=" %%i in ('powershell -ExecutionPolicy Bypass -File temp_get_url.ps1') do set BACKEND_URL=%%i
del temp_get_url.ps1 >nul 2>&1

echo Resultado: [%BACKEND_URL%]

if "%BACKEND_URL%"=="NOT_FOUND" (
    if !tries! LSS 12 (
        echo Tunel no encontrado aun, reintentando...
        timeout /t 3 >nul
        goto wait_backend_tunnel
    ) else (
        echo No se encontro tunel de ngrok. Usando IP local.
        set BACKEND_URL=http://%LOCAL_IP%:3000
    )
) else if "%BACKEND_URL%"=="ERROR" (
    echo Error consultando API. Usando IP local.
    set BACKEND_URL=http://%LOCAL_IP%:3000
) else if "%BACKEND_URL%"=="" (
    echo URL vacia. Usando IP local.
    set BACKEND_URL=http://%LOCAL_IP%:3000
) else (
    echo URL del backend obtenida: %BACKEND_URL%
)

echo.
echo === ACTUALIZANDO CONFIGURACION ===
echo Backend URL: %BACKEND_URL%

REM Limpiar espacios finales de la URL
for %%i in ("%BACKEND_URL%") do set BACKEND_URL=%%~i

REM Actualizar config.js de forma segura
> "%CONFIG_FILE%" echo window.NGROK_BACKEND_URL = "%BACKEND_URL%";
>> "%CONFIG_FILE%" echo console.log("[@start-ngrok] Backend configurado: %BACKEND_URL%");

echo.
echo Archivo %CONFIG_FILE% actualizado:
type "%CONFIG_FILE%"

REM Obtener URL del frontend si existe
echo try { > temp_get_frontend.ps1
echo   $response = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5 >> temp_get_frontend.ps1
echo   $frontend = $response.tunnels ^| Where-Object { $_.config.addr -match "4200" } >> temp_get_frontend.ps1
echo   if ($frontend) { >> temp_get_frontend.ps1
echo     Write-Output $frontend[0].public_url >> temp_get_frontend.ps1
echo   } else { >> temp_get_frontend.ps1
echo     Write-Output "NO_FRONTEND_TUNNEL" >> temp_get_frontend.ps1
echo   } >> temp_get_frontend.ps1
echo } catch { >> temp_get_frontend.ps1
echo   Write-Output "NO_FRONTEND_TUNNEL" >> temp_get_frontend.ps1
echo } >> temp_get_frontend.ps1

for /f "delims=" %%i in ('powershell -ExecutionPolicy Bypass -File temp_get_frontend.ps1') do set FRONTEND_NGROK=%%i
del temp_get_frontend.ps1 >nul 2>&1

:done
echo.
echo ================================
echo    APLICACION LISTA PARA USO
echo ================================
echo Frontend local:      http://localhost:4200
echo Frontend red local:  http://%LOCAL_IP%:4200
if not "%FRONTEND_NGROK%"=="NO_FRONTEND_TUNNEL" (
    echo Frontend publico:    %FRONTEND_NGROK%
)
echo Backend local:       http://localhost:3000
echo Backend configurado: %BACKEND_URL%
echo.
echo === ACCESO DESDE MOVIL ===
echo WiFi local: http://%LOCAL_IP%:4200
if not "%FRONTEND_NGROK%"=="NO_FRONTEND_TUNNEL" (
    echo Internet:   %FRONTEND_NGROK%
)
echo.
echo NOTA: Si ya tenias la aplicacion abierta, recarga la pagina
echo      para que tome la nueva configuracion del backend.
echo.
echo Presiona cualquier tecla para cerrar servicios...
pause >nul

REM Limpiar procesos
echo Cerrando servicios...
taskkill /f /im ngrok.exe >nul 2>&1
for /f "tokens=2" %%i in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV ^| find "node.exe"') do taskkill /F /PID %%i >nul 2>&1

REM Restaurar configuracion local
echo window.NGROK_BACKEND_URL = 'http://localhost:3000'; > %CONFIG_FILE%
echo.
echo Servicios cerrados. Config restaurado a localhost.