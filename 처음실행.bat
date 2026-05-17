@echo off
chcp 65001 > nul
title 전담교사 시간표 도우미 - 처음 실행

echo.
echo ==========================================
echo  전담교사 시간표 도우미를 준비합니다
echo ==========================================
echo.
echo 이 창은 닫지 마세요.
echo 처음 실행이라면 필요한 파일을 설치한 뒤 앱을 시작합니다.
echo.

cd /d "%~dp0"

if not exist package.json (
  echo package.json 파일을 찾을 수 없습니다.
  echo 이 bat 파일이 프로젝트 폴더 안에 있는지 확인해주세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 필요한 파일을 설치하는 중입니다. 처음에는 시간이 조금 걸릴 수 있습니다.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo 설치 중 문제가 생겼습니다.
    echo Node.js가 제대로 설치되어 있는지 확인해주세요.
    pause
    exit /b 1
  )
)

echo.
echo 앱을 시작합니다.
echo 브라우저에서 아래 주소를 열어주세요.
echo.
echo http://localhost:5173
echo.

call npm.cmd run dev
pause
