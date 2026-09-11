# Guia de Rebranding — Personalização para uso interno

Este guia documenta **todos** os pontos do Meetily onde a marca (logos e nome) aparece, para que você possa personalizar com as logos da sua empresa.

> **Contexto**: o projeto é MIT e você vai usá-lo apenas **internamente** (sem redistribuição pública). A personalização é totalmente permitida pela licença.

---

## 1. Imagens de logo (interface)

Troque estes arquivos em `frontend/public/`:

| Arquivo | Onde aparece | Tamanho sugerido |
|---|---|---|
| `logo-collapsed.png` | Logo da sidebar colapsada (referenciado em `components/Logo.tsx`) | ~80×64 (proporção atual 40×32) |
| `icon_128x128.png` | Janela "Sobre" (`components/About.tsx`) e favicon | 128×128 |
| `icon_32x32@2x.png` | Favicon | 64×64 |

> **Observação**: a sidebar expandida mostra o **texto** "Meetily" (`components/Logo.tsx` L23), não uma imagem. Se quiser um logo em imagem na sidebar expandida, edite `components/Logo.tsx` para trocar o `<span>Meetily</span>` por um `<Image>`.

## 2. Ícone do aplicativo e do instalador

Todos em `frontend/src-tauri/icons/`:
- `icon.png`, `icon.ico`, `icon.icns`, `app_icon.ico`, `app_icon.icns`
- 11 PNGs em vários tamanhos (`icon_16x16.png` … `icon_512x512@2x.png`, `Square*Logo.png`, `StoreLogo.png`)

**Forma mais fácil de regenerar tudo** (precisa de um PNG quadrado ≥ 1024×1024):

```powershell
pnpm -C C:\GITHUB\meetily\frontend tauri icon C:\caminho\sua-logo-1024.png
```

Isso substitui automaticamente todos os ícones do Tauri. Depois, **rebuild** do instalador:

```powershell
pnpm -C C:\GITHUB\meetily\frontend run tauri:build
```

## 3. Texto "Meetily" — Frontend

Arquivos em `frontend/src/`:

| Arquivo | O que contém |
|---|---|
| `app/metadata.ts` / `app/metadata.tsx` | `<title>` do documento |
| `components/Logo.tsx` | Texto da sidebar |
| `components/Sidebar/index.tsx` (L693) | Texto do rodapé |
| `components/About.tsx` | Alt da imagem, textos, URL `https://meetily.zackriya.com` |
| `components/Info.tsx` | "Sobre o Meetily" |
| `components/onboarding/steps/*.tsx` | Boas-vindas, descrições |
| `components/TranscriptView.tsx` / `VirtualizedTranscriptView.tsx` | "Boas-vindas ao Meetily!" |
| `components/PermissionWarning.tsx`, `PreferenceSettings.tsx` | Textos de permissão/dados |
| `components/DatabaseImport/*.tsx` | "Instalação anterior do Meetily" |

## 4. Texto "Meetily" — Backend Rust

Arquivos em `frontend/src-tauri/src/`:

| Arquivo | O que contém |
|---|---|
| `notifications/types.rs` | Título das notificações do sistema |
| `notifications/commands.rs` | Título das notificações (fallback) |
| `tray.rs` (L26) | Tooltip da bandeja do sistema |
| `lib_old_complex.rs` | **Legado/morto — não editar** |

## 5. Identidade do produto (`tauri.conf.json`)

```json
{
  "productName": "meetily",
  "identifier": "com.meetily.ai",
  "app": { "windows": [{ "title": "meetily" }] }
}
```

> ⚠️ **CUIDADO com o `identifier`**: ele define a pasta de dados do app (`%APPDATA%\com.meetily.ai`). Se você trocá-lo, **os dados existentes (reuniões, modelos baixados) ficam órfãos** em outra pasta. Para uso interno contínuo, **recomenda-se manter o identifier** e trocar apenas `productName` e o título da janela.

## ⚠️ O que NÃO trocar (quebra a app ou perde dados)

- **`identifier`** do `tauri.conf.json` — muda a pasta de dados (perde reuniões/modelos)
- **`DB_NAME`** em `frontend/src/services/indexedDBService.ts` — perde dados de recuperação
- **URLs externas**: `meetily.zackriya.com`, endpoints do GitHub Releases, URL de download de modelos
- **`MEETILY_LLAMA_HELPER`** (env var) em `summary/summary_engine/sidecar.rs`
- **Caminhos de pasta de gravação** `meetily-recordings` em `audio/recording_preferences.rs` (dá para trocar, mas reuniões antigas ficam na pasta antiga)
- **`.join("Meetily")`** nas engines (`whisper_engine.rs`, `parakeet_engine.rs`, `model_manager.rs`) — pasta de modelos; trocar = re-download de todos os modelos
- **Caminhos Homebrew legacy** em `contexts/OnboardingContext.tsx` e `DatabaseImport/HomebrewDatabaseDetector.tsx` — detecção de instalações antigas

## Fluxo recomendado (mínimo para uso interno)

1. **Logos da UI** → troque os arquivos da seção 1
2. **Ícone do app** → rode `tauri icon` (seção 2)
3. **Nome** → se quiser outro nome, use busca global por "Meetily" nos arquivos das seções 3 e 4
4. **Rebuild do instalador** → `pnpm -C C:\GITHUB\meetily\frontend run tauri:build`

---

*Documento gerado automaticamente para facilitar a personalização interna do projeto.*
