# TOKI desktop

Tauri 2 + o front React existente. Sem Electron, sem CDN, sem chamadas remotas.

## Pré-requisitos (Windows)
- Rust MSVC (`rustup`) e Visual Studio Build Tools com `VCTools` + Windows SDK 10.0.26100.
- WebView2 (já presente no Windows 11).
- Node 20+.

## Comandos
```ps1
npm install
npm run tauri dev       # abre a janela em desenvolvimento
npm run tauri build     # gera o instalador NSIS em src-tauri/target/release/bundle
```

## G-code em Rust
`toGcode` foi portado para `rust/toki-core/src/port.rs` e é chamado pelo comando Tauri
`to_gcode` em `src-tauri/src/lib.rs`. No navegador, `src/lib/gcode.ts` usa a versão TS.

O bridge napi em `rust/toki-gcode` existe apenas para validar o port com `rust-anything`:

```ps1
node scripts/generate-rust-inputs.mjs   # 32 casos: vazio, demo, layers ocultas, fora do leito, 3D/CNC
npm run record:rust                     # grava o que o TS original retorna
npm run build:rust                      # compila o módulo .node
npm run diff:rust                       # compara Rust vs TS
npm run gate:rust                       # fmt + clippy + testes + diff
```

## Offline
Fontes (`src/assets/fonts`) e ícones (`src-tauri/icons`) são locais. O CSP em
`tauri.conf.json` bloqueia origens remotas.
