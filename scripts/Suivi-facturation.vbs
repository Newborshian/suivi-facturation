' ============================================================================
'  Suivi-facturation  (double-clic ou raccourci du Bureau "Suivi Facturation") - AUCUNE fenetre.
'  - determine le dossier du projet a partir de son propre emplacement ;
'  - lance scripts\lancer-silencieux.mjs avec Node.js, fenetre masquee : ce script demarre le
'    serveur en arriere-plan (detache), attend qu'il reponde puis ouvre le navigateur ;
'  - deux lancements simultanes ne produisent aucune erreur (le lanceur Node a un verrou de lancement) ;
'  - application deja lancee : la page s'ouvre simplement ;
'  - si ca ne demarre pas : UNE boite de message explique le probleme (seul cas ou une fenetre apparait) ;
'  - application bloquee (code 20) : boite Oui/Non "L'arreter et la relancer ?". Oui = arret propre tente 3 s, puis arret
'    du seul PID du verrou s'il s'agit bien d'un programme node (jamais d'arret par nom), puis nouveau lancement.
'  Aucune elevation de droits, aucun acces reseau. Fichier encode en ASCII, fins de ligne Windows.
'  Variables d'essai : ERGO_LANCEUR_SANS_BOITE=1 (aucune boite de message), ERGO_LANCEUR_MESSAGE=<fichier>,
'                      SUIVI_FORCER_OUI=1 (repond Oui a la question de l'application bloquee, sans boite).
' ============================================================================
Option Explicit

Dim sh, fso, projet, script, scriptArret, env, sansBoite, fichierMessage, code, titre, contenu, journalChemin, message, forcerOui
titre = "Suivi Facturation"
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = sh.Environment("PROCESS")
projet = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
script = projet & "\scripts\lancer-silencieux.mjs"
scriptArret = projet & "\scripts\arreter.mjs"
sansBoite = (env("ERGO_LANCEUR_SANS_BOITE") = "1")
forcerOui = (env("SUIVI_FORCER_OUI") = "1")
fichierMessage = env("ERGO_LANCEUR_MESSAGE")
If fichierMessage = "" Then fichierMessage = projet & "\logs\message-lanceur.txt"

Sub Boite(texte, style)
  If Not sansBoite Then MsgBox texte, style, titre
End Sub

' Lit un fichier texte UTF-8 (renvoie "" s'il est absent ou illisible).
Function LireUtf8(chemin)
  Dim flux
  LireUtf8 = ""
  If Not fso.FileExists(chemin) Then Exit Function
  On Error Resume Next
  Set flux = CreateObject("ADODB.Stream")
  flux.Type = 2
  flux.Charset = "utf-8"
  flux.Open
  flux.LoadFromFile chemin
  LireUtf8 = flux.ReadText
  flux.Close
  If Err.Number <> 0 Then LireUtf8 = ""
  On Error GoTo 0
End Function

