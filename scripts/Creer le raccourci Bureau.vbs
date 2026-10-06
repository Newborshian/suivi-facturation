' ============================================================================
'  Creer le raccourci Bureau
'  Cree sur le Bureau le raccourci "Suivi Facturation" (icone du projet) qui lance l'application
'  sans fenetre. Le raccourci contient le chemin ABSOLU du projet : si le dossier est deplace,
'  relancez ce script.
'  Ancien raccourci "Suivi-facturation.lnk" (cible wscript.exe + argument vers Suivi-facturation.vbs) :
'  detecte, puis remplace apres confirmation Oui/Non (ce seul fichier est supprime). Jamais deux raccourcis.
'  Un fichier qui n'est pas le notre n'est jamais supprime ni ecrase.
'  Fichier encode en ASCII, fins de ligne Windows.
'  Variables d'essai : SUIVI_RACCOURCI_DOSSIER=<dossier> (ecrit le .lnk dans ce dossier au lieu du Bureau),
'                      SUIVI_CONFIRMER_OUI=1 (repond Oui a toute question de remplacement, sans boite),
'                      ERGO_LANCEUR_SANS_BOITE=1 (aucune boite de message ; un raccourci "Suivi Facturation" existant est
'                      remplace ; un ancien raccourci n'est PAS retire : reponse Non).
' ============================================================================
Option Explicit

Dim sh, fso, env, projet, dossierScripts, lanceur, icone, dossierBureau, chemin, ancien, sansBoite, confirmerOui, titre, lien, reponse
Dim ancienEstNotre, ancienExiste
titre = "Suivi Facturation"
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = sh.Environment("PROCESS")
sansBoite = (env("ERGO_LANCEUR_SANS_BOITE") = "1")
confirmerOui = (env("SUIVI_CONFIRMER_OUI") = "1")
dossierScripts = fso.GetParentFolderName(WScript.ScriptFullName)
projet = fso.GetParentFolderName(dossierScripts)
lanceur = dossierScripts & "\Suivi-facturation.vbs"
icone = dossierScripts & "\icone\suivi-facturation.ico"

Sub Boite(texte, style)
  If Not sansBoite Then MsgBox texte, style, titre
End Sub

