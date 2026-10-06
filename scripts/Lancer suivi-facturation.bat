@echo off
rem ============================================================================
rem  Lancer suivi-facturation  (double-clic)  -  MODE DIAGNOSTIC (fenêtre visible)
rem  - se place dans le dossier du projet ;
rem  - vérifie que Node.js 24 est installé ;
rem  - démarre le serveur local (127.0.0.1 uniquement), en lisant .env s'il existe ;
rem  - ouvre le navigateur par défaut sur l'application ;
rem  - laisse cette fenêtre ouverte : la fermer arrête l'application.
rem  Instance unique par dossier de données : le serveur applique le verrou d'instance
rem  (code de sortie 3 = déjà lancée, 4 = une ancienne copie ne répond plus).
rem  Aucune élévation de droits, aucun accès réseau, aucun processus tué par son nom.
rem  Fichier encodé en UTF-8 (sans BOM), fins de ligne Windows.
rem ============================================================================
chcp 65001 >nul
title suivi-facturation
cd /d "%~dp0.."
if errorlevel 1 goto :dossier_introuvable

rem Le fichier .env est facultatif : on ne passe l'option que s'il existe (évite un message anglais de Node).
set "ENVOPT="
if exist ".env" set "ENVOPT=--env-file=.env"

rem --- 1. Node.js est-il installé ? ---
where node >nul 2>nul
if errorlevel 1 goto :node_absent
set "NODE_MAJEUR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "NODE_MAJEUR=%%v"
if not defined NODE_MAJEUR goto :node_absent
if %NODE_MAJEUR% LSS 24 goto :node_ancien

echo.
echo  ============================================================
echo    suivi-facturation
echo  ============================================================
echo.
if %NODE_MAJEUR% GTR 24 echo  Remarque : l'application est prévue pour Node.js 24 ; vous avez la version %NODE_MAJEUR%. Elle devrait fonctionner, mais n'a pas été testée.& echo.

rem --- 2. L'application tourne-t-elle déjà ? Le port est-il pris par autre chose ? ---
node %ENVOPT% scripts\outils-lanceur.mjs etat
set "ETAT=%errorlevel%"
if "%ETAT%"=="10" goto :deja_lance
if "%ETAT%"=="11" goto :port_occupe
if "%ETAT%"=="12" goto :port_invalide
if "%ETAT%"=="13" goto :instance_bloquee
rem 0 = port libre ; autre = on laisse le serveur juger.

rem --- 3. Démarrage : le navigateur s'ouvre dès que l'application répond ---
echo  Démarrage en cours... le navigateur va s'ouvrir tout seul.
echo.
echo  Pour ARRÊTER l'application : fermez simplement cette fenêtre.
echo  (Vos données sont enregistrées au fur et à mesure, vous ne risquez rien.)
echo  Si le navigateur ne s'ouvre pas, ouvrez-le et tapez l'adresse affichée ci-dessous.
echo.
start "" /b node %ENVOPT% scripts\outils-lanceur.mjs ouvrir
node %ENVOPT% src\server.js
set "CODE=%errorlevel%"

rem --- 4. Le serveur s'est arrêté : on explique et on reste ouvert ---
echo.
echo  ------------------------------------------------------------
if "%CODE%"=="0" goto :arret_normal
if "%CODE%"=="2" goto :erreur_config
if "%CODE%"=="3" goto :deja_lance_serveur
if "%CODE%"=="4" goto :instance_bloquee
echo  L'application s'est arrêtée de façon inattendue (code %CODE%).
echo  Lisez le message ci-dessus. Si le problème persiste, relancez ; vos données ne sont pas perdues.
goto :fin

:arret_normal
echo  L'application est arrêtée. Vous pouvez fermer cette fenêtre.
goto :fin

