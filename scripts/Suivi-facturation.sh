#!/bin/sh
# ============================================================================
#  Suivi-facturation.sh : lanceur double-cliquable (Linux, macOS) ou lançable en terminal. POSIX sh.
#  - trouve son dossier même via un lien symbolique ;
#  - détecte le système avec `uname -s` :
#      Linux, Darwin             -> vérifie Node.js >= 24, puis `node scripts/lancer-silencieux.mjs` (aucune fenêtre ;
#                                   en cas d'échec : le message du lanceur dans une boîte graphique si possible, sinon sur la sortie d'erreur) ;
#      MINGW*, MSYS*, CYGWIN*    -> (Git Bash sous Windows) délègue au lanceur Windows « Suivi-facturation.vbs » ;
#      autre système             -> message explicite.
#  Aucun accès réseau, aucune élévation de droits. Linux et macOS : NON VÉRIFIÉ sur le système réel.
#  Si le fichier n'est pas exécutable : chmod +x scripts/*.sh   (ou `sh scripts/Suivi-facturation.sh`).
#  Variables d'essai : ERGO_LANCEUR_SANS_BOITE=1 (aucune boîte graphique), ERGO_LANCEUR_MESSAGE=<fichier>, SUIVI_FORCER_OUI=1.
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
racine=$(dirname "$dossier_scripts")
# shellcheck disable=SC1091
. "$dossier_scripts/lib-boites.sh"
fichier_message=${ERGO_LANCEUR_MESSAGE:-$racine/logs/message-lanceur.txt}

lancer_ici() {
  verifier_node || return 1
  node "$dossier_scripts/lancer-silencieux.mjs"
  return $?
}

case "$os" in
  Linux|Darwin)
    lancer_ici
    code=$?
    if [ "$code" -eq 20 ]; then
      # Application bloquée : proposer de l'arrêter puis de la relancer (arrêt propre, puis seulement le PID du verrou s'il est de type node).
      msg=$(message_lanceur "$fichier_message")
      [ -n "$msg" ] || msg="L'application ne répond plus."
      if question_oui_non "$msg

L'arrêter et la relancer ?"; then
        node "$dossier_scripts/arreter.mjs" --forcer
        arret=$?
        if [ "$arret" -eq 0 ]; then
          lancer_ici
          code=$?
        elif [ "$arret" -eq 21 ]; then
          boite "L'ancienne copie n'a pas été arrêtée : le processus concerné ne ressemble pas à l'application (rien n'a été touché).
Redémarrez l'ordinateur, puis relancez. Vos données ne sont pas touchées." erreur
          exit 21
        else
          boite "L'ancienne copie n'a pas pu être arrêtée (code $arret).
Redémarrez l'ordinateur, puis relancez. Vos données ne sont pas touchées." erreur
          exit "$arret"
        fi
      else
        exit 20
      fi
    fi
    if [ "$code" -ne 0 ]; then
      if [ -f "$fichier_message" ]; then
        msg=$(message_lanceur "$fichier_message")
        journal=$(head -n 1 "$fichier_message")
        case "$journal" in
          journal=*) msg="$msg

Journal : ${journal#journal=}" ;;
        esac
        boite "$msg" erreur
      elif [ "$code" -ne 1 ]; then
        boite "L'application n'a pas pu démarrer (code $code). Vos données ne sont pas touchées." erreur
      fi
      exit "$code"
    fi
    exit 0
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Git Bash / MSYS / Cygwin sous Windows : le lanceur Windows (sans fenêtre) fait le travail. `start` n'attend pas la fin.
    vbs="$dossier_scripts/Suivi-facturation.vbs"
    if [ ! -f "$vbs" ]; then
      boite "Le lanceur Windows est introuvable : $vbs" erreur
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