' Vrai si le .lnk est NOTRE raccourci : cible wscript.exe ET argument qui designe un fichier Suivi-facturation.vbs.
Function EstNotreRaccourci(fichier)
  Dim l, cible, argument
  EstNotreRaccourci = False
  On Error Resume Next
  Set l = sh.CreateShortcut(fichier)
  cible = LCase(l.TargetPath)
  argument = LCase(Replace(l.Arguments, """", ""))
  If Err.Number = 0 Then
    If Right(cible, 11) = "wscript.exe" And Right(argument, 21) = "suivi-facturation.vbs" Then EstNotreRaccourci = True
  End If
  On Error GoTo 0
End Function

If Not fso.FileExists(lanceur) Then
  Boite "Le lanceur est introuvable :" & vbCrLf & lanceur, 16
  WScript.Quit 1
End If

dossierBureau = env("SUIVI_RACCOURCI_DOSSIER")
If dossierBureau = "" Then dossierBureau = sh.SpecialFolders("Desktop")
If dossierBureau = "" Or Not fso.FolderExists(dossierBureau) Then
  Boite "Le Bureau est introuvable : le raccourci n'a pas " & ChrW(233) & "t" & ChrW(233) & " cr" & ChrW(233) & ChrW(233) & ".", 16
  WScript.Quit 1
End If
chemin = dossierBureau & "\Suivi Facturation.lnk"
ancien = dossierBureau & "\Suivi-facturation.lnk"

' --- Ancien raccourci "Suivi-facturation" ---
ancienExiste = False
ancienEstNotre = False
If fso.FileExists(ancien) Then
  ancienExiste = True
  ancienEstNotre = EstNotreRaccourci(ancien)
  ' Un fichier du meme nom qui n'est pas le notre est laisse tel quel : il ne gene pas (nom different du nouveau raccourci).
End If

If ancienEstNotre Then
  If Not confirmerOui Then
    If sansBoite Then
      WScript.Quit 2
    End If
    reponse = MsgBox("Un ancien raccourci " & ChrW(171) & " Suivi-facturation " & ChrW(187) & " existe sur le Bureau." & vbCrLf & _
                     "Le remplacer par " & ChrW(171) & " Suivi Facturation " & ChrW(187) & " ?" & vbCrLf & vbCrLf & _
                     "Oui : le nouveau raccourci est cr" & ChrW(233) & ChrW(233) & " et l'ancien est supprim" & ChrW(233) & "." & vbCrLf & _
                     "Non : rien n'est cr" & ChrW(233) & ChrW(233) & " ni supprim" & ChrW(233) & ".", 4 + 32, titre)
    If reponse <> 6 Then
      MsgBox "Rien n'a " & ChrW(233) & "t" & ChrW(233) & " cr" & ChrW(233) & ChrW(233) & " ni supprim" & ChrW(233) & ". L'ancien raccourci " & ChrW(171) & " Suivi-facturation " & ChrW(187) & " reste en place (il ne doit pas y avoir deux raccourcis).", 64, titre
      WScript.Quit 2
    End If
  End If
End If

' --- Raccourci "Suivi Facturation" deja present ---
If fso.FileExists(chemin) And Not sansBoite And Not confirmerOui Then
  reponse = MsgBox("Un raccourci " & ChrW(171) & " Suivi Facturation " & ChrW(187) & " existe d" & ChrW(233) & "j" & ChrW(224) & " sur le Bureau." & vbCrLf & "Le remplacer ?", 4 + 32, titre)
  If reponse <> 6 Then
    MsgBox "Rien n'a " & ChrW(233) & "t" & ChrW(233) & " modifi" & ChrW(233) & ".", 64, titre
    WScript.Quit 2
  End If
End If

On Error Resume Next
Set lien = sh.CreateShortcut(chemin)
lien.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
lien.Arguments = """" & lanceur & """"
lien.WorkingDirectory = dossierScripts
If fso.FileExists(icone) Then lien.IconLocation = icone & ",0"
lien.Description = "Suivi Facturation"
lien.WindowStyle = 1
lien.Save
If Err.Number <> 0 Then
  On Error GoTo 0
  Boite "Le raccourci n'a pas pu " & ChrW(234) & "tre cr" & ChrW(233) & ChrW(233) & " (" & chemin & ").", 16
  WScript.Quit 1
End If
On Error GoTo 0

' Le nouveau existe : on retire l'ancien (ce seul fichier, apres l'avoir verifie), jamais l'inverse.
If ancienEstNotre Then
  On Error Resume Next
  fso.DeleteFile ancien, False
  If Err.Number <> 0 Then
    On Error GoTo 0
    Boite "Le raccourci " & ChrW(171) & " Suivi Facturation " & ChrW(187) & " a " & ChrW(233) & "t" & ChrW(233) & " cr" & ChrW(233) & ChrW(233) & ", mais l'ancien raccourci " & ChrW(171) & " Suivi-facturation " & ChrW(187) & " n'a pas pu " & ChrW(234) & "tre supprim" & ChrW(233) & ". Supprimez-le vous-m" & ChrW(234) & "me pour n'en garder qu'un seul.", 48
    WScript.Quit 1
  End If
  On Error GoTo 0
End If

Boite "Le raccourci " & ChrW(171) & " Suivi Facturation " & ChrW(187) & " a " & ChrW(233) & "t" & ChrW(233) & " cr" & ChrW(233) & ChrW(233) & " sur le Bureau." & vbCrLf & vbCrLf & _
      "Double-cliquez dessus pour d" & ChrW(233) & "marrer l'application (aucune fen" & ChrW(234) & "tre ne s'ouvre)." & vbCrLf & _
      "Si vous d" & ChrW(233) & "placez le dossier du projet, relancez ce script pour recr" & ChrW(233) & "er le raccourci.", 64
WScript.Quit 0
