@echo off
rem YouTube Machine - Windows uchun bir bosishda ishga tushirish.
rem Birinchi marta Node.js va ffmpeg yo'q bo'lsa, ularni winget orqali o'zi o'rnatadi.
chcp 65001 >nul
title YouTube Machine
cd /d "%~dp0"
rem Eski yangilash.bat bo'lsa, yangisiga almashtiramiz (u o'zini o'zi yangilay olmaydi)
if exist "tools\yangilash.bat" fc /b "tools\yangilash.bat" "yangilash.bat" >nul 2>nul || copy /y "tools\yangilash.bat" "yangilash.bat" >nul
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\WinGet\Links"
call :find_ffmpeg

where node >nul 2>nul
if not errorlevel 1 goto check_ffmpeg
echo.
echo [1/2] Node.js topilmadi - o'rnatilmoqda (bir necha daqiqa)...
where winget >nul 2>nul
if errorlevel 1 goto no_winget
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
where node >nul 2>nul
if errorlevel 1 goto restart_needed

:check_ffmpeg
call :find_ffmpeg
where ffmpeg >nul 2>nul
if not errorlevel 1 goto run
echo.
echo [2/2] ffmpeg topilmadi - o'rnatilmoqda (bir necha daqiqa)...
where winget >nul 2>nul
if errorlevel 1 goto no_winget
winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
call :find_ffmpeg
where ffmpeg >nul 2>nul
if errorlevel 1 goto restart_needed

:run
echo.
echo Dastur ishga tushmoqda. Brauzer o'zi ochiladi.
echo Bu oynani YOPMANG - yopilsa, dastur to'xtaydi.
echo.
if not defined NO_BROWSER start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:4300"
node server.js
echo.
pause
exit /b

:restart_needed
echo.
echo O'rnatish tugadi. Iltimos, shu oynani yoping va "ishga-tushirish.bat" ni QAYTA ikki marta bosing.
echo.
pause
exit /b

:no_winget
echo.
echo Bu kompyuterda winget yo'q. Quyidagilarni qo'lda o'rnating, so'ng faylni qayta bosing:
echo   1) Node.js LTS:  https://nodejs.org
echo   2) ffmpeg:       https://www.gyan.dev/ffmpeg/builds/
start "" https://nodejs.org
echo.
pause
exit /b

:find_ffmpeg
rem winget ffmpeg'ni ba'zan PATH'ga qo'shmaydi - uni o'rnatilgan papkasidan qidiramiz.
where ffmpeg >nul 2>nul
if not errorlevel 1 exit /b
set "FFDIR="
for /f "delims=" %%F in ('dir /s /b "%LOCALAPPDATA%\Microsoft\WinGet\Packages\ffmpeg.exe" 2^>nul') do set "FFDIR=%%~dpF"
if not defined FFDIR for /f "delims=" %%F in ('dir /s /b "%ProgramFiles%\WinGet\Packages\ffmpeg.exe" 2^>nul') do set "FFDIR=%%~dpF"
if not defined FFDIR for /f "delims=" %%F in ('dir /s /b "C:\ffmpeg\ffmpeg.exe" 2^>nul') do set "FFDIR=%%~dpF"
if defined FFDIR set "PATH=%PATH%;%FFDIR%"
exit /b
