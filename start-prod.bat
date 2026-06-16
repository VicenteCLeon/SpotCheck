@echo off
title SpotCheck - Produccion
echo =============================================
echo   SpotCheck - Modo Produccion
echo =============================================
echo.

:: ── 1. Backend ──────────────────────────────────────────────────────────────
echo [1/3] Iniciando backend...
cd backend

if not exist venv (
    echo Creando entorno virtual con Python 3.12...
    py -3.12 -m venv venv
    if errorlevel 1 (
        echo ERROR: Python 3.12 no encontrado.
        pause & exit /b 1
    )
)

call venv\Scripts\activate
echo Instalando/verificando dependencias...
pip install -r requirements.txt -q

echo Arrancando uvicorn en puerto 8000 (modo produccion, sin reload)...
start "SpotCheck Backend" /min cmd /c "venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers >> logs\backend.log 2>&1"
cd ..

:: Esperar a que el backend levante antes de abrir el tunel
timeout /t 4 /nobreak >nul

:: ── 2. Ngrok (tunel HTTPS publico) ─────────────────────────────────────────
echo [2/3] Abriendo tunel ngrok...

:: Verifica que ngrok este instalado
where ngrok >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: ngrok no encontrado en el PATH.
    echo Descargalo desde https://ngrok.com/download, extraelo y agrega la carpeta al PATH.
    echo Tambien necesitas autenticarte: ngrok config add-authtoken TU_TOKEN
    echo.
    pause & exit /b 1
)

:: Levanta el tunel. SIN --config: ngrok usa el config global (con tu authtoken).
:: Pasar --config con un archivo sin token lo haria fallar (ERR_NGROK_4018).
:: La ventana queda visible: ngrok muestra ahi mismo la URL "Forwarding".
start "ngrok" ngrok http --domain=anaerobic-cannot-composure.ngrok-free.dev 8000

echo.
echo [3/3] Esperando que el tunel este listo...

:: Lee la URL publica desde la API local de ngrok, reintentando hasta 15s
:: (ngrok tarda un par de segundos en establecer la sesion).
for /f "tokens=*" %%u in ('powershell -NoProfile -Command "$u=$null; for($i=0;$i -lt 15 -and -not $u;$i++){try{$u=((Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels ^| Where-Object {$_.proto -eq 'https'}).public_url}catch{Start-Sleep 1}}; $u"') do set NGROK_URL=%%u

echo.
echo =============================================
if defined NGROK_URL (
    echo   URL publica del backend:
    echo   %NGROK_URL%
    echo.
    echo   Usa esta URL como VITE_API_BASE en Vercel
    echo   y como PUBLIC_BACKEND_URL en backend\.env
) else (
    echo   No se pudo leer la URL de ngrok automaticamente.
    echo   Abre http://localhost:4040 en el navegador para verla.
)
echo =============================================
echo.
echo Logs del backend: backend\logs\backend.log
echo Panel de ngrok:   http://localhost:4040
echo.
echo Presiona Ctrl+C en las ventanas de "SpotCheck Backend" y "ngrok" para detener.
echo.
pause
