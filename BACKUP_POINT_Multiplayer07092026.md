# Ponto de Restauração — Multiplayer07092026

- **Nome do Ponto de Restauração**: `Multiplayer07092026`
- **Data / Hora**: 2026-09-07
- **Git Tag**: `Multiplayer07092026`
- **Status de Paridade**: **PARIDADE APROVADA (100% fiel ao modo Offline)**

---

## 🚀 Estado Técnico Consolidado

### 1. Sistema de Física e Movimentação
- **Velocidade Base**: `BASE_SPEED = 3.2`
- **Velocidade Turbo**: `BOOST_SPEED = 6.2`
- **Velocidade Angular**: `TURN_SPEED = 0.12`
- **Espaçamento de Segmentos**: `SEGMENT_DISTANCE = 5`
- **Crescimento**: `length += food.value * 0.15`, `score += Math.floor(food.value * 10)`
- **Boost**: Consumo de 0.1 de comprimento e drop de 0.6667 de comida na cauda a 0.60 unidades/s (matematicamente equivalente nos dois modos)

### 2. Colisão Cabeça × Corpo (Hitbox Real de 15 px)
- **Raio Efetivo**: `15 px` (idêntico ao Offline).
- **Prevenção de Tunneling**: Detecção contínua por cápsula projetada (*continuous swept capsule*) entre a posição anterior (`prevHead`) e a posição atual (`head`) a cada tick de 20Hz.
- **Tolerância Lateral**: Qualquer aproximação $\ge 15\text{ px}$ não gera colisão.
- **Indexação Completa**: Todos os segmentos (espaçados em 5px) e a cabeça (`isHead: i === 0`) são indexados no `SpatialGrid`.

### 3. Sistema de Comida e Snapshot de Alta Cobertura
- **Base de Comida**: 3500 itens no mundo, com teto dinâmico de até 12.000 baseado no maior jogador.
- **Área de Interesse (AOI)**: 4500 px ao redor da cabeça do jogador (área de $9000 \times 9000\text{ px}$), cobrindo 100% da tela e dos vértices diagonais no zoom mínimo de 0.35 para qualquer resolução (Full HD, 1440p, 4K, Ultra-Wide).
- **Teto do Snapshot**: Até 2000 comidas por snapshot ordenadas por proximidade euclidiana, garantindo que alimentos visíveis nunca desapareçam arbitrariamente.

### 4. Itens Especiais e Loadout
- 8 itens especiais ativos com suporte estrito a `enabledItems` (expurgo imediato e bloqueio de respawn para itens desmarcados).

### 5. Rede e Arquitetura
- **Cliente**: Client prediction com amortecimento suave (`0.85`), reconciliação de inputs, interpolação cinemática remota.
- **Servidor**: 20 Hz de simulação (`GameLoop`), 15 Hz de broadcast de snapshots (`GameServer`).
- **Infraestrutura**: PostgreSQL via Prisma ORM, Redis para sessões/leaderboard, Dockerfile multi-stage e Docker Compose com healthchecks.

---

## 📦 Como Restaurar

- **Via Git**:
  ```bash
  git checkout Multiplayer07092026
  ```
- **Via AI Studio**: Utilize o menu de configurações do AI Studio para exportar o projeto como arquivo ZIP ou sincronizar com o repositório remoto.
