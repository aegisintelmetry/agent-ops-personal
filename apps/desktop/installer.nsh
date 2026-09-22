!macro customUnInstall
  nsExec::ExecToStack '"$INSTDIR\resources\core\btk-desktop-core.exe" --remove-startup'
  Pop $0
  Pop $1
!macroend
