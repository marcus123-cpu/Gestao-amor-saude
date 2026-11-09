#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{F146A0DB-663A-4942-B73F-22B77CE80637}
AppName=Agenda Clara
AppVersion={#AppVersion}
AppPublisher=AmorSaúde Fernandópolis
DefaultDirName={localappdata}\Programs\AgendaClara
DefaultGroupName=Agenda Clara
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=AgendaClara-Setup-{#AppVersion}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Agenda Clara
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\build\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Agenda Clara"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Abrir Agenda Clara.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\Agenda Clara"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Abrir Agenda Clara.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Abrir Agenda Clara.ps1"""; WorkingDir: "{app}"; Description: "Abrir Agenda Clara"; Flags: nowait postinstall skipifsilent
