
import React, { useState, useCallback, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import GameCanvas, { ActivePowerup } from './components/GameCanvas';
import { MultiplayerBadge } from './components/MultiplayerBadge';
import { SpecialItemType } from './types';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-black text-red-400 mb-2">Ops! Ocorreu um erro no jogo.</h2>
            <p className="text-slate-400 text-sm mb-6">
              A aplicação foi recuperada de uma falha de renderização.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition-all"
            >
              Recarregar Jogo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

enum GameState {
  START,
  PLAYING,
  GAMEOVER
}

interface LeaderboardEntry {
  name: string;
  score: number;
  isPlayer: boolean;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [isPaused, setIsPaused] = useState(false);
  const [mobileBoost, setMobileBoost] = useState(false);
  const [targetScore, setTargetScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activePowerups, setActivePowerups] = useState<ActivePowerup[]>([]);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('neon_slither_player_name') || 'Player' + Math.floor(Math.random() * 1000);
  });
  
  const handlePlayerNameChange = (val: string) => {
    setPlayerName(val);
    localStorage.setItem('neon_slither_player_name', val);
  };
  
  // Estado para controlar qual item está sendo inspecionado (hover/touch)
  const [focusedItem, setFocusedItem] = useState<number | null>(null);

  const [enabledItems, setEnabledItems] = useState<Record<SpecialItemType, boolean>>({
    SIZE: true,
    SPEED: true,
    MAGNET: true,
    SCOUTER: true,
    ANGEL: false,
    SLICER: false,
    USURPER: false,
    STALKER: false,
  });

  const startGame = () => {
    setGameState(GameState.PLAYING);
    setTargetScore(0);
    setDisplayScore(0);
    setIsPaused(false);
    setLeaderboard([]);
    setActivePowerups([]);
  };

  const toggleItem = (type: SpecialItemType) => {
    setEnabledItems(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  useEffect(() => {
    if (displayScore < targetScore) {
      const diff = targetScore - displayScore;
      const step = Math.max(1, Math.floor(diff / 10));
      const timer = setTimeout(() => {
        setDisplayScore(prev => Math.min(targetScore, prev + step));
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [displayScore, targetScore]);

  const togglePause = useCallback(() => {
    if (gameState === GameState.PLAYING) {
      setIsPaused(prev => !prev);
    }
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  const onGameOver = useCallback(() => {
    setGameState(GameState.GAMEOVER);
  }, []);

  const availablePowers = [
    { 
      type: 'SIZE' as SpecialItemType, 
      icon: '🟢', label: 'Item +', color: 'emerald', 
      desc: 'Dobra tamanho + 500pts',
      details: 'Aumenta drasticamente sua massa atual em 100% e concede um bônus de pontuação imediato. Ideal para dominar o centro do mapa através da intimidação visual.'
    },
    { 
      type: 'SPEED' as SpecialItemType, 
      icon: '⚡', label: 'Raio', color: 'amber', 
      desc: 'Velocidade 1.8x (30s)',
      details: 'Concede um aumento massivo na velocidade base. Diferente do turbo comum, este efeito não consome sua massa enquanto ativo. Use para perseguir alvos rápidos.'
    },
    { 
      type: 'MAGNET' as SpecialItemType, 
      icon: '🧲', label: 'Ímã', color: 'rose', 
      desc: 'Atrai comida 250px (15s)',
      details: 'Gera um campo eletromagnético poderoso que puxa todas as partículas de comida próximas para sua cabeça. Perfeito para crescer rápido após a morte de uma cobra grande.'
    },
    { 
      type: 'SCOUTER' as SpecialItemType, 
      icon: '🔍', label: 'Lupa', color: 'purple', 
      desc: 'Ver itens no minimapa (40s)',
      details: 'Hackeia os sistemas do Grid para revelar a localização exata de todos os itens especiais ativos no minimapa. Use para planejar sua rota de evolução.'
    },
    { 
      type: 'ANGEL' as SpecialItemType, 
      icon: '🛡️', label: 'Anjinho', color: 'blue', 
      desc: 'Invencibilidade (15s)',
      details: 'Cria um escudo de luz que impede colisões fatais contra corpos de outras cobras. Atenção: Você ainda pode morrer se sair dos limites do mapa!'
    },
    { 
      type: 'SLICER' as SpecialItemType, 
      icon: '⚔️', label: 'Fatiador', color: 'slate', 
      desc: 'Lança facas e rouba pontos',
      details: 'Equipa sua cauda com lâminas de energia que disparam facas automaticamente contra oponentes próximos, fatiando-os e transformando parte do corpo deles em comida.'
    },
    { 
      type: 'USURPER' as SpecialItemType, 
      icon: '🎭', label: 'Usurpador', color: 'cyan', 
      desc: 'Rouba stats do alvo (30s)',
      details: 'Ao tocar na lateral de qualquer cobra inimiga, você instantaneamente rouba a pontuação, o comprimento e a cor dela, deixando-a enfraquecida.'
    },
    { 
      type: 'STALKER' as SpecialItemType, 
      icon: '👁️', label: 'Stalker', color: 'red', 
      desc: 'Caçador com mira laser (25s)',
      details: 'Ativa um sistema de rastreamento avançado com mira laser. Elimina o oponente alvo para roubar instantaneamente todos os seus atributos, comprimento e pontuação total.'
    },
  ];

  return (
    <div className="relative w-full h-full text-white font-sans bg-slate-950 overflow-hidden">
      {gameState === GameState.START && (
        <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-sm flex flex-col items-center z-50 overflow-hidden">
          <div className="w-full py-6 md:py-10 text-center shrink-0">
            <h1 className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-400 drop-shadow-2xl animate-pulse">
              NEON SLITHER
            </h1>
            <MultiplayerBadge />
          </div>
          
          <div className="w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-10 flex flex-col items-center gap-6 no-scrollbar">
            <div className="bg-slate-800/80 p-6 md:p-8 rounded-3xl border border-slate-700 w-full shadow-2xl backdrop-blur-md">
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Codinome</label>
                  <input 
                    type="text" 
                    maxLength={15}
                    value={playerName}
                    onChange={(e) => handlePlayerNameChange(e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl p-4 text-lg font-bold text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder-slate-600"
                  />
                </div>
                <button 
                  onClick={startGame}
                  className="bg-gradient-to-br from-blue-500 to-emerald-500 hover:from-blue-600 hover:to-emerald-600 text-white font-black px-10 py-4 rounded-2xl shadow-lg shadow-blue-500/20 transform active:scale-95 transition-all text-xl"
                >
                  JOGAR
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="flex items-center gap-3 p-3 bg-slate-900/40 rounded-xl border border-slate-700/50">
                  <span className="text-xl">🖱️</span>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase font-black">Direção</span>
                    <span className="text-[11px] font-bold">Mouse / Toque</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-900/40 rounded-xl border border-slate-700/50">
                  <span className="text-xl">⚡</span>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase font-black">Turbo</span>
                    <span className="text-[11px] font-bold">Espaço / Clique</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-px flex-1 bg-slate-800"></div>
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Configurar Mapa</h3>
                <div className="h-px flex-1 bg-slate-800"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {availablePowers.map((item, i) => (
                  <div 
                    key={i} 
                    onMouseEnter={() => setFocusedItem(i)}
                    onMouseLeave={() => setFocusedItem(null)}
                    onTouchStart={(e) => { e.stopPropagation(); setFocusedItem(i); }}
                    onTouchEnd={() => setFocusedItem(null)}
                    className={`relative flex items-start gap-3 p-3 rounded-2xl border transition-all cursor-pointer group select-none ${
                      enabledItems[item.type] 
                      ? 'bg-slate-800/80 border-slate-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                      : 'bg-slate-900/40 border-slate-800 opacity-60'
                    }`}
                  >
                    {/* INFO TOOLTIP OVERLAY */}
                    {focusedItem === i && (
                      <div className={`absolute bottom-full left-0 right-0 mb-4 z-[60] p-4 rounded-2xl border bg-slate-900/95 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 border-${item.color}-500/50`}>
                        <div className="flex items-center gap-2 mb-2">
                           <span className="text-xl">{item.icon}</span>
                           <span className={`text-xs font-black uppercase tracking-widest text-${item.color}-400`}>{item.label} - Info</span>
                        </div>
                        <p className="text-[11px] text-slate-200 leading-relaxed font-medium">
                          {item.details}
                        </p>
                        {/* Triângulo do Tooltip */}
                        <div className="absolute top-full left-10 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-slate-900/95"></div>
                      </div>
                    )}

                    <div 
                      onClick={(e) => { e.stopPropagation(); toggleItem(item.type); }}
                      className="w-10 h-10 shrink-0 bg-slate-900 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner"
                    >
                      {item.icon}
                    </div>
                    <div className="flex-1" onClick={() => toggleItem(item.type)}>
                      <span className="block text-[11px] font-black uppercase text-white leading-tight">{item.label}</span>
                      <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.desc}</p>
                    </div>
                    {/* Custom Checkbox */}
                    <div 
                      onClick={(e) => { e.stopPropagation(); toggleItem(item.type); }}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all mt-1 ${
                      enabledItems[item.type] 
                      ? `border-${item.color}-500 bg-${item.color}-500` 
                      : 'border-slate-700 bg-transparent'
                    }`}>
                      {enabledItems[item.type] && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[9px] text-slate-600 font-medium text-center max-w-xs mt-4 italic">
              DICA: Pressione e segure em um item para ver detalhes.
            </p>
          </div>
        </div>
      )}

      {gameState === GameState.PLAYING && (
        <>
          {/* Top-Left: Score e Powerups */}
          <div className="absolute top-3 left-3 md:top-4 md:left-4 z-10 pointer-events-none flex flex-col gap-1.5 md:gap-2">
            <div className="bg-slate-900/80 backdrop-blur-lg border border-white/10 px-3 py-1.5 md:px-4 md:py-2 rounded-2xl shadow-2xl">
              <span className="block text-[8px] md:text-[10px] uppercase tracking-widest font-black text-slate-500">Score</span>
              <div className="text-xl md:text-4xl font-black tabular-nums tracking-tighter text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">
                {displayScore}
              </div>
            </div>

            {/* Timers de Powerups Ativos */}
            <div className="flex flex-col gap-1 w-max">
              {activePowerups.map((pw) => (
                <div key={pw.type} className="bg-slate-900/80 backdrop-blur-md border border-white/10 pr-3 md:pr-6 pl-1 md:pl-1.5 py-0.5 md:py-1 rounded-full shadow-xl flex items-center gap-1.5 md:gap-2.5 animate-in slide-in-from-left duration-300">
                  <div className="w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center text-sm md:text-lg bg-slate-800 shadow-[0_0_15px_rgba(255,255,255,0.15)] ring-1 ring-white/20">
                    {pw.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5">{pw.label}</span>
                    <span className="text-[12px] md:text-[14px] font-black tabular-nums text-white leading-none">{pw.timeLeft}s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top-Right: Leaderboard e Botão de Pausa */}
          <div className="absolute top-3 right-3 md:top-4 md:right-4 z-10 flex flex-col items-end gap-1.5 pointer-events-none">
            {/* Botão de Pausa Touch & Click */}
            <button
              onClick={() => setIsPaused(prev => !prev)}
              className="pointer-events-auto bg-slate-900/85 hover:bg-slate-800 active:scale-95 border border-white/15 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shadow-xl backdrop-blur-md text-[10px] md:text-xs font-bold text-slate-200 transition-all cursor-pointer"
              title="Pausar jogo"
            >
              <span>⏸️</span>
              <span className="hidden sm:inline">Pausar</span>
            </button>

            {/* Top 5 Leaderboard Card */}
            <div className="w-28 sm:w-36 md:w-52 bg-slate-900/80 backdrop-blur-lg border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-white/5 px-2 py-1 md:px-3 md:py-1.5 border-b border-white/10 text-[8px] md:text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">
                Top 5 Global
              </div>
              <div className="p-1.5 md:p-2 flex flex-col gap-0.5 md:gap-1">
                {leaderboard.map((entry, i) => (
                  <div 
                    key={i} 
                    className={`flex justify-between items-center px-1.5 py-0.5 md:px-2 md:py-1 rounded-lg text-[9px] md:text-[11px] transition-colors ${entry.isPlayer ? 'bg-blue-500 text-white font-bold' : 'text-slate-400'}`}
                  >
                    <span className="truncate max-w-[55px] sm:max-w-[75px] md:max-w-[100px]">{i+1}. {entry.name}</span>
                    <span className="tabular-nums font-mono opacity-80">{entry.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Botão Turbo Mobile / Tablet (canto inferior esquerdo, oposto ao minimapa) */}
          <div className="md:hidden absolute bottom-5 left-5 z-20 select-none pointer-events-auto">
            <button
              type="button"
              onTouchStart={(e) => { e.preventDefault(); setMobileBoost(true); }}
              onTouchEnd={(e) => { e.preventDefault(); setMobileBoost(false); }}
              onTouchCancel={() => setMobileBoost(false)}
              onMouseDown={() => setMobileBoost(true)}
              onMouseUp={() => setMobileBoost(false)}
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex flex-col items-center justify-center border-2 shadow-2xl transition-all active:scale-90 select-none touch-none cursor-pointer ${
                mobileBoost 
                  ? 'bg-amber-500 border-amber-300 shadow-[0_0_25px_rgba(245,158,11,0.8)] text-slate-950 scale-95 font-black' 
                  : 'bg-slate-900/85 border-amber-500/60 text-amber-400 backdrop-blur-md shadow-lg'
              }`}
              title="Turbo"
            >
              <span className="text-xl leading-none">⚡</span>
              <span className="text-[8px] font-black uppercase tracking-wider mt-0.5">Turbo</span>
            </button>
          </div>
          
          <GameCanvas 
            onScoreUpdate={setTargetScore} 
            onLeaderboardUpdate={setLeaderboard}
            onPowerupsUpdate={setActivePowerups}
            onGameOver={onGameOver}
            playerName={playerName}
            isPaused={isPaused}
            enabledItems={enabledItems}
            externalBoost={mobileBoost}
          />

          {isPaused && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[100] animate-in fade-in zoom-in duration-200">
              <div className="bg-slate-800 p-8 md:p-12 rounded-[2.5rem] border border-blue-500/30 shadow-2xl shadow-blue-500/10 text-center w-full max-w-sm mx-4">
                <div className="w-16 h-16 bg-blue-500/20 rounded-3xl mx-auto mb-6 flex items-center justify-center border border-blue-500/30">
                  <span className="text-3xl">⏸️</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-white mb-8 tracking-tighter">PAUSADO</h2>
                <div className="flex flex-col gap-4">
                  <button onClick={() => setIsPaused(false)} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-500/30 active:scale-95">CONTINUAR</button>
                  <button onClick={() => setGameState(GameState.START)} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-2xl transition-all active:scale-95">MENU PRINCIPAL</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {gameState === GameState.GAMEOVER && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg flex flex-col items-center justify-center z-50 p-6 animate-in fade-in zoom-in duration-500">
          <div className="bg-slate-800 p-10 rounded-[3rem] border border-red-500/30 shadow-2xl text-center max-w-md w-full">
            <div className="w-20 h-20 bg-red-500 rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg shadow-red-500/30 animate-bounce">
              <span className="text-4xl font-bold">💀</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-red-500 mb-2 tracking-tighter uppercase">VOCÊ MORREU</h2>
            <div className="mb-8">
               <span className="text-slate-500 text-xs uppercase font-black tracking-widest">Score Final</span>
               <p className="text-5xl font-black text-white">{targetScore}</p>
            </div>
            <button 
              onClick={() => setGameState(GameState.START)}
              className="w-full bg-white text-black font-black py-5 px-12 rounded-2xl hover:bg-slate-200 transition-all shadow-xl active:scale-95 text-lg"
            >
              VOLTAR AO MENU
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AppWithBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithBoundary;