:erreur_config
echo  L'application n'a pas pu démarrer. Le message ci-dessus en donne la raison.
echo  Aucun fichier de données n'a été modifié.
echo  Pour changer le dossier de données : lancez "Choisir le dossier de donnees.bat".
echo  Voir aussi docs\exploitation.md, rubrique Dépannage.
goto :fin

:deja_lance_serveur
echo  L'application est déjà lancée (dans une autre fenêtre ou en arrière-plan) : rien de plus n'est démarré.
echo  Ouverture du navigateur...
node %ENVOPT% scripts\outils-lanceur.mjs ouvrir --maintenant
ping -n 4 127.0.0.1 >nul
exit /b 0

:instance_bloquee
echo.
echo  L'application ne répond plus : une ancienne copie est toujours présente mais ne réagit plus.
echo  Elle n'a pas été arrêtée et vos données n'ont pas été touchées.
echo.
echo  Que faire : double-cliquez sur "Arreter suivi-facturation.vbs" (dossier scripts) : il propose
echo  de l'arrêter. Puis relancez. Voir aussi docs\exploitation.md, rubrique Dépannage.
goto :fin

:deja_lance
echo  L'application est déjà lancée dans une autre fenêtre ou en arrière-plan.
echo  Ouverture du navigateur...
node %ENVOPT% scripts\outils-lanceur.mjs ouvrir --maintenant
rem Petite attente pour laisser lire le message, sans dépendre du clavier.
ping -n 4 127.0.0.1 >nul
exit /b 0

:port_occupe
echo  Le port réseau utilisé par l'application est déjà pris par un AUTRE logiciel.
echo  L'application n'a pas été démarrée et aucune donnée n'a été touchée.
echo.
echo  Que faire :
echo    - redémarrez l'ordinateur, puis relancez ce raccourci ; ou
echo    - utilisez le raccourci normal "Suivi Facturation" (il choisit tout seul un autre port si 4780 est pris) ; ou
echo    - demandez de l'aide : on peut fixer un port (ERGO_PORT dans le fichier .env,
echo      voir docs\exploitation.md).
goto :fin

:port_invalide
echo.
echo  Le numéro de port (ERGO_PORT) du fichier .env n'est pas valide : le message ci-dessus donne la valeur refusée.
echo  Il faut un nombre entier de 1 à 65535 (par exemple 4780).
echo  L'application n'a pas été démarrée et aucune donnée n'a été touchée.
echo.
echo  Que faire : ouvrez le fichier .env (à la racine du projet) avec le Bloc-notes, corrigez
echo  ou supprimez la ligne ERGO_PORT, enregistrez, puis relancez ce raccourci.
echo  Voir aussi docs\exploitation.md, rubrique Dépannage.
goto :fin

:node_absent
echo.
echo  Node.js n'est pas installé sur cet ordinateur (ou n'est pas trouvé).
echo.
echo  Pour l'installer, une seule fois :
echo    1. Allez sur https://nodejs.org et téléchargez Node.js version 24
echo       (installeur Windows .msi ; si la page propose une autre version, cherchez
echo       "Autres téléchargements" puis la version 24).
echo    2. Lancez l'installeur et gardez les options par défaut.
echo    3. Fermez cette fenêtre puis double-cliquez de nouveau sur "Lancer suivi-facturation".
goto :fin

:node_ancien
echo.
echo  La version de Node.js installée (%NODE_MAJEUR%) est trop ancienne : il faut la version 24.
echo  Installez Node.js 24 depuis https://nodejs.org (installeur Windows .msi, options par défaut),
echo  puis fermez cette fenêtre et double-cliquez de nouveau sur "Lancer suivi-facturation".
goto :fin

:dossier_introuvable
echo.
echo  Impossible d'accéder au dossier du projet. Le fichier "Lancer suivi-facturation.bat" doit rester
echo  dans le dossier "scripts" du projet (utilisez un raccourci pour le placer sur le Bureau).
goto :fin

:fin
echo.
pause
exit /b 1
