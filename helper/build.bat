@echo off
REM Build script for Windows helper binary

echo Building gettoken helper for Windows...

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH
    exit /b 1
)

REM Install dependencies
echo Installing dependencies...
pip install pyinstaller DrissionPage

REM Build the binary (cf_bypasser.py will be included automatically)
echo Building binary...
pyinstaller --onefile --name gettoken-windows-amd64 get_token.py

REM Copy to backend/bin
echo Copying binary to backend/bin...
if not exist ..\backend\bin mkdir ..\backend\bin
copy dist\gettoken-windows-amd64.exe ..\backend\bin\gettoken-windows-amd64.exe

echo.
echo Build complete! Binary saved to: backend\bin\gettoken-windows-amd64.exe
echo.

pause
