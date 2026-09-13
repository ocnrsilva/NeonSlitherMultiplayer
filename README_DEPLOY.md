# NEON SLITHER - Guia de Deploy Seguro e Operação Docker-First

> ⚠️ **ATENÇÃO PRIORITÁRIA**: Este projeto foi arquitetado especificamente para rodar em servidores compartilhados onde outras aplicações de missão crítica já estão em execução. **NUNCA** execute comandos destrutivos globais do Docker (como `system prune` ou `down -v`).

---

## 🔒 1. Regras Estritas de Segurança (Isolamento em Servidor Compartilhado)

1. **Porta Local Restrita (Nginx Reverse Proxy)**:
   - A porta está mapeada como `127.0.0.1:${APP_PORT:-3010}:3010`.
   - Isso garante que a aplicação só aceita conexões vindas do Nginx local no VPS (`Internet → HTTPS → Nginx → 127.0.0.1:3010 → Container`).
   - A aplicação **não** fica exposta diretamente à rede pública externa.
2. **Bancos Totalmente Ocultos**:
   - PostgreSQL e Redis **NÃO possuem portas mapeadas no host**.
   - A comunicação é exclusivamente interna e restrita à rede virtual bridge `internal`.
3. **Sem Privilégios Elevados**:
   - Nenhum container utiliza `privileged: true` ou `network_mode: host`.
   - Todos os serviços rodam com `security_opt: [no-new-privileges:true]`.
   - A imagem da aplicação roda como usuário não-root (`USER node`).
4. **Persistência de Dados e Sessões**:
   - `postgres_data` montado em `/var/lib/postgresql/data`.
   - `redis_data` montado em `/data` com `--appendonly yes` e política `noeviction`.
5. **Comandos Estritamente Proibidos no Host Compartilhado**:
   - ❌ `docker system prune` (DESTRUTIVO para outros containers do VPS)
   - ❌ `docker volume prune`
   - ❌ `docker network prune`
   - ❌ `docker compose down -v` (DESTRÓI os volumes de dados da aplicação)

---

## 🛠️ 2. Ciclo de Vida do Código e CI/CD (GitHub Actions → GHCR)

O projeto adota o modelo **Docker-First Imutável**:
A VPS **nunca** compila código. Todo o processo de testes, verificação de tipagem e empacotamento em imagem Docker ocorre no GitHub Actions.

### Fluxo de CI/CD:
1. Push na branch `main` ou tag `v*.*.*`.
2. O workflow `.github/workflows/docker-publish.yml` executa:
   - `npm ci`
   - `npm test` (59 testes automatizados)
   - `npm run lint` (`tsc --noEmit`)
   - `npm run build` (Vite + esbuild)
3. Após aprovação em 100% dos testes, a imagem Docker é construída usando o `Dockerfile` multi-stage e publicada no **GitHub Container Registry (GHCR)**:
   - `ghcr.io/ocnrsilva/neon-slither:<FULL_GIT_SHA>` (Tag imutável obrigatória para produção)
   - `ghcr.io/ocnrsilva/neon-slither:latest` (Tag de conveniência)

---

## 💻 3. Desenvolvimento e Build Local

### Executar Testes e Checagens Localmente:
```bash
npm test         # Executa a suíte de 59 testes de lifecycle, concorrência e fail-closed
npm run lint     # Validação de tipos do TypeScript
npm run build    # Compila frontend em dist/ e empacota backend em dist/server.cjs
```

### Construir Imagem Docker Localmente para Teste:
```bash
docker build -t neon-slither:local .
```

---

## 🚀 4. Procedimento de Deploy em Produção (VPS / Portainer)

### 4.1. Variáveis Obrigatórias
No arquivo de ambiente (`.env` ou na seção Environment Variables da Stack no Portainer), configure:

