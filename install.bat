@echo off
title QwenProxy Installer
echo === QwenProxy: Instalador y Compilador Automático ===
echo.

:: 1. Verificar si Node.js está instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no está instalado en este sistema.
    echo Por favor descarga e instala Node.js [Version 20 o superior] desde https://nodejs.org/
    pause
    exit /b
)

:: 2. Instalar dependencias
echo [1/5] Instalando dependencias de Node.js...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Hubo un error al instalar las dependencias.
    pause
    exit /b
)

:: 3. Instalar navegadores de Playwright
echo.
echo [2/5] Instalando motores de Playwright (Chromium)...
call npx playwright install chromium
call npx playwright install
if %errorlevel% neq 0 (
    echo [ERROR] No se pudo instalar Chromium para Playwright.
    pause
    exit /b
)

:: 4. Crear archivo .env si no existe
echo.
echo [3/5] Configurando variables de entorno (.env)...
if not exist .env (
    copy .env.example .env >nul
    echo Archivo .env creado a partir de .env.example.
) else (
    echo El archivo .env ya existe, saltando...
)

:: 5. Compilar el proyecto
echo.
echo [4/5] Compilando backend TypeScript y frontend React de forma integrada...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Falló la compilación del proyecto (backend/frontend).
    pause
    exit /b
)

:: 6. Lanzar configuración de login
echo.
echo [5/5] Instalacion completada con exito.
echo.
set /p start_choice="Deseas iniciar el servidor y abrir el panel administrativo ahora? (S/N): "
if /i "%start_choice%"=="S" (
    call npm start
)

echo.
echo Proceso de configuracion terminado. Usa "npm start" para arrancar el servidor en cualquier momento.
pause
