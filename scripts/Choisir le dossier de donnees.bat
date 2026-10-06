@echo off
rem ============================================================================
rem  Choisir le dossier de données de suivi-facturation  (double-clic)
rem  Écrit ERGO_DATA_DIR dans le fichier .env du projet (jamais écrasé sans confirmation).
rem  Aucune élévation de droits, aucun accès réseau, aucun secret.
rem  Fichier encodé en UTF-8 (sans BOM), fins de ligne Windows.
rem ============================================================================
chcp 65001 >nul
title suivi-facturation - dossier de données
cd /d "%~dp0.."
if errorlevel 1 goto :dossier_introuvable

where node >nul 2>nul
if errorlevel 1 goto :node_absent
set "NODE_MAJEUR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "NODE_MAJEUR=%%v"
if not defined NODE_MAJEUR goto :node_absent
if %NODE_MAJEUR% LSS 24 goto :node_absent

node scripts\choisir-dossier.mjs %*
goto :fin

:node_absent
echo.
echo  Node.js 24 n'est pas installé : double-cliquez d'abord sur "Lancer suivi-facturation",
echo  qui explique comment l'installer.
goto :fin

:dossier_introuvable
echo.
echo  Impossible d'accéder au dossier du projet. Ce fichier doit rester dans le dossier "scripts".
goto :fin

:fin
echo.
pause
