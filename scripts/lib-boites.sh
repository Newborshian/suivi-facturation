#!/bin/sh
# Fonctions communes à « Suivi-facturation.sh » et « Arreter suivi-facturation.sh » (à inclure avec « . », ne se lance pas seul).
# POSIX sh, aucun accès réseau. Attend que la variable $os (résultat de `uname -s`) soit définie par le script appelant.
# Linux et macOS : non vérifié sur le système réel.

TITRE="Suivi Facturation"

# Lancé depuis le Finder ou un menu, le PATH est réduit : on ajoute les emplacements habituels de Node.js (Homebrew, installeur officiel).
PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin"
# Gestionnaires de versions : Volta (~/.volta/bin) et nvm (bin de la version la plus récente de ~/.nvm/versions/node/). Sans eval.
if [ -n "${HOME:-}" ]; then
  [ -d "$HOME/.volta/bin" ] && PATH="$PATH:$HOME/.volta/bin"
  nvm_recent=""
  for nvm_dossier in "$HOME"/.nvm/versions/node/*/; do
    [ -d "${nvm_dossier}bin" ] || continue
    if [ -z "$nvm_recent" ]; then
      nvm_recent="$nvm_dossier"
    else
      # le plus récent selon `sort -V` (ordre de version) ; repli : ordre alphabétique si -V n'existe pas
      plus_grand=$(printf '%s\n%s\n' "$nvm_recent" "$nvm_dossier" | sort -V 2>/dev/null | tail -n 1)
      [ -n "$plus_grand" ] && nvm_recent="$plus_grand"
    fi
  done
  [ -n "$nvm_recent" ] && PATH="$PATH:${nvm_recent}bin"
  unset nvm_dossier nvm_recent plus_grand
fi
export PATH

# Interface graphique disponible ? (macOS : toujours essayée ; Linux : seulement si un affichage existe)
a_ecran() {
  case "$os" in
    Darwin) return 0 ;;
    *) [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] ;;
  esac
}

# boite <message> [erreur|info] : écrit toujours le message sur la sortie d'erreur, puis l'affiche dans une boîte si possible.
boite() {
  printf '%s\n' "$1" >&2
  [ "${ERGO_LANCEUR_SANS_BOITE:-}" = "1" ] && return 0
  a_ecran || return 0
  case "$os" in
    Darwin)
      osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "Suivi Facturation" buttons {"OK"} default button 1' -e 'end run' "$1" >/dev/null 2>&1
      ;;
    *)
      if command -v zenity >/dev/null 2>&1; then
        if [ "${2:-info}" = "erreur" ]; then zenity --error --no-markup --title="$TITRE" --text="$1" >/dev/null 2>&1
        else zenity --info --no-markup --title="$TITRE" --text="$1" >/dev/null 2>&1; fi
      elif command -v kdialog >/dev/null 2>&1; then
        if [ "${2:-info}" = "erreur" ]; then kdialog --title "$TITRE" --error "$1" >/dev/null 2>&1
        else kdialog --title "$TITRE" --msgbox "$1" >/dev/null 2>&1; fi
      elif command -v notify-send >/dev/null 2>&1; then
        notify-send "$TITRE" "$1" >/dev/null 2>&1
      fi
      ;;
  esac
  return 0
}

# question_oui_non <message> : code 0 si l'utilisatrice répond Oui. Jamais de réponse par défaut « Oui ».
# SUIVI_FORCER_OUI=1 (essais) répond Oui ; ERGO_LANCEUR_SANS_BOITE=1 répond Non.
question_oui_non() {
  [ "${SUIVI_FORCER_OUI:-}" = "1" ] && return 0
  [ "${ERGO_LANCEUR_SANS_BOITE:-}" = "1" ] && return 1
  if a_ecran; then
    case "$os" in
      Darwin)
        reponse=$(osascript -e 'on run argv' -e 'button returned of (display dialog (item 1 of argv) with title "Suivi Facturation" buttons {"Non", "Oui"} default button "Non")' -e 'end run' "$1" 2>/dev/null)
        [ "$reponse" = "Oui" ]
        return $?
        ;;
      *)
        if command -v zenity >/dev/null 2>&1; then
          zenity --question --no-markup --title="$TITRE" --text="$1" --ok-label="Oui" --cancel-label="Non" >/dev/null 2>&1
          return $?
        elif command -v kdialog >/dev/null 2>&1; then
          kdialog --title "$TITRE" --yesno "$1" >/dev/null 2>&1
          return $?
        fi
        ;;
    esac
  fi
  if [ -t 0 ]; then
    printf '%s (o = oui, n = non) : ' "$1" >&2
    read -r reponse
    case "$reponse" in o|O|oui|Oui|OUI) return 0 ;; esac
  fi
  return 1
}

# message_lanceur : affiche le message d'échec écrit par le lanceur Node (sans la ligne « journal=... »), ou rien.
message_lanceur() {
  [ -f "$1" ] || return 0
  premiere=$(head -n 1 "$1")
  case "$premiere" in
    journal=*) sed '1d' "$1" ;;
    *) cat "$1" ;;
  esac
}

# dossier_du_script : dossier réel du script appelant ($1 = $0), même via un ou plusieurs liens symboliques.
dossier_du_script() {
  cible="$1"
  while [ -L "$cible" ]; do
    rep=$(cd "$(dirname "$cible")" && pwd)
    lien=$(readlink "$cible")
    case "$lien" in
      /*) cible="$lien" ;;
      *) cible="$rep/$lien" ;;
    esac
  done
  (cd "$(dirname "$cible")" && pwd)
}

# verifier_node : code 0 si Node.js >= 24 est disponible ; sinon affiche une boîte d'erreur et renvoie 1.
verifier_node() {
  if ! command -v node >/dev/null 2>&1; then
    boite "Node.js 24 n'est pas installé sur cet ordinateur (ou n'est pas trouvé).
Pour l'installer, une seule fois : allez sur https://nodejs.org, choisissez la version 24, puis relancez l'application." erreur
    return 1
  fi
  majeur=$(node -p 'parseInt(process.versions.node)' 2>/dev/null)
  case "$majeur" in
    ''|*[!0-9]*) majeur=0 ;;
  esac
  if [ "$majeur" -lt 24 ]; then
    boite "La version de Node.js installée ($majeur) est trop ancienne : il faut la version 24.
Installez Node.js 24 depuis https://nodejs.org, puis relancez l'application." erreur
    return 1
  fi
  return 0
}
