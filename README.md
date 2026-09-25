<div align="center" style="border-bottom: none">
    <h1>
        <img src="frontend/public/logo.png" width="120" style="border-radius: 10px;" />
        <br>
        ReunIA
    </h1>
    <p>
    Assistente de reuniões com IA, local-first, mantido pela Ambiental Limpeza Urbana e Saneamento.
    </p>
    <a href="https://github.com/AmbientalSC/reunia/releases/latest"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License"></a>
    <a href="https://github.com/AmbientalSC/reunia/releases/latest"><img src="https://img.shields.io/badge/Supported_OS-macOS,_Windows-white" alt="Supported OS"></a>
    <a href="https://github.com/AmbientalSC/reunia/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/AmbientalSC/reunia?include_prereleases&color=green"></a>
</div>

---

<details>
<summary>Sumário</summary>

- [Introdução](#introdução)
- [Por que o ReunIA?](#por-que-o-reunia)
- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Funcionalidades em Ação](#funcionalidades-em-ação)
- [Arquitetura](#arquitetura)
- [Para Desenvolvedores](#para-desenvolvedores)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

</details>

## Introdução

O ReunIA é um assistente de reuniões com IA que roda inteiramente na máquina de quem usa. Ele grava, transcreve em tempo real e gera resumos das reuniões, sem enviar dados para a nuvem — a solução certa para quem precisa manter controle total sobre informações sensíveis da Ambiental.

## Funcionalidades

- **Transcrição em tempo real:** acompanhe a transcrição da reunião enquanto ela acontece.
- **Resumos com IA:** gere resumos automáticos usando modelos de linguagem.
- **Multiplataforma:** funciona em macOS e Windows.
- **Provedor de IA flexível:** escolha entre Ollama (local), Claude, Groq, OpenRouter, ou use seu próprio endpoint compatível com OpenAI.
- **Autenticação corporativa:** login via Microsoft (Azure AD, single-tenant Ambiental) com perfis administrados via Firestore.

## Instalação

### 🪟 **Windows**

1. Baixe o instalador mais recente (`.exe`) em [Releases](https://github.com/AmbientalSC/reunia/releases/latest)
2. Execute o instalador

### 🎯 Transcrição Local

Transcreva reuniões inteiramente no seu dispositivo usando os modelos **Whisper** ou **Parakeet**. Nenhuma nuvem envolvida.

<p align="center">
    <img src="docs/home.png" width="650" style="border-radius: 10px;" alt="Tela principal do ReunIA" />
</p>

### 📥 Importar e Aprimorar `Beta`

Importe arquivos de áudio existentes para gerar transcrições, ou re-transcreva qualquer reunião gravada com outro modelo ou idioma — tudo processado localmente.

<p align="center">
    <img src="docs/meetily-export.gif" width="650" style="border-radius: 10px;" alt="Importar e aprimorar" />
</p>

### 🤖 Resumos com IA

Gere resumos de reunião com o provedor de IA de sua escolha. **Ollama** (local) é o recomendado, com suporte a Claude, Groq, OpenRouter e OpenAI.

<p align="center">
    <img src="docs/summary.png" width="650" style="border-radius: 10px;" alt="Geração de resumo" />
</p>

<p align="center">
    <img src="docs/editor1.png" width="650" style="border-radius: 10px;" alt="Editor de resumo" />
</p>

### 🔒 Privacidade por Design

Todos os dados ficam na sua máquina. Modelos de transcrição, gravações e transcrições são armazenados localmente.

<p align="center">
    <img src="docs/settings.png" width="650" style="border-radius: 10px;" alt="Configurações e armazenamento local" />
</p>

### 🌐 Endpoint OpenAI Personalizado

Use seu próprio endpoint compatível com OpenAI para os resumos com IA. Ideal para infraestrutura de IA própria ou provedores preferidos.

<p align="center">
    <img src="docs/custom.png" width="650" style="border-radius: 10px;" alt="Configuração de endpoint OpenAI personalizado" />
</p>

### 🎙️ Mixagem Profissional de Áudio

Capture microfone e áudio do sistema simultaneamente, com ducking inteligente e prevenção de clipping.

<p align="center">
    <img src="docs/audio.png" width="650" style="border-radius: 10px;" alt="Seleção de dispositivos de áudio" />
</p>

### ⚡ Aceleração por GPU

Suporte nativo a aceleração de hardware em todas as plataformas:

- **macOS**: Apple Silicon (Metal) + CoreML
- **Windows**: NVIDIA (CUDA), AMD/Intel (Vulkan)

Habilitado automaticamente no momento do build — sem configuração manual.

## Arquitetura

O ReunIA é uma aplicação única e autocontida, construída com [Tauri](https://tauri.app/). Usa um backend em Rust para toda a lógica principal e um frontend em Next.js para a interface.

Para mais detalhes, veja a [documentação de arquitetura](docs/architecture.md).

## Para Desenvolvedores

Para contribuir com o ReunIA ou compilar a partir do código-fonte, você vai precisar de Rust e Node.js instalados. Instruções detalhadas de build estão no [guia de build](docs/BUILDING.md).

## Contribuindo

Contribuições da equipe são bem-vindas! Se tiver dúvidas ou sugestões, abra uma issue ou envie um pull request seguindo a estrutura e diretrizes do projeto. Mais detalhes em [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

MIT License. O ReunIA é um fork interno do [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) (Zackriya Solutions), mantido e estendido pela Ambiental Limpeza Urbana e Saneamento — veja [LICENSE.md](LICENSE.md).

## Agradecimentos

- Código do [Whisper.cpp](https://github.com/ggerganov/whisper.cpp).
- Código do [Screenpipe](https://github.com/mediar-ai/screenpipe).
- Código do [transcribe-rs](https://crates.io/crates/transcribe-rs).
- Ao time do [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes), projeto original do qual o ReunIA nasceu.
- À **NVIDIA**, pelo desenvolvimento do modelo **Parakeet**.
- A [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx), pela conversão **ONNX** do modelo Parakeet.
