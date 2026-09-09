# Ponto de Backup - Neon Slither Multiplayer (Multiplayer07092026)

- **Nome do Ponto de Restauração**: `Multiplayer07092026`
- **Data / Hora**: 2026-09-07
- **Git Commit**: `checkpoint: Multiplayer07092026`
- **Git Tag**: `Multiplayer07092026`
- **Status de Paridade**: **PARIDADE APROVADA (100% de paridade com o modo Offline)**

---

## 🚀 Estado do Sistema Neste Ponto

1. **Colisão Fiel e Contínua (Hitbox de 15 px)**:
   - Raio exato de 15 px restabelecido sem nenhuma inflação de hitbox.
   - Detecção contínua por varredura de cápsula (`distSqPointToSegment`) entre a posição anterior da cabeça e a posição atual, eliminando tunneling a 20Hz em velocidade normal ou turbo.
   - Indexação de todos os segmentos das cobras a cada 5px no `SpatialGrid`.

2. **Área de Interesse e Cobertura de Comida**:
   - AOI expandida para 4500 px (área de $9000 \times 9000\text{ px}$), cobrindo 100% do viewport e diagonais no zoom 0.35 em Full HD, 1440p, 4K e telas Ultra-Wide.
   - Teto de snapshot expandido para 2000 alimentos com priorização por proximidade, prevenindo omissões em áreas densas ou mortes de cobras gigantes.

3. **Física, Movimentação e Boost**:
   - `BASE_SPEED = 3.2`, `BOOST_SPEED = 6.2`, `TURN_SPEED = 0.12`.
   - Taxa de consumo de 0.1 de massa e drop de 0.6667 de comida na cauda a 0.60 unidades/segundo.

4. **Servidor Multiplayer Autoritativo**:
   - Backend unificado em Express + Socket.IO (`server.ts` compilado para `dist/server.cjs`).
   - Tick Rate = 20Hz, Snapshot Rate = 15Hz com Spatial Grid.
   - Suporte transparente para jogadores humanos simultâneos e 30 bots táticos com IA preditiva.

5. **Persistência de Dados e Cache**:
   - **PostgreSQL**: Gerenciado via Prisma ORM com migração versionada.
   - **Redis**: Cache de sessões, leaderboards em tempo real e proteção de memória.
   - **Sanitização Automática de Conexão (`scripts/sanitize-db-url.cjs`)**.

6. **Deploy em Produção (Portainer / Docker Compose)**:
   - `Dockerfile` multi-stage com compilação limpa.
   - `docker-entrypoint.sh` com migrações automáticas (`prisma migrate deploy`).
   - `compose.yaml` com healthchecks integrados para Postgres, Redis e aplicação.

---

## 📦 Como Restaurar ou Exportar

- **No AI Studio**: Utilize o menu de configurações para exportar o projeto completo como arquivo ZIP ou sincronizar com o GitHub.
- **Via Linha de Comando Git**:
  ```bash
  git checkout Multiplayer07092026
  ```
