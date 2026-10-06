@echo off
rem Kompyuter yoqilganda YouTube Machine o'zi ishga tushishini o'chiradi.
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\YouTube Machine.bat" >nul 2>nul
del "%~dp0data\hamma-joydan-sozlandi.txt" >nul 2>nul
echo Avtomatik ishga tushish o'chirildi.
pause