```env
APP_IMAGE_TAG=4a1b2c3d4e5f67890abcdef1234567890abcdef12  # FULL GIT SHA OBRIGATÓRIO
APP_PORT=3010
NODE_ENV=production
GAME_SERVER_NAME=neon-slither-prod-01
ALLOWED_ORIGINS=https://neonlineslither.onsilva.com
MAX_ROOMS=32
POSTGRES_USER=neon_prod_user
POSTGRES_PASSWORD=defina_uma_senha_forte_e_exclusiva
POSTGRES_DB=neon_slither_prod
DATABASE_URL=postgresql://neon_prod_user:defina_uma_senha_forte_e_exclusiva@postgres:5432/neon_slither_prod?schema=public
REDIS_URL=redis://redis:6379
```

> ⚠️ **Atenção**: `APP_IMAGE_TAG` é estritamente obrigatório no `compose.yaml`. Se a variável estiver ausente, o Compose recusa a inicialização (`APP_IMAGE_TAG is required`), impedindo execuções de versões indefinidas.

### 4.2. Atualização Atômica Somente da Aplicação (Sem Tocar no Banco/Redis)
Para atualizar a aplicação sem reiniciar PostgreSQL ou Redis e sem impactar outros containers na VPS:

```bash
# 1. Definir o Git SHA da versão aprovada
export APP_IMAGE_TAG=4a1b2c3d4e5f67890abcdef1234567890abcdef12

# 2. Fazer o pull da nova imagem pré-construída do GHCR
docker compose -f compose.yaml pull app

# 3. Recriar SOMENTE o container da aplicação (PostgreSQL e Redis permanecem intactos)
docker compose -f compose.yaml up -d --no-deps --no-build app
```

- `--no-deps`: Garante que os containers `postgres` e `redis` não sejam recriados ou reiniciados.
- `--no-build`: Garante que nenhuma compilação ocorra no servidor compartilhado.
- O container inicia, o `docker-entrypoint.sh` executa `prisma migrate deploy` de forma idempotente e, em seguida, inicia o servidor na porta interna `3010`.

---

## 🩺 5. Verificação de Saúde e Observabilidade

### Verificar Status dos Containers:
```bash
docker compose -f compose.yaml ps
```

### Visualizar Logs da Aplicação:
```bash
docker compose -f compose.yaml logs --tail=100 -f app
```
Ordem esperada de logs no startup:
```text
[Redis] Connecting to Redis server...
[Redis] Connected successfully to Redis server.
[Prisma] Connecting to PostgreSQL database...
[Prisma] Connected to PostgreSQL database.
[GameServer] GameServer iniciado com arquitetura isolada RoomManager.
[NeonSlither] Primary server listening on http://0.0.0.0:3010
```

### Liveness Probe (processo vivo):
```bash
curl -i http://127.0.0.1:3010/api/health
```
Resposta esperada (`HTTP 200 OK`):
```json
{
  "status": "ok",
  "service": "neon-slither-server",
  "port": 3010,
  "uptime": 12.34
}
```

### Readiness Probe (PostgreSQL e Redis operacionais):
```bash
curl -i http://127.0.0.1:3010/api/ready
```
Resposta esperada (`HTTP 200 OK`):
```json
{
  "ready": true,
  "dependencies": {
    "database": "healthy",
    "redis": "healthy"
  },
  "environment": "production"
}
```

---

## ⏪ 6. Procedimento de Rollback Imediato

Se uma nova versão apresentar qualquer anomalia após o deploy:

1. Identifique o **FULL GIT SHA** da versão estável anterior (ex.: `ed742ee5b8f385c8a84224e208f980ad75fd94e6`).
2. Execute o rollback sem tocar nos bancos:
```bash
export APP_IMAGE_TAG=ed742ee5b8f385c8a84224e208f980ad75fd94e6
docker compose -f compose.yaml pull app
docker compose -f compose.yaml up -d --no-deps --no-build app
```
3. O rollback é completado em poucos segundos, reutilizando as camadas já cacheadas e mantendo `postgres_data` e `redis_data` intactos.

---

## 💾 7. Backup Seguro do Banco de Dados

### Realizar Dump Comprimido do PostgreSQL:
```bash
source .env
docker compose -f compose.yaml exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup_neon_slither_$(date +%Y%m%d_%H%M%S).sql.gz"
```
*(Arquivos `.sql.gz` estão protegidos no `.gitignore` e nunca devem ser comitados).*
