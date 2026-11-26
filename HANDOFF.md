# HANDOFF — TOKI desktop (retomar em outro computador)

Repo: https://github.com/tkmzj1bw/toki-desktop — clone com `git clone https://github.com/tkmzj1bw/toki-desktop.git`.

Ao abrir o OpenCode na pasta clonada, envie esta mensagem:
> "Leia `HANDOFF.md` e `DESKTOP.md` e continue de onde parou."

## Objetivo
Versão desktop do Toki: **Tauri 2 + React/Vite** (reaproveita o front atual), 100% local/offline.
`rust-anything` usado para portar lógica pura, não UI. Se algum ponto ficar lento/limitado, troca-se
só aquele pedaço por Rust puro (GPUI/Slint) — não reescrever o app inteiro.

## Estado
### Feito
- Repo clonado de `https://github.com/tkmzj1bw/Toki.git`.
- `src-tauri/`: Cargo.toml, build.rs, main.rs, lib.rs, tauri.conf.json, ícones gerados.
- Comando Tauri `to_gcode` em `src-tauri/src/lib.rs`, usando `toki-core`.
- `rust/toki-core/`: port puro de `shapeToPoints`, `buildSegments`, `clampToBed`, `toGcode`, `round`
  (cuidados: `Math.round` via `js::math_round`, `Number.toString` via `js::number_to_string`, NaN,
  rótulos `PEN PLOTTER` / `IMPRESSORA 3D` / `CNC / FUSO`, `Option<RigState>`).
- `rust/toki-gcode/`: bridge napi gerado por `rust-anything` (só para validar o port).
- `scripts/`: fixtures (32 casos), gerador e entry de recording; npm scripts `record:rust`,
  `build:rust`, `diff:rust`, `gate:rust`.
- `rust-anything diff`: **32/32 casos iguais ao TS original**.
- `src/lib/gcode.ts`: `invoke('to_gcode')` no desktop, fallback TS no browser.
- `PlotStudio.tsx`: export G-code usa o wrapper; corrigidos `'/n'` e `/[^/w-]/g`.
- Fontes locais em `src/assets/fonts` (sem Google Fonts); CSP restritivo no `tauri.conf.json`.
- `DESKTOP.md` com comandos de build.

### Pendente / não validado
- `npm run gate:rust` foi iniciado mas **interrompido** a pedido do usuário; rodar de novo.
- `npm run tauri build -- --debug` também foi **interrompido** no meio da compilação (não é erro de código).
  Rodar de novo e depois fazer build release/NSIS.
- CSP ainda não testado em runtime (abrir a janela e conferir fontes/estilos/IPC).
- Serial ainda é `navigator.serial` no browser (`WebSerialTransport.ts`); trocar por comando Rust
  quando fizer sentido. Não foi portado agora (roda por frame / depende de hardware).

## Pré-requisitos no PC novo
- Node 20+, Rust via rustup (MSVC target), Visual Studio Build Tools com `VCTools` + Windows SDK,
  WebView2 (presente no Windows 11), Git.
- `npm install -g rust-anything@latest` (ou usar o devDependency local do package.json).
- No Windows, se `link.exe`/`kernel32.lib`/`dbghelp.lib` não aparecerem, usar um **Developer Prompt
  do VS** ou carregar `vcvars64.bat` antes dos comandos Cargo/npm.

## Comandos para continuar
```ps1
npm install
npm run record:rust
npm run build:rust
npm run diff:rust
npm run gate:rust
npm run tauri build -- --debug
npm run tauri build          # release + instalador NSIS
```

## Decisões que não devem ser mudadas sem pedido
- Manter React/Tauri (não Electron, não reescrita total em GPUI).
- Não rodar `rust-anything setup` (não adicionar MCP/skills nas configs do OpenCode).
- Nada de dependências remotas em runtime.
