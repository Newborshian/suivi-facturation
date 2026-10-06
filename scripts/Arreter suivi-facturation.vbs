' ============================================================================
' Arreter suivi-facturation  (arret de secours, sans fenetre)
'  Demande a l'application de s'arreter proprement (comme le bouton "Quitter l'application"
'  de Parametres), attend que le port soit libre, puis affiche le resultat.
'  Le port reel est retrouve dans le verrou d'instance (par scripts\arreter.mjs).
'  Ne termine jamais un processus par son nom. Application bloquee (code 20) : boite Oui/Non ; Oui = arret propre
'  tente 3 s, puis arret du seul PID du verrou s'il s'agit bien d'un programme node.
'  Fichier encode en ASCII, fins de ligne Windows.
'  Variables d'essai : ERGO_LANCEUR_SANS_BOITE=1 (aucune boite de message), SUIVI_FORCER_OUI=1 (repond Oui sans boite).
' ============================================================================
Option Explicit

Dim sh, fso, projet, script, sansBoite, forcerOui, code, titre, reponse
titre = "Suivi Facturation"
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projet = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
script = projet & "\scripts\arreter.mjs"
sansBoite = (sh.Environment("PROCESS")("ERGO_LANCEUR_SANS_BOITE") = "1")
forcerOui = (sh.Environment("PROCESS")("SUIVI_FORCER_OUI") = "1")

Sub Boite(texte, style)
  If Not sansBoite Then MsgBox texte, style, titre
End Sub

' Execute arreter.mjs masque et attend sa fin. Renvoie son code de sortie, ou -1 si node.exe est introuvable.
Function LancerArret(arguments)
  On Error Resume Next
  LancerArret = sh.Run("node.exe """ & script & """" & arguments, 0, True)
  If Err.Number <> 0 Then LancerArret = -1
  Err.Clear
  On Error GoTo 0
End Function

If Not fso.FileExists(script) Then
  Boite "Le fichier d'arr" & ChrW(234) & "t est introuvable :" & vbCrLf & script, 16
  WScript.Quit 1
End If

sh.CurrentDirectory = projet
code = LancerArret("")
If code = -1 Then
  Boite "Node.js 24 n'est pas install" & ChrW(233) & " (ou n'est pas trouv" & ChrW(233) & ") : impossible de demander l'arr" & ChrW(234) & "t." & vbCrLf & "Utilisez le bouton " & ChrW(171) & " Quitter l'application " & ChrW(187) & " de l'onglet Param" & ChrW(232) & "tres.", 16
  WScript.Quit 3
End If

' --- Application bloquee : proposer de l'arreter (arret propre, puis seulement le PID du verrou s'il est de type node) ---
If code = 20 Then
  reponse = 7
  If forcerOui Then
    reponse = 6
  ElseIf Not sansBoite Then
    reponse = MsgBox("L'application ne r" & ChrW(233) & "pond plus." & vbCrLf & "Une ancienne copie est toujours pr" & ChrW(233) & "sente mais ne r" & ChrW(233) & "agit plus. Vos donn" & ChrW(233) & "es ne sont pas touch" & ChrW(233) & "es." & vbCrLf & vbCrLf & "L'arr" & ChrW(234) & "ter ?", 4 + 32, titre)
  End If
  If reponse <> 6 Then WScript.Quit 20
  code = LancerArret(" --forcer")
  If code = 0 Then
    Boite "L'application qui ne r" & ChrW(233) & "pondait plus a " & ChrW(233) & "t" & ChrW(233) & " arr" & ChrW(234) & "t" & ChrW(233) & "e.", 64
    WScript.Quit 0
  End If
End If

Select Case code
  Case 0
    Boite "L'application est arr" & ChrW(234) & "t" & ChrW(233) & "e.", 64
  Case 10
    Boite "L'application n'" & ChrW(233) & "tait pas lanc" & ChrW(233) & "e.", 64
  Case 11
    Boite "Le port de l'application est pris par un autre logiciel : suivi-facturation n'est pas lanc" & ChrW(233) & ". Rien n'a " & ChrW(233) & "t" & ChrW(233) & " arr" & ChrW(234) & "t" & ChrW(233) & ".", 48
  Case 12
    Boite "Le num" & ChrW(233) & "ro de port (ERGO_PORT) du fichier .env n'est pas valide. Corrigez-le (voir le guide), puis r" & ChrW(233) & "essayez.", 48
  Case 20
    Boite "L'application ne r" & ChrW(233) & "pond plus et n'a pas " & ChrW(233) & "t" & ChrW(233) & " arr" & ChrW(234) & "t" & ChrW(233) & "e (rien n'a " & ChrW(233) & "t" & ChrW(233) & " touch" & ChrW(233) & ").", 48
  Case 21
    Boite "L'ancienne copie n'a pas " & ChrW(233) & "t" & ChrW(233) & " arr" & ChrW(234) & "t" & ChrW(233) & "e : le processus concern" & ChrW(233) & " ne ressemble pas " & ChrW(224) & " l'application (rien n'a " & ChrW(233) & "t" & ChrW(233) & " touch" & ChrW(233) & ")." & vbCrLf & "Red" & ChrW(233) & "marrez l'ordinateur si l'application ne se relance pas. Vos donn" & ChrW(233) & "es ne sont pas touch" & ChrW(233) & "es.", 48
  Case Else
    Boite "L'arr" & ChrW(234) & "t n'a pas abouti. Essayez le bouton " & ChrW(171) & " Quitter l'application " & ChrW(187) & " de l'onglet Param" & ChrW(232) & "tres. Vos donn" & ChrW(233) & "es sont enregistr" & ChrW(233) & "es au fur et " & ChrW(224) & " mesure : vous ne risquez rien.", 48
End Select
WScript.Quit code