' Execute un script Node masque et attend sa fin. Renvoie son code de sortie, ou -1 si node.exe est introuvable.
Function LancerNode(fichier, arguments)
  On Error Resume Next
  LancerNode = sh.Run("node.exe """ & fichier & """" & arguments, 0, True)
  If Err.Number <> 0 Then LancerNode = -1
  Err.Clear
  On Error GoTo 0
End Function

' Lit le message d'echec ecrit par le lanceur : renseigne "message" et "journalChemin".
Sub LireMessageLanceur(codeSortie)
  Dim p
  contenu = LireUtf8(fichierMessage)
  journalChemin = ""
  message = ""
  If contenu <> "" Then
    contenu = Replace(contenu, vbCrLf, vbLf)
    p = InStr(contenu, vbLf)
    If Left(contenu, 8) = "journal=" And p > 0 Then
      journalChemin = Mid(contenu, 9, p - 9)
      message = Mid(contenu, p + 1)
    Else
      message = contenu
    End If
    message = Replace(Trim(message), vbLf, vbCrLf)
  End If
  If message = "" Then
    message = "L'application n'a pas pu d" & ChrW(233) & "marrer (code " & codeSortie & ")." & vbCrLf & "Vos donn" & ChrW(233) & "es ne sont pas touch" & ChrW(233) & "es. Relancez ; si le probl" & ChrW(232) & "me persiste, demandez de l'aide."
  End If
  If Len(message) > 800 Then message = Left(message, 800) & "..."
  If journalChemin = "" Then journalChemin = projet & "\logs\suivi-facturation.log"
End Sub

Sub NodeAbsent()
  Boite "Node.js 24 n'est pas install" & ChrW(233) & " sur cet ordinateur (ou n'est pas trouv" & ChrW(233) & ")." & vbCrLf & vbCrLf & _
        "Pour l'installer, une seule fois : allez sur https://nodejs.org, t" & ChrW(233) & "l" & ChrW(233) & "chargez la version 24 (installeur Windows), gardez les options par d" & ChrW(233) & "faut, puis relancez l'application." & vbCrLf & vbCrLf & _
        "Plus de d" & ChrW(233) & "tails : guide d'utilisation (docs\guide-utilisateur.md).", 16
  WScript.Quit 3
End Sub

If Not fso.FileExists(script) Then
  Boite "Le fichier du lanceur est introuvable :" & vbCrLf & script & vbCrLf & vbCrLf & "Le dossier du projet a peut-" & ChrW(234) & "tre " & ChrW(233) & "t" & ChrW(233) & " d" & ChrW(233) & "plac" & ChrW(233) & " ou incomplet. Recr" & ChrW(233) & "ez le raccourci du Bureau depuis le dossier actuel (voir le guide).", 16
  WScript.Quit 1
End If

' Un ancien message ne doit pas etre affiche par erreur.
On Error Resume Next
If fso.FileExists(fichierMessage) Then fso.DeleteFile fichierMessage, True
On Error GoTo 0

sh.CurrentDirectory = projet
code = LancerNode(script, "")
If code = -1 Then NodeAbsent

' --- Application bloquee (code 20) : proposer de l'arreter puis de la relancer ---
If code = 20 Then
  Dim reponseBloquee, codeArret
  LireMessageLanceur code
  reponseBloquee = 7
  If forcerOui Then
    reponseBloquee = 6
  ElseIf Not sansBoite Then
    reponseBloquee = MsgBox(message & vbCrLf & vbCrLf & "L'arr" & ChrW(234) & "ter et la relancer ?", 4 + 32, titre)
  End If
  If reponseBloquee <> 6 Then WScript.Quit 20
  codeArret = LancerNode(scriptArret, " --forcer")
  If codeArret = -1 Then NodeAbsent
  If codeArret <> 0 Then
    If codeArret = 21 Then
      Boite "L'ancienne copie n'a pas " & ChrW(233) & "t" & ChrW(233) & " arr" & ChrW(234) & "t" & ChrW(233) & "e : le processus concern" & ChrW(233) & " ne ressemble pas " & ChrW(224) & " l'application (rien n'a " & ChrW(233) & "t" & ChrW(233) & " touch" & ChrW(233) & ")." & vbCrLf & "Red" & ChrW(233) & "marrez l'ordinateur, puis relancez. Vos donn" & ChrW(233) & "es ne sont pas touch" & ChrW(233) & "es.", 48
    Else
      Boite "L'ancienne copie n'a pas pu " & ChrW(234) & "tre arr" & ChrW(234) & "t" & ChrW(233) & "e (code " & codeArret & ")." & vbCrLf & "Red" & ChrW(233) & "marrez l'ordinateur, puis relancez. Vos donn" & ChrW(233) & "es ne sont pas touch" & ChrW(233) & "es.", 48
    End If
    WScript.Quit codeArret
  End If
  On Error Resume Next
  If fso.FileExists(fichierMessage) Then fso.DeleteFile fichierMessage, True
  On Error GoTo 0
  code = LancerNode(script, "")
  If code = -1 Then NodeAbsent
End If

If code = 0 Then WScript.Quit 0

Dim reponse
LireMessageLanceur code

If sansBoite Then WScript.Quit code

If fso.FileExists(journalChemin) Then
  reponse = MsgBox(message & vbCrLf & vbCrLf & "Le journal se trouve ici :" & vbCrLf & journalChemin & vbCrLf & vbCrLf & "Ouvrir le journal ?", 4 + 48, titre)
  If reponse = 6 Then sh.Run "notepad.exe """ & journalChemin & """", 1, False
Else
  MsgBox message, 48, titre
End If
WScript.Quit code
