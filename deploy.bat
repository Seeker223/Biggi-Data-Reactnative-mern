@echo off
REM Deploy script for Biggi Data backend fix

cd /d "C:\Users\Deredz\Documents\Web Apps\Biggi-Data-Reactnative-mern"

echo.
echo === Deploying BiggiHouse fix to production ===
echo.

echo Checking git status...
git status

echo.
echo Staging changes...
git add -A

echo.
echo Committing changes...
git commit -m "Fix: Add missing user variable in joinBiggiHouse controller to resolve 401 errors"

echo.
echo Pushing to main branch...
git push origin main

echo.
echo === Deployment complete! ===
echo Monitor your deployment at: https://dashboard.render.com
pause
