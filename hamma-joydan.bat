@echo off
rem YouTube Machine - istalgan joydan (telefon, boshqa kompyuter) xavfsiz kirish.
rem Tailscale shaxsiy tarmog'i orqali: dastur ochiq internetga chiqmaydi, faqat sizning
rem qurilmalaringiz ko'radi. API kalitlar shu kompyuterda (data papkasida) qoladi.
chcp 65001 >nul
title YouTube Machine - hamma joydan
cd /d "%~dp0"
if not exist data mkdir data
set "PATH=%PATH%;%ProgramFiles%\Tailscale"

where tailscale >nul 2>nul
if not errorlevel 1 goto ts_login
echo.
echo [1/3] Tailscale o'rnatilmoqda - bepul, bir martalik...
where winget >nul 2>nul
if errorlevel 1 goto ts_manual
winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
where tailscale >nul 2>nul
if not errorlevel 1 goto ts_login

:ts_manual
echo.
echo Tailscale'ni qo'lda o'rnating: https://tailscale.com/download/windows
echo O'rnatib bo'lgach, shu faylni qayta bosing.
start "" https://tailscale.com/download/windows
pause
exit /b

:ts_login
tailscale status >nul 2>nul
if not errorlevel 1 goto ts_ready
echo.
echo [2/3] Tailscale'ga kiring. Pastda havola chiqadi - Ctrl tugmasini bosib turib havolani bosing
echo       va Google akkauntingiz bilan kiring. Telefonda ham AYNAN SHU akkauntga kirasiz.
echo.
tailscale up
echo Tailscale'ga kirishingiz kutilmoqda...
:ts_wait
tailscale status >nul 2>nul
if not errorlevel 1 goto ts_ready
timeout /t 3 /nobreak >nul
goto ts_wait

:ts_ready
set "TS_IP="
for /f "delims=" %%I in ('tailscale ip -4 2^>nul') do if not defined TS_IP set "TS_IP=%%I"

rem Windows himoya devori: 4300-portni FAQAT Tailscale tarmog'i uchun ochamiz (bir marta, "Yes" bosing)
netsh advfirewall firewall show rule name=YouTubeMachineTailscale >nul 2>nul
if not errorlevel 1 goto fw_done
echo.
echo [3/3] Himoya devori: Windows ruxsat so'rasa "Yes" ni bosing (faqat Tailscale uchun ochiladi).
powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'advfirewall firewall add rule name=YouTubeMachineTailscale dir=in action=allow protocol=TCP localport=4300 remoteip=100.64.0.0/10'"
:fw_done

rem Bir martalik savollar: kompyuter yoqilganda o'zi ishga tushsinmi, uxlab qolmasinmi
if exist "data\hamma-joydan-sozlandi.txt" goto start_app
echo.
choice /c HY /m "Kompyuter yoqilganda dastur o'zi ishga tushsinmi? H - ha, Y - yo'q"
if errorlevel 2 goto ask_sleep
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\YouTube Machine.bat" echo @echo off
>> "%STARTUP%\YouTube Machine.bat" echo set NO_BROWSER=1
>> "%STARTUP%\YouTube Machine.bat" echo start "YouTube Machine" /min cmd /c ""%~dp0hamma-joydan.bat""
echo Tayyor: kompyuter yoqilganda dastur o'zi ishga tushadi. O'chirish uchun "avtostart-ochirish.bat" ni bosing.
:ask_sleep
echo.
choice /c HY /m "Elektrga ulanganda kompyuter uxlab qolmasinmi - aks holda uzoqdan kirib bo'lmaydi? H - ha, Y - yo'q"
if errorlevel 2 goto asked
powercfg /change standby-timeout-ac 0
echo Tayyor: elektrga ulanganda kompyuter uxlamaydi. Ekran baribir o'chadi.
:asked
> "data\hamma-joydan-sozlandi.txt" echo 1

:start_app
set "TS_URL=http://%TS_IP%:4300"
echo.
echo ============================================================
echo  HAMMA JOYDAN KIRISH
echo  Telefonda: Tailscale ilovasini o'rnating - App Store / Play Market,
echo     shu Google akkauntga kiring va uni yoqing.
echo  So'ng telefon brauzerida oching:  %TS_URL%
echo  Login - istalgan so'z, parol - dastur paroli.
echo  Bu manzil doimiy: bir marta "Bosh ekranga qo'shish" qiling.
echo  Kompyuter yoqiq va bu oyna ochiq turishi kerak.
echo ============================================================
call "%~dp0telefon-rejimi.bat"
