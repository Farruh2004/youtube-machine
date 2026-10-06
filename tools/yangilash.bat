@echo off
rem YouTube Machine - eng so'nggi versiyaga yangilash.
rem Yangi kodni GitHub'dan yuklab, shu papkaga ko'chiradi. "data" papkasi (sozlamalar,
rem kalitlar, videolar) va shu faylning o'ziga tegilmaydi. Manba: update-source.txt
chcp 65001 >nul
title YouTube Machine - yangilash
cd /d "%~dp0"

echo.
echo Yangilashdan oldin dasturning qora oynasini yoping (Ctrl+C yoki X).
echo.
pause

echo Yangi versiya yuklanmoqda...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\yangilash.ps1"
if errorlevel 1 (
  echo.
  echo Yangilab bo'lmadi. Internet aloqasini tekshiring va qayta urinib ko'ring.
  echo.
  pause
  exit /b 1
)

echo.
echo Tayyor! Endi "ishga-tushirish.bat" ni bosing.
echo.
pause
rem Shu faylning yangi versiyasi bo'lsa, oxirida almashtiriladi (bir qatorda - ishlab turgan fayl buzilmaydi)
if exist "yangilash.new.bat" move /y "yangilash.new.bat" "yangilash.bat" >nul & exit /b 0
