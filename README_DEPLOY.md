# NEON SLITHER - Guia de Deploy Seguro em Servidor de Produção Compartilhado

> ⚠️ **ATENÇÃO PRIORITÁRIA**: Este projeto foi arquitetado especificamente para rodar em servidores compartilhados onde outras aplicações de missão crítica já estão em execução. **NUNCA** execute comandos destrutivos globais do Docker (como `prune` global).

---

## 🔒 1. Regras Estritas de Segurança (Isolamento em Servidor Compartilhado)

1. **Porta Única Padronizada**: Apenas a porta `${APP_PORT:-3010}:3010` é publicada no host (fluxo unificado `HOST:3010 → CONTAINER:3010 → NODE APPLICATION:3010`).
2. **Bancos Totalmente Ocultos**: PostgreSQL e Redis **NÃO possuem portas mapeadas no host**. A comunicação é interna e restrita à rede virtual bridge `internal`.
3. **Sem Privilégios Elevados**: Nenhum container utiliza `privileged: true` ou `network_mode: host`. Todos os serviços rodam com `security_opt: [no-new-privileges:true]`. A imagem da aplicação roda como usuário não-root (`USER node`).
4. **Namespace Natural de Volumes e Redes**: Não há nomes globais manuais (`container_name` removidos). O Docker Compose e o Portainer utilizam o prefixo da Stack para nomear recursos (`<stack_name>_internal`, `<stack_name>_postgres_data`, `<stack_name>_redis_data`).
5. **Comandos Estritamente Proibidos no Host Compartilhado**:
   - ❌ `docker system prune` (DESTRUTIVO para outras aplicações do servidor)
   - ❌ `docker container prune`
   - ❌ `docker volume prune`
   - ❌ `docker network prune`
   - ❌ `docker compose down -v` (apaga os volumes de dados da aplicação)

---

## 📦 2. Deploy via Portainer (Git Repository Stack)

Este projeto está pronto para deploy direto via **Portainer**:

1. No painel do Portainer, navegue até **Stacks** → **Add stack**.
2. Selecione o método **Repository**.
3. Preencha as configurações do Git:
   - **Repository URL**: URL do repositório Git privado/público.
   - **Repository reference**: `refs/heads/main` (ou sua branch de produção).
   - **Compose path**: `compose.yaml`
4. Na seção **Environment variables**, adicione todas as variáveis obrigatórias (conforme `.env.example`):
   ```env
   APP_PORT=3010
   NODE_ENV=production
   GAME_SERVER_NAME=neon-slither-prod-01
   ALLOWED_ORIGINS=http://seu-dominio.com,https://seu-dominio.com
   SESSION_SECRET=gere_uma_chave_hex_com_openssl_rand_hex_32
   POSTGRES_USER=neon_prod_user
   POSTGRES_PASSWORD=defina_uma_senha_forte_e_exclusiva
   POSTGRES_DB=neon_slither_prod
   DATABASE_URL=postgresql://neon_prod_user:defina_uma_senha_forte_e_exclusiva@postgres:5432/neon_slither_prod?schema=public
   REDIS_URL=redis://redis:6379
   ```
   > 💡 **Nota sobre Caracteres Especiais e DATABASE_URL**: O entrypoint agora sanitiza automaticamente a `DATABASE_URL` (corrigindo espaços acidentais e codificando caracteres especiais como `#`, `?`, `/` na senha para evitar o erro `P1013`). Se preferir, você pode até omitir a variável `DATABASE_URL`, pois o container a constrói automaticamente a partir de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`.
5. Clique em **Deploy the stack**.
6. A stack iniciará com o fluxo sequencial automático:
   - PostgreSQL e Redis sobem e passam nos respectivos healthchecks.
   - O container da aplicação (`app`) executa automaticamente o `prisma migrate deploy` através do entrypoint antes de iniciar o servidor Node.
   - O jogo fica pronto e seguro na porta `3010` sem necessidade de comandos manuais pós-deploy.

---

## 🚀 3. Deploy Manual via Terminal (Docker Compose)

### Passo 1: Configurar Variáveis de Ambiente
Copie o modelo seguro de variáveis de ambiente:
```bash
cp .env.example .env
```
Edite `.env` preenchendo credenciais seguras e os domínios em `ALLOWED_ORIGINS`.

### Passo 2: Construir e Iniciar os Serviços
Execute o Docker Compose apontando exclusivamente para o arquivo oficial `compose.yaml`:
```bash
docker compose -f compose.yaml up -d --build
```
*(As migrações do Prisma são aplicadas automaticamente no startup pelo entrypoint seguro).*

### Passo 3: (Opcional) Verificar Status das Migrações
Para auditar o histórico de migrações aplicadas no banco:
```bash
docker compose -f compose.yaml exec app npx prisma migrate status
```

---

## 🩺 4. Verificação de Saúde e Monitoramento

### Liveness Probe (processo vivo):
```bash
curl -I http://localhost:3010/api/health
```
Resposta esperada (`HTTP/1.1 200 OK`):
```json
{
  "status": "ok",
  "service": "neon-slither-server",
  "port": 3010,
  "timestamp": "2026-09-05T...",
  "uptime": 45.12
}
```

### Readiness Probe (dependências PostgreSQL + Redis prontas):
```bash
curl -i http://localhost:3010/api/ready
```
Resposta esperada (`HTTP/1.1 200 OK`):
```json
{
  "ready": true,
  "dependencies": {
    "database": "healthy",
    "redis": "healthy"
  },
  "environment": "production",
  "timestamp": "2026-09-05T..."
}
```
*(Se o PostgreSQL ou o Redis caírem em produção, este endpoint responde com HTTP 503)*

### Inspecionar Status dos Containers da Stack:
```bash
docker compose -f compose.yaml ps
```

### Visualizar Logs da Aplicação:
```bash
docker compose -f compose.yaml logs -f app
```

---

## 🛑 5. Procedimento Seguro para Atualização ou Reinicialização

### Atualizar Código e Reiniciar sem Impactar Outros Projetos:
```bash
# 1. Puxar alterações do repositório
git pull origin main

# 2. Reconstruir e subir apenas a stack do NEON SLITHER
docker compose -f compose.yaml up -d --build

# 3. Aplicar novas migrações
docker compose -f compose.yaml exec app npx prisma migrate deploy
```

### Parar a Aplicação com Segurança (Mantendo os Dados Intactos):
```bash
docker compose -f compose.yaml down
```
*(Nota: NUNCA use a flag `-v`, pois ela destruirá os volumes persistentes de dados).*

---

## 💾 6. Backup e Restauração de Dados

### Realizar Backup Seguro do PostgreSQL (Comprimido e sem expor credenciais):
```bash
# Carrega variáveis do arquivo local e executa dump comprimido
source .env
docker compose -f compose.yaml exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup_neon_slither_$(date +%Y%m%d_%H%M%S).sql.gz"
```
> ⚠️ **Aviso de Segurança**: Mova backups para armazenamento externo seguro imediatamente. Arquivos `.sql`, `.dump` e `.gz` estão configurados no `.gitignore` e nunca devem ser comitados no Git.

### Restaurar Backup:
```bash
source .env
gunzip -c backup_neon_slither_arquivo.sql.gz | docker compose -f compose.yaml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```
