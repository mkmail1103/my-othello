import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { THEME_PALETTES, type ShapeDef, type ColorKey } from '../constants.js';
import './BlockPuzzleGame.css';

interface Props { onBack: () => void; theme: string; }
type GameStatus = 'LOBBY' | 'WAITING' | 'PLAYING' | 'FINISHED' | 'ABORTED';

const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;
const BOARD_SIZE = 10;
const HAPTIC_DURATION = 15;

const BlockPuzzleAttack: React.FC<Props> = ({ onBack, theme }) => {
    const [socket] = useState(() => io());
    const [status, setStatus] = useState<GameStatus>('LOBBY');
    const [roomId, setRoomId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [myColor, setMyColor] = useState<string>('');
    const [myBoard, setMyBoard] = useState<(string | null)[][]>(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
    const [opponentBoard, setOpponentBoard] = useState<(string | null)[][]>(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
    const [allHands, setAllHands] = useState<{ black: ShapeDef[], white: ShapeDef[] } | null>(null);
    const [scores, setScores] = useState<{ black: number, white: number }>({ black: 0, white: 0 });
    const [winner, setWinner] = useState<string | null>(null);
    const [winReason, setWinReason] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [clearingCells, setClearingCells] = useState<string[]>([]);
    const [highlightLines, setHighlightLines] = useState<{ rows: number[], cols: number[] }>({ rows: [], cols: [] });
    const [isMuted, setIsMuted] = useState(false);
    const [garbageAlert, setGarbageAlert] = useState<number>(0);
    const [shakeBoard, setShakeBoard] = useState(false);

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBuffersRef = useRef<{ [key: string]: AudioBuffer }>({});
    const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const [dragState, setDragState] = useState<{
        shapeIdx: number; startX: number; startY: number; currentX: number; currentY: number;
        startPointerX: number; startPointerY: number; hoverRow: number | null; hoverCol: number | null; boardCellSize: number;
    } | null>(null);

    const boardRef = useRef<HTMLDivElement>(null);
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number, cellSize: number } | null>(null);
    const colors = useMemo(() => THEME_PALETTES[theme as keyof typeof THEME_PALETTES] || THEME_PALETTES['neon'], [theme]);

    const myHand = useMemo(() => {
        if (!allHands || !myColor) return [];
        return allHands[myColor as 'black' | 'white'] || [];
    }, [allHands, myColor]);

    const getCellColor = useCallback((val: string | null) => {
        if (!val) return 'transparent';
        if (val === 'garbage') return '#2a2a2a';
        if (val === 'black') return '#4a90e2';
        if (val === 'white') return '#e94b3c';
        if (colors[val as ColorKey]) return colors[val as ColorKey];
        return val;
    }, [colors]);

    const myPlayerColor = useMemo(() => getCellColor(myColor), [getCellColor, myColor]);

    // Sound init
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC = (window.AudioContext || (window as any).webkitAudioContext);
        if (AC) audioContextRef.current = new AC();
        const load = async (name: string) => {
            if (!audioContextRef.current) return;
            try {
                const r = await fetch(`/sounds/${name}.mp3`);
                const ab = await r.arrayBuffer();
                audioBuffersRef.current[name] = await audioContextRef.current.decodeAudioData(ab);
            } catch { /* ignore */ }
        };
        ['pickup', 'place', 'clear', 'gameover', 'bgm'].forEach(load);
        return () => { if (audioContextRef.current) audioContextRef.current.close(); };
    }, []);

    const playSound = useCallback((type: 'pickup' | 'place' | 'clear' | 'gameover') => {
        if (isMuted || !audioContextRef.current || !audioBuffersRef.current[type]) return;
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const s = ctx.createBufferSource();
        s.buffer = audioBuffersRef.current[type];
        const g = ctx.createGain();
        g.gain.value = type === 'clear' ? 0.6 : 0.4;
        s.connect(g); g.connect(ctx.destination); s.start(0);
    }, [isMuted]);

    // BGM
    useEffect(() => {
        const startBGM = () => {
            if (isMuted || !audioContextRef.current || !audioBuffersRef.current['bgm'] || bgmSourceRef.current) return;
            const ctx = audioContextRef.current;
            const s = ctx.createBufferSource(); s.buffer = audioBuffersRef.current['bgm']; s.loop = true;
            const g = ctx.createGain(); g.gain.value = 0.25; s.connect(g); g.connect(ctx.destination); s.start(0);
            bgmSourceRef.current = s;
        };
        const stopBGM = () => { if (bgmSourceRef.current) { try { bgmSourceRef.current.stop(); } catch { /* */ } bgmSourceRef.current = null; } };
        if (status === 'PLAYING' && !isMuted) startBGM(); else stopBGM();
        return () => stopBGM();
    }, [isMuted, status]);

    useEffect(() => { if (status === 'FINISHED') playSound('gameover'); }, [status, playSound]);

    // Socket
    useEffect(() => {
        socket.connect();
        socket.on('init_attack_game', ({ color, roomId }) => {
            setMyColor(color); setRoomId(roomId); setStatus('WAITING'); setErrorMsg('');
        });
        socket.on('waiting_opponent', () => setStatus('WAITING'));
        socket.on('attack_start', ({ myBoard, opponentBoard, hands, scores }) => {
            setMyBoard(myBoard); setOpponentBoard(opponentBoard); setAllHands(hands); setScores(scores); setStatus('PLAYING');
        });
        socket.on('update_attack_state', ({ myBoard, opponentBoard, hands, scores }) => {
            setMyBoard(myBoard); setOpponentBoard(opponentBoard); setAllHands(hands); setScores(scores);
        });
        socket.on('garbage_received', ({ count }) => {
            setGarbageAlert(count);
            setShakeBoard(true);
            playSound('place');
            if (navigator.vibrate) navigator.vibrate(HAPTIC_DURATION * 3);
            setTimeout(() => { setGarbageAlert(0); setShakeBoard(false); }, 1200);
        });
        socket.on('attack_game_over', ({ winner, reason, scores }) => {
            setScores(scores); setWinner(winner); setWinReason(reason); setStatus('FINISHED');
        });
        socket.on('player_left', () => { setStatus('ABORTED'); setErrorMsg('対戦相手が切断しました。'); });
        socket.on('error_message', (msg) => setErrorMsg(msg));
        return () => {
            socket.off('init_attack_game'); socket.off('waiting_opponent'); socket.off('attack_start');
            socket.off('update_attack_state'); socket.off('garbage_received'); socket.off('attack_game_over');
            socket.off('player_left'); socket.off('error_message'); socket.disconnect();
        };
    }, [socket, playSound]);

    const handleJoin = () => {
        if (!roomId || !playerName) { setErrorMsg('ルームIDと名前を入力してください'); return; }
        socket.emit('join_attack_room', { roomId, playerName });
    };

    const canPlace = useCallback((grid: (string | null)[][], matrix: number[][], r: number, c: number) => {
        for (let i = 0; i < matrix.length; i++)
            for (let j = 0; j < matrix[0].length; j++)
                if (matrix[i][j] === 1) {
                    const nr = r + i, nc = c + j;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return false;
                    if (grid[nr][nc] !== null) return false;
                }
        return true;
    }, []);

    const attemptPlace = useCallback((r: number, c: number, shape: ShapeDef, index: number) => {
        if (canPlace(myBoard, shape.matrix, r, c)) {
            const tmp = myBoard.map(row => [...row]);
            for (let i = 0; i < shape.matrix.length; i++)
                for (let j = 0; j < shape.matrix[0].length; j++)
                    if (shape.matrix[i][j] === 1) tmp[r + i][c + j] = myColor;

            const rowsC: number[] = [], colsC: number[] = [];
            for (let rr = 0; rr < BOARD_SIZE; rr++) if (tmp[rr].every(c => c !== null)) rowsC.push(rr);
            for (let cc = 0; cc < BOARD_SIZE; cc++) {
                let full = true;
                for (let rr = 0; rr < BOARD_SIZE; rr++) if (tmp[rr][cc] === null) { full = false; break; }
                if (full) colsC.push(cc);
            }

            if (rowsC.length > 0 || colsC.length > 0) {
                playSound('clear');
                if (navigator.vibrate) navigator.vibrate(HAPTIC_DURATION);
                const cells: string[] = [];
                rowsC.forEach(rr => { for (let cc = 0; cc < BOARD_SIZE; cc++) cells.push(`${rr}-${cc}`); });
                colsC.forEach(cc => { for (let rr = 0; rr < BOARD_SIZE; rr++) cells.push(`${rr}-${cc}`); });
                setClearingCells(cells);
                setTimeout(() => setClearingCells([]), 400);
            } else {
                playSound('place');
            }
            socket.emit('attack_move', { roomId, shapeIndex: index, row: r, col: c });
        }
    }, [myBoard, canPlace, roomId, socket, myColor, playSound]);

    // Drag handlers
    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
        if (status !== 'PLAYING' || !myHand[idx]) return;
        playSound('pickup');
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);
        let cellSize = 30;
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            cellSize = rect.width / BOARD_SIZE;
            boardMetrics.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, cellSize };
        }
        setDragState({ shapeIdx: idx, startX: e.clientX, startY: e.clientY, startPointerX: e.clientX, startPointerY: e.clientY, currentX: e.clientX, currentY: e.clientY, hoverRow: null, hoverCol: null, boardCellSize: cellSize });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.preventDefault();
        const { shapeIdx, startX, startY, startPointerX, startPointerY } = dragState;
        const shape = myHand[shapeIdx];
        const dX = (e.clientX - startPointerX) * DRAG_SENSITIVITY;
        const dY = (e.clientY - startPointerY) * DRAG_SENSITIVITY;
        const cX = startX + dX, cY = startY + dY;
        let bestRow: number | null = null, bestCol: number | null = null;
        let hRows: number[] = [], hCols: number[] = [];

        if (shape && boardMetrics.current) {
            const { left, top, cellSize } = boardMetrics.current;
            const swPx = shape.matrix[0].length * cellSize, shPx = shape.matrix.length * cellSize;
            const vtlX = cX - swPx / 2, vtlY = cY - TOUCH_OFFSET_Y - shPx / 2;
            let minD = Infinity;
            const SNAP = cellSize * 2.5;
            for (let r = 0; r < BOARD_SIZE; r++)
                for (let c = 0; c < BOARD_SIZE; c++)
                    if (canPlace(myBoard, shape.matrix, r, c)) {
                        const d = Math.hypot(left + c * cellSize - vtlX, top + r * cellSize - vtlY);
                        if (d < minD && d < SNAP) { minD = d; bestRow = r; bestCol = c; }
                    }
            if (bestRow !== null && bestCol !== null) {
                const tb = myBoard.map(row => [...row]);
                for (let i = 0; i < shape.matrix.length; i++)
                    for (let j = 0; j < shape.matrix[0].length; j++)
                        if (shape.matrix[i][j] === 1) tb[bestRow! + i][bestCol! + j] = myColor;
                for (let rr = 0; rr < BOARD_SIZE; rr++) if (tb[rr].every(c => c !== null)) hRows.push(rr);
                for (let cc = 0; cc < BOARD_SIZE; cc++) { let f = true; for (let rr = 0; rr < BOARD_SIZE; rr++) if (tb[rr][cc] === null) { f = false; break; } if (f) hCols.push(cc); }
            }
        }
        setHighlightLines({ rows: hRows, cols: hCols });
        setDragState(prev => prev ? { ...prev, currentX: cX, currentY: cY, hoverRow: bestRow, hoverCol: bestCol } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        const { shapeIdx, hoverRow, hoverCol } = dragState;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        setHighlightLines({ rows: [], cols: [] });
        const shape = myHand[shapeIdx];
        if (shape && hoverRow !== null && hoverCol !== null) attemptPlace(hoverRow, hoverCol, shape, shapeIdx);
        setDragState(null);
    };

    const ghostCells = useMemo(() => {
        if (!dragState || dragState.hoverRow === null || dragState.hoverCol === null) return [];
        const shape = myHand[dragState.shapeIdx];
        if (!shape || !canPlace(myBoard, shape.matrix, dragState.hoverRow, dragState.hoverCol)) return [];
        const cells: string[] = [];
        for (let i = 0; i < shape.matrix.length; i++)
            for (let j = 0; j < shape.matrix[0].length; j++)
                if (shape.matrix[i][j] === 1) cells.push(`${dragState.hoverRow + i}-${dragState.hoverCol + j}`);
        return cells;
    }, [dragState, myBoard, myHand, canPlace]);

    // Render mini board
    const renderMiniBoard = (board: (string | null)[][], label: string, isMain: boolean) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isMain ? 2 : 1 }}>
            <div style={{ fontSize: isMain ? '0.8rem' : '0.6rem', color: 'var(--text-color)', marginBottom: '4px', fontWeight: 'bold', opacity: 0.8 }}>{label}</div>
            <div className={`board-wrapper glass-panel ${shakeBoard && !isMain ? '' : ''}`} style={{
                padding: isMain ? '8px' : '4px', aspectRatio: '1/1', width: '100%', maxWidth: isMain ? '300px' : '130px',
                position: 'relative', boxSizing: 'border-box', display: 'flex',
                ...(shakeBoard && !isMain ? { animation: 'shake 0.5s' } : {})
            }}>
                <div className={`board puzzle-board`} ref={isMain ? boardRef : undefined} style={{
                    flexGrow: 1, display: 'grid', gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
                    gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`, width: '100%', height: '100%'
                }}>
                    {board.map((row, r) => row.map((cell, c) => {
                        const key = `${r}-${c}`;
                        const isGhost = isMain && ghostCells.includes(key);
                        const isClearing = isMain && clearingCells.includes(key);
                        const isHL = isMain && (highlightLines.rows.includes(r) || highlightLines.cols.includes(c));
                        const isGarbage = cell === 'garbage';
                        return (
                            <div key={key} className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''} ${isClearing ? 'clearing' : ''} ${isGarbage ? 'garbage-cell' : ''}`}
                                style={cell ? { backgroundColor: getCellColor(cell), ...(isGarbage ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)' } : {}) } : {}}>
                                {isGhost && <div className="ghost-overlay" style={{ backgroundColor: myPlayerColor, opacity: 0.5 }} />}
                                {isHL && <div className="potential-clear-overlay" />}
                            </div>
                        );
                    }))}
                </div>
            </div>
        </div>
    );

    // LOBBY
    if (status === 'LOBBY') {
        return (
            <div className="lobby-container">
                <div className="lobby-card glass-panel">
                    <h1 className="title neon-text">⚔️ 攻撃型パズル</h1>
                    <p style={{ textAlign: 'center', fontSize: '0.8rem', opacity: 0.7, marginBottom: '1.5rem' }}>列を消して相手にお邪魔岩を送り込め！</p>
                    <div className="input-group">
                        <label>ルームID</label>
                        <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="ルームIDを入力" />
                    </div>
                    <div className="input-group" style={{ marginTop: '1rem' }}>
                        <label>名前</label>
                        <input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="名前を入力" />
                    </div>
                    {errorMsg && <div className="error-msg">{errorMsg}</div>}
                    <button onClick={handleJoin} className="join-btn neon-btn" style={{ marginTop: '2rem' }}>参戦する</button>
                    <button onClick={onBack} className="back-link" style={{ marginTop: '1rem', width: '100%', textAlign: 'center' }}>メニューに戻る</button>
                </div>
            </div>
        );
    }

    const oppColor = myColor === 'black' ? 'white' : 'black';

    return (
        <div className="game-container puzzle-mode" style={{
            touchAction: 'none', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
            backgroundColor: 'var(--bg-color)',
            paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 'max(env(safe-area-inset-bottom), 0px)'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 15px', height: '40px', flexShrink: 0, width: '100%', boxSizing: 'border-box' }}>
                <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '8px', padding: '6px 15px', color: '#fff', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer' }}>退出</button>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-color)', fontWeight: 'bold', letterSpacing: '1px' }}>⚔️ ATTACK MODE</div>
                <button onClick={() => setIsMuted(p => !p)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', cursor: 'pointer' }}>{isMuted ? '🔇' : '🔊'}</button>
            </div>

            {/* Scoreboard */}
            <div className="scoreboard glass-panel puzzle-header-layout" style={{ margin: '5px 15px', flexShrink: 0, position: 'relative', zIndex: 10 }}>
                <div className="score-box left-align">
                    <span className="label" style={{ color: myPlayerColor }}>YOU</span>
                    <span className="puzzle-score">{scores[myColor as 'black' | 'white'] || 0}</span>
                </div>
                <div className="combo-center-area">
                    {status === 'WAITING' ? (
                        <span className="neon-text" style={{ fontSize: '0.8rem' }}>対戦相手を待っています...</span>
                    ) : (
                        <span className="neon-text" style={{ fontSize: '0.85rem' }}>同時プレイ中</span>
                    )}
                </div>
                <div className="score-box right-align">
                    <div style={{ textAlign: 'right' }}>
                        <span className="label" style={{ color: getCellColor(oppColor) }}>OPPONENT</span>
                        <div className="puzzle-score">{scores[oppColor as 'black' | 'white'] || 0}</div>
                    </div>
                </div>
            </div>

            {/* Garbage Alert */}
            {garbageAlert > 0 && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 1000, fontSize: '2rem', fontWeight: 900, color: '#ff4444',
                    textShadow: '0 0 20px rgba(255,0,0,0.8)', animation: 'popupBounce 0.8s forwards',
                    pointerEvents: 'none', textAlign: 'center'
                }}>
                    💥 お邪魔岩 x{garbageAlert}
                </div>
            )}

            {/* Boards area */}
            <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '5px 10px', boxSizing: 'border-box' }}>
                {renderMiniBoard(myBoard, '🟦 自分', true)}
                {renderMiniBoard(opponentBoard, '🟥 相手', false)}
            </div>

            {/* Hand */}
            <div className="hand-container glass-panel" style={{ flexGrow: 0, flexShrink: 0, height: 'auto', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 'auto 15px 0px', padding: '10px' }}>
                {myHand.map((shape, idx) => {
                    const isDragging = dragState?.shapeIdx === idx;
                    return (
                        <div key={idx} className={`shape-item ${!shape ? 'used' : ''} ${isDragging ? 'invisible' : ''}`}
                            onPointerDown={e => handlePointerDown(e, idx)} onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
                            {shape && (
                                <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell" style={{
                                            backgroundColor: val ? myPlayerColor : 'transparent',
                                            border: val ? '1px solid rgba(255,255,255,0.2)' : 'none', width: '20px', height: '20px'
                                        }} />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Drag Preview */}
            {dragState && myHand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${myHand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`, width: `${myHand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px` }}>
                        {myHand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? myPlayerColor : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`,
                                border: val ? '1px solid rgba(255,255,255,0.2)' : 'none'
                            }} />
                        )))}
                    </div>
                </div>
            )}

            {/* Result */}
            {(status === 'FINISHED' || status === 'ABORTED') && (
                <div className="result-overlay">
                    <div className={`result-card ${winner === myColor ? 'win' : 'lose'}`}>
                        <h2 className="result-title neon-text">
                            {status === 'ABORTED' ? '中断' : (winner === myColor ? '🎉 勝利！' : (winner === 'draw' ? '引き分け' : '😢 敗北...'))}
                        </h2>
                        <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>
                            {winReason === 'no_moves' ? (winner === myColor ? '相手が置けなくなった！' : '置ける場所がなくなった...')
                            : winReason === 'opponent_blocked' ? (winner === myColor ? 'お邪魔岩で相手を封じた！' : 'お邪魔岩に封じられた...')
                            : winReason === 'both_stuck' ? '両者とも置けなくなった' : errorMsg}
                        </p>
                        <div style={{ fontSize: '1.5rem', margin: '1rem 0' }}>{scores.black} - {scores.white}</div>
                        <button onClick={onBack} className="rematch-btn neon-btn">メニューに戻る</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BlockPuzzleAttack;
