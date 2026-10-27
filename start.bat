@echo off
REM Start Kantor Kita (task server + 3D office). Double-click this file.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22+ tidak ditemukan. Install dari https://nodejs.org & pause & exit /b 1)
if not exist .env (echo .env tidak ada. Copy .env.example jadi .env lalu isi. & pause & exit /b 1)
echo Menjalankan Kantor Kita di http://127.0.0.1:3000 ...
start "" http://127.0.0.1:3000
node server\server.js
pause
