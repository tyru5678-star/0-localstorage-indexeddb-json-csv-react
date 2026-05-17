@echo off
chcp 65001 > nul
title 전담교사 시간표 도우미 - 실행

cd /d "%~dp0"

echo.
echo 전담교사 시간표 도우미를 시작합니다.
echo 브라우저에서 아래 주소를 열어주세요.
echo.
echo http://localhost:5173
echo.

call npm.cmd run dev
pause
