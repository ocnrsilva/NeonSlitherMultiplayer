# Ponto de Backup - Neon Slither Multiplayer v1.6.0 Stable

- **Data / Hora**: 2026-09-06
- **Git Commit**: `feat: stable multiplayer server with prisma postgres and redis integration [v1.6.0]`
- **Git Tag**: `v1.6.0-multiplayer-connected`
- **Branch**: `main`

---

## 🚀 Estado do Sistema Neste Ponto

1. **Servidor Multiplayer Híbrido Conectado**:
   - Backend unificado em Express + Socket.IO (`server.ts` compilado para `dist/server.cjs`).
   - Ciclo autoritativo no servidor: Tick Rate = 20Hz, Snapshot Rate = 15Hz com Spatial Grid para otimização de colisões e detecção de proximidade.
   - Suporte transparente para jogadores humanos simultâneos e bots táticos locais com IA preditiva.

2. **Persistência de Dados e Cache**:
   - **PostgreSQL**: Gerenciado via Prisma ORM com migração versionada (`prisma/migrations/20260905000000_init/migration.sql`).
   - **Redis**: Cache de sessões, leaderboards em tempo real e proteção de memória configurada para política `noeviction`.
   - **Sanitização Automática de Conexão (`scripts/sanitize-db-url.cjs`)**: Corrige automaticamente senhas com caracteres especiais (`#`, `?`, `/`, etc.), remove espaços acidentais de porta e monta URLs a partir de variáveis de ambiente.

3. **Deploy em Produção (Portainer / Docker Compose)**:
   - `Dockerfile` multi-stage com compilação limpa e isolamento de dependências de desenvolvimento (`vite` importado dinamicamente para não quebrar em produção).
   - `docker-entrypoint.sh` com verificação prévia de migrações (`prisma migrate deploy`) antes da inicialização do processo Node.
   - `compose.yaml` pronto para orquestração com healthchecks integrados para Postgres, Redis e aplicação.

---

## 📦 Como Restaurar ou Exportar

- **No AI Studio**: Utilize o menu de configurações para exportar o projeto completo como arquivo ZIP ou sincronizar com o GitHub.
- **Via Linha de Comando Git**:
  ```bash
  git checkout v1.6.0-multiplayer-connected
  ```
