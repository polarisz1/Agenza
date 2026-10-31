; AgentFlow 安装包的自定义 NSIS 片段（electron-builder 的 nsis.include 加载）
;
; 背景：默认模板卸载后会留下一个**空**的安装目录。
; 原因是卸载器进程的工作目录可能正好在 $INSTDIR 里，Windows 因此拒绝删除该目录。
; 这里在卸载阶段把工作目录切走，让它能删干净。

!macro customUnInstall
  ; 卸载器的工作目录可能就在 $INSTDIR 里，先切走再尝试删目录
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
!macroend
