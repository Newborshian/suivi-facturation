#!/bin/sh
# ============================================================================
#  Arreter suivi-facturation.sh : arrêt de secours (Linux, macOS), double-cliquable ou en terminal. POSIX sh.
#  Demande l'ARRÊT PROPRE de l'application (le port réel est retrouvé dans le verrou d'instance). Jamais d'arrêt par nom.
#  Application bloquée (code 20) : question Oui/Non ; Oui = arrêt propre tenté 3 s, puis arrêt du seul PID du verrou
#  s'il s'agit bien d'un programme node.
#  Détection du système avec `uname -s` : Linux/Darwin -> node scripts/arreter.mjs ; MINGW*/MSYS*/CYGWIN* -> délègue au
#  « Arreter suivi-facturation.vbs » ; autre -> message explicite.
#  Linux et macOS : NON VÉRIFIÉ sur le système réel.
#  Si le fichier n'est pas exécutable : chmod +x scripts/*.sh
# ============================================================================

os=$(uname -s 2>/dev/null || echo inconnu)
dossier_scripts=$(
  cible="$0"
  while [ -L "$cible" ]; do
    rep=$(cd "$(dirname "$cible")" && pwd)
    lien=$(readlink "$cible")
    case "$lien" in
      /*) cible="$lien" ;;
      *) cible="$rep/$lien" ;;
    esac
  done
  cd "$(dirname "$cible")" && pwd
)
if [ -z "$dossier_scripts" ] || [ ! -f "$dossier_scripts/lib-boites.sh" ]; then
  echo "Suivi Facturation : impossible de retrouver le dossier du projet (le fichier lib-boites.sh est introuvable)." >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$dossier_scripts/lib-boites.sh"

resultat() {
  case "$1" in
    0) boite "L'application est arrêtée." info ;;
    10) boite "L'application n'était pas lancée." info ;;
    11) boite "Le port de l'application est pris par un autre logiciel : suivi-facturation n'est pas lancé. Rien n'a été arrêté." erreur ;;
    12) boite "Le numéro de port (ERGO_PORT) du fichier .env n'est pas valide. Corrigez-le (voir le guide), puis réessayez." erreur ;;
    20) boite "L'application ne répond plus et n'a pas été arrêtée (rien n'a été touché)." erreur ;;
    21) boite "L'ancienne copie n'a pas été arrêtée : le processus concerné ne ressemble pas à l'application (rien n'a été touché).
Redémarrez l'ordinateur si l'application ne se relance pas. Vos données ne sont pas touchées." erreur ;;
    *) boite "L'arrêt n'a pas abouti (code $1). Essayez le bouton « Quitter l'application » de l'onglet Paramètres. Vos données sont enregistrées au fur et à mesure : vous ne risquez rien." erreur ;;
  esac
}

case "$os" in
  Linux|Darwin)
    verifier_node || exit 3
    node "$dossier_scripts/arreter.mjs"
    code=$?
    if [ "$code" -eq 20 ]; then
      if question_oui_non "L'application ne répond plus.
Une ancienne copie est toujours présente mais ne réagit plus. Vos données ne sont pas touchées.

L'arrêter ?"; then
        node "$dossier_scripts/arreter.mjs" --forcer
        code=$?
        if [ "$code" -eq 0 ]; then
          boite "L'application qui ne répondait plus a été arrêtée." info
          exit 0
        fi
      else
        exit 20
      fi
    fi
    resultat "$code"
    exit "$code"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    vbs="$dossier_scripts/Arreter suivi-facturation.vbs"
    if [ ! -f "$vbs" ]; then
      boite "L'arrêt Windows est introuvable : $vbs" erreur
      exit 1
    fi
    if command -v cygpath >/dev/null 2>&1; then vbs=$(cygpath -w "$vbs"); fi
    MSYS2_ARG_CONV_EXCL='*' cmd.exe /c start "" wscript.exe //nologo "$vbs"
    exit $?
    ;;
  *)
    boite "Système non pris en charge : $os. Les systèmes pris en charge sont Windows, Linux et macOS." erreur
    exit 1
    ;;
esac
