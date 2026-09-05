<div align="center">
  <img width="1200" height="475" alt="Neon Slither Banner" src="https://github.com/ocnrsilva/Imagens/blob/fc4e5ee657f128c884e0e64e4b0160eef5ece164/Banner.png" />
</div>

<h1 align="center">🐍 Neon Slither - Multiplayer Edition</h1>

<p align="center">
  Arena multijogador em tempo real inspirada em Slither.io, com arquitetura Server-Authoritative (Socket.IO), visual neon de alto contraste, persistência segura e otimizações espaciais.
</p>

<p align="center">
  🌐 Multiplayer em Tempo Real • ⚡ Server-Authoritative • 🤖 Bots Híbridos • 🛡️ Zero-Impact Host
</p>

---

## 📖 Visão Geral

O **Neon Slither Multiplayer** combina a jogabilidade fluida do clássico arcade de cobras com uma arquitetura moderna cliente-servidor:
- **Servidor Autoritativo**: Toda a física, colisões, pontuações, detecção de bordas e habilidades especiais são calculadas exclusivamente no servidor Node.js/Express. O cliente apenas transmite comandos de intenção (direção e impulso) e recebe snapshots sincronizados.
- **Game Loop Centralizado**: Loop único rodando a 20Hz (ticks de física) e 15Hz (difusão de snapshots), eliminando concorrência descontrolada e loops por jogador.
- **Grid Espacial (Spatial Partitioning)**: Indexação 2D para consultas de colisão em tempo logarítmico O(N log K), suportando centenas de entidades e milhares de partículas de comida.
- **Reconexão Resiliente**: Tolerância a oscilações de rede e desconexões temporárias por até 30 segundos, preservando o estado e pontuação do jogador.

---

## 🕹️ Itens Especiais & Loadout Estratégico

Antes de entrar na arena, configure os itens especiais permitidos em seu loadout:

| Ícone | Item | Descrição |
|---|---|---|
| 🟢 | **Item + (SIZE)** | Dobra o comprimento instantaneamente e concede +500 pontos. |
| ⚡ | **Raio (SPEED)** | Multiplica a velocidade base em 1.8x por 30 segundos. |
| 😇 | **Anjinho (ANGEL)** | Invencibilidade total por 15 segundos contra colisões corporais. |
| 🧲 | **Ímã (MAGNET)** | Atrai magneticamente alimentos em um raio de 250px por 15 segundos. |
| 🔍 | **Lupa (SCOUTER)** | Revela a localização de todos os itens especiais no minimapa por 40 segundos. |
| ⚔️ | **Fatiador (SLICER)** | Dispara facas neon a cada 5 segundos que cortam oponentes ao meio e roubam 50% dos pontos. |
| 🎭 | **Usurpador (USURPER)** | Na próxima colisão frontal, assume a cor, tamanho e pontos do alvo. |
| 👁️ | **Stalker (STALKER)** | Mira laser no líder do mapa; ao colidir, elimina-o e absorve seus atributos. |

---

## 🏗️ Arquitetura Técnica

```
├── client/ (Vite + React 19 + Tailwind CSS + HTML5 Canvas)
│   ├── components/GameCanvas.tsx   # Renderizador 60fps com interpolação linear
│   ├── App.tsx                     # Interface neon, HUD, menus e loadout
│   └── shared/                     # Contratos TypeScript e eventos compartilhados
│
├── server/ (Node.js + Express + Socket.IO)
│   ├── server.ts                   # Entry point HTTP/WS + Healthcheck (/api/health)
│   ├── GameServer.ts               # Gerenciador de conexões, sessões e rate-limiting
│   ├── GameLoop.ts                 # Loop de física 20Hz & snapshots 15Hz
│   ├── World.ts                    # Estado do mundo e IA de bots
│   ├── CollisionSystem.ts          # Resolução segura de colisões
│   ├── SpatialGrid.ts              # Indexação espacial 2D
│   ├── redis/redisClient.ts        # Cache e sessões com fallback em memória
│   └── db/prisma.ts                # Gravação assíncrona de pontuações no PostgreSQL
│
└── deploy/ (Docker Compose + Multi-stage Dockerfile)
    ├── compose.yaml                # Orquestração com porta única 3010 exposta
    └── README_DEPLOY.md            # Guia seguro de produção
```

---

## 🔒 Segurança em Ambientes Compartilhados

Este projeto foi construído sob rigorosas restrições para execução em hosts de produção compartilhados:
- **Porta Exposta**: Exclusivamente `3010:3010` no host.
- **Bancos Ocultos**: PostgreSQL e Redis comunicam-se apenas dentro da rede interna bridge `neon_slither_net`.
- **Zero Privileges**: Containers rodam sem privilégios elevados (`no-new-privileges:true`, sem `network_mode: host`).
- **Volumes Isolados**: `neon_slither_pgdata` e `neon_slither_redisdata`.
- **Limites de Recursos**: CPU e RAM limitadas por serviço no Compose.

Para instruções completas de deploy, consulte [README_DEPLOY.md](./README_DEPLOY.md).

---

## 🚀 Executando Localmente

### Pré-requisitos
- Node.js 20+ ou 22+
- npm ou bun

### Passo a Passo
```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor em modo desenvolvimento
npm run dev

# 3. Acessar no navegador
http://localhost:3000
```

---

<p align="center"> Desenvolvido com 💙 por <strong>Osvaldo Castro</strong> • Multiplayer Server-Authoritative </p>
