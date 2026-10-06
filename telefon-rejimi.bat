@echo off
rem YouTube Machine - telefon va boshqa kompyuterdan (shu Wi-Fi tarmog'ida) foydalanish rejimi.
rem Dastur parol bilan himoyalanadi. Parol data\app-password.txt faylida saqlanadi.
chcp 65001 >nul
cd /d "%~dp0"
if not exist data mkdir data
set "APP_PASSWORD="
if exist "data\app-password.txt" set /p APP_PASSWORD=<"data\app-password.txt"
if defined APP_PASSWORD goto have_password

echo.
echo Telefondan kirish uchun parol o'ylab toping - kamida 8 belgi, faqat harf va raqam.
echo Bu parol keyingi safar so'ralmaydi. O'zgartirish uchun data\app-password.txt ni o'chiring.
echo.
:ask
set "APP_PASSWORD="
set /p "APP_PASSWORD=Parol: "
if not defined APP_PASSWORD goto ask
echo %APP_PASSWORD%| findstr /r "^[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]*$" >nul
if errorlevel 1 (
  echo Kamida 8 ta harf yoki raqam bo'lsin. Qayta kiriting.
  goto ask
)
>"data\app-password.txt" echo %APP_PASSWORD%

:have_password
set "HOST=0.0.0.0"
rem hamma-joydan.bat orqali kelinsa, o'z yo'riqnomasini o'zi chiqargan
if defined TS_URL goto launch
echo.
echo ============================================================
echo  TELEFON REJIMI
echo  1. Windows "ruxsat berasizmi" deb so'rasa - "Private" tarmoqqa ruxsat bering.
echo  2. Telefon shu kompyuter bilan BIR Wi-Fi'da bo'lsin.
echo  3. Pastda chiqadigan http://192.168... manzilni telefonda oching.
echo  4. Login - istalgan so'z, parol - siz bergan parol.
echo ============================================================
:launch
call "%~dp0ishga-tushirish.bat"
