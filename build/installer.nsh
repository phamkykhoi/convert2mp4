; Thêm mục "Chuyển sang MP4" vào menu chuột phải của file .webm (chỉ cho người dùng hiện tại).
!macro customInstall
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webm\shell\WebmToMp4" "" "Chuyển sang MP4"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webm\shell\WebmToMp4" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webm\shell\WebmToMp4" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webm\shell\WebmToMp4\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webm\shell\WebmToMp4"
!macroend
