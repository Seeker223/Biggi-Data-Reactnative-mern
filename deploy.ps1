#!/usr/bin/env pwsh
# Deploy script for Biggi Data backend fix

Write-Host "🚀 Deploying BiggiHouse fix to production..." -ForegroundColor Cyan

# Check git status
Write-Host "`n📋 Checking git status..." -ForegroundColor Yellow
git status

# Stage changes
Write-Host "`n📝 Staging changes..." -ForegroundColor Yellow
git add -A

# Commit
Write-Host "`n💾 Committing changes..." -ForegroundColor Yellow
git commit -m "Fix: Add missing user variable in joinBiggiHouse controller to resolve 401 errors"

# Push to main
Write-Host "`n🔄 Pushing to main branch..." -ForegroundColor Yellow
git push origin main

Write-Host "`n✅ Deployment complete! Render will auto-deploy the changes." -ForegroundColor Green
Write-Host "Monitor your deployment at: https://dashboard.render.com" -ForegroundColor Cyan
