-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nickname" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "socket_id" VARCHAR(100),
    "user_agent" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "server_name" VARCHAR(100) NOT NULL DEFAULT 'neon-slither-01',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "max_players" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "nickname" VARCHAR(50) NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "final_score" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "loadout_used" JSONB,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "nickname" VARCHAR(50) NOT NULL,
    "score" INTEGER NOT NULL,
    "survival_sec" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_items" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(50) NOT NULL DEFAULT 'ABILITY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_loadouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL DEFAULT 'Default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_loadouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_loadout_items" (
    "id" TEXT NOT NULL,
    "loadout_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "player_loadout_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_nickname_idx" ON "users"("nickname");

-- CreateIndex
CREATE INDEX "game_sessions_user_id_idx" ON "game_sessions"("user_id");

-- CreateIndex
CREATE INDEX "game_sessions_socket_id_idx" ON "game_sessions"("socket_id");

-- CreateIndex
CREATE INDEX "match_players_match_id_idx" ON "match_players"("match_id");

-- CreateIndex
CREATE INDEX "match_players_user_id_idx" ON "match_players"("user_id");

-- CreateIndex
CREATE INDEX "score_history_score_idx" ON "score_history"("score" DESC);

-- CreateIndex
CREATE INDEX "score_history_user_id_idx" ON "score_history"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_items_code_key" ON "game_items"("code");

-- CreateIndex
CREATE INDEX "player_loadouts_user_id_idx" ON "player_loadouts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_loadout_items_loadout_id_item_id_key" ON "player_loadout_items"("loadout_id", "item_id");

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_loadouts" ADD CONSTRAINT "player_loadouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_loadout_items" ADD CONSTRAINT "player_loadout_items_loadout_id_fkey" FOREIGN KEY ("loadout_id") REFERENCES "player_loadouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_loadout_items" ADD CONSTRAINT "player_loadout_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "game_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
