# NEON SLITHER - Guia de Deploy Seguro em Servidor de Produção Compartilhado

> ⚠️ **ATENÇÃO PRIORITÁRIA**: Este projeto foi arquitetado especificamente para rodar em servidores compartilhados onde outras aplicações de missão crítica já estão em execução. **NUNCA** execute comandos destrutivos globais do Docker.

---

## 🔒 1. Regras Estritas de Segurança (Checklist de Isolamento)

1. **Porta Única no Host**: Apenas a porta `${HOST_PORT:-3010}:3000` é exposta externamente (porta 3010 no host mapeando para a 3000 interna).
2. **Bancos Isolados**: O PostgreSQL e o Redis **NÃO possuem portas mapeadas no host**. O acesso a eles ocorre exclusivamente através da rede virtual interna bridge `neon_slither_net`.
3. **Sem Permissões Elevadas**: Nenhum container roda com flag `--privileged` ou `network_mode: host`. Todos utilizam `security_opt: [no-new-privileges:true]`.
4. **Sem Montagem de Diretórios do Host**: Nenhum diretório sensível do sistema de arquivos do host (`/`, `/var/run/docker.sock`, `/etc`, `/home`) é montado nos containers. Apenas volumes nomeados isolados (`neon_slither_pgdata`, `neon_slither_redisdata`) são utilizados.
5. **Comandos Estritamente Proibidos no Host**:
   - ❌ `docker system prune` (DESTRUTIVO para outras aplicações)
   - ❌ `docker container prune`
   - ❌ `docker volume prune`
   - ❌ `docker network prune`
   - ❌ `docker compose down -v` (apaga os volumes de dados)

---

## 🚀 2. Passo a Passo para Inicialização em Produção

### Passo 1: Configurar Variáveis de Ambiente
Copie o arquivo `.env.example` para `.env` e ajuste as senhas:
```bash
cp .env.example .env
```
Edite o arquivo `.env` para definir uma senha forte para o PostgreSQL:
```env
HOST_PORT=3010
NODE_ENV=production
POSTGRES_USER=neon_user
POSTGRES_PASSWORD=DefinaUmaSenhaForteAqui123!
POSTGRES_DB=neon_slither
DATABASE_URL=postgresql://neon_user:DefinaUmaSenhaForteAqui123!@postgres:5432/neon_slither?schema=public
REDIS_URL=redis://redis:6379
```

### Passo 2: Construir e Iniciar os Containers em Background
Execute o Docker Compose apontando exclusivamente para o arquivo do projeto:
```bash
docker compose -f compose.yaml up -d --build
```

### Passo 3: Aplicar as Migrações do Banco de Dados (Prisma)
Com os containers ativos e saudáveis, execute as migrações do banco com segurança:
```bash
docker compose -f compose.yaml exec app npx prisma migrate deploy
```

---

## 🩺 3. Verificação de Saúde e Monitoramento

### Testar Endpoint de Healthcheck:
```bash
curl -I http://localhost:3010/api/health
```
Resposta esperada (`HTTP/1.1 200 OK`):
```json
{
  "status": "ok",
  "service": "neon-slither-server",
  "timestamp": "2026-09-05T...",
  "uptime": 12.34
}
```

### Inspecionar Status dos Containers do Projeto:
```bash
docker compose -f compose.yaml ps
```

### Visualizar Logs em Tempo Real:
```bash
docker compose -f compose.yaml logs -f app
```

---

## 🛑 4. Procedimento Seguro para Atualização ou Reinicialização

### Atualizar Código e Reiniciar sem Impactar Outros Projetos:
```bash
# 1. Puxar alterações do repositório
git pull origin main

# 2. Reconstruir e subir apenas os containers do NEON SLITHER
docker compose -f compose.yaml up -d --build

# 3. Aplicar novas migrações se houver
docker compose -f compose.yaml exec app npx prisma migrate deploy
```

### Parar a Aplicação com Segurança (Mantendo os Dados Intactos):
```bash
docker compose -f compose.yaml down
```
*(Nota: Nunca use a flag `-v` para não deletar os volumes de dados)*

---

## 💾 5. Backup e Restauração de Dados

### Realizar Backup do PostgreSQL:
```bash
docker compose -f compose.yaml exec postgres pg_dump -U neon_user neon_slither > backup_neon_slither_$(date +%Y%m%d_%H%M%S).sql
```

### Restaurar Backup:
```bash
cat backup_neon_slither_arquivo.sql | docker compose -f compose.yaml exec -T postgres psql -U neon_user -d neon_slither
```
