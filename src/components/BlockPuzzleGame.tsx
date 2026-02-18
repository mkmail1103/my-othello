import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ThemeType } from '../types';
import { THEME_PALETTES, PUZZLE_SHAPES, BASE_SCORES, type ShapeDef, type ColorKey } from '../constants';
import './BlockPuzzleGame.css';

const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;

// 振動の長さ（ミリ秒）。
// 数値を変えることで調整可能。小さくすると弱く（短く）感じ、大きくすると強く（長く）感じる。
const HAPTIC_DURATION = 15;

const canPlace = (currentGrid: (string | null)[][], matrix: number[][], r: number, c: number) => {
    const rows = matrix.length;
    const cols = matrix[0].length;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] === 1) {
                const nr = r + i;
                const nc = c + j;
                if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) return false;
                if (currentGrid[nr][nc] !== null) return false;
            }
        }
    }
    return true;
};

const getPotentialClears = (grid: (string | null)[][], matrix: number[][], r: number, c: number, color: string) => {
    const tempGrid = grid.map(row => [...row]);
    const rows = matrix.length;
    const cols = matrix[0].length;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] === 1) tempGrid[r + i][c + j] = color;
        }
    }
    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];
    for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
    for (let cc = 0; cc < 8; cc++) {
        let full = true;
        for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr][cc] === null) { full = false; break; } }
        if (full) colsToClear.push(cc);
    }
    return { rows: rowsToClear, cols: colsToClear };
};

const getSmartShapes = (grid: (string | null)[][], count: number) => {
    let filledCount = 0;
    grid.forEach(r => r.forEach(c => { if (c) filledCount++; }));
    const density = filledCount / 64;
    const isCleanSlate = density === 0 || density < 0.1; // Empty or near empty

    const shapes = [];
    for (let i = 0; i < count; i++) {
        let pool = PUZZLE_SHAPES;

        // --- GOD MODE / EARLY GAME LOGIC ---
        if (isCleanSlate) {
            const roll = Math.random();
            if (roll < 0.8) {
                pool = PUZZLE_SHAPES.filter(s => s.category === 'easy');
            } else {
                pool = PUZZLE_SHAPES.filter(s => s.category === 'medium');
            }
        }
        // --- NORMAL PLAY LOGIC ---
        else if (density > 0.6) {
            pool = PUZZLE_SHAPES.filter(s => s.difficulty <= 2);
        } else {
            const roll = Math.random();
            if (roll < 0.4) pool = PUZZLE_SHAPES.filter(s => s.category === 'easy');
            else if (roll < 0.8) pool = PUZZLE_SHAPES.filter(s => s.category === 'medium');
            else pool = PUZZLE_SHAPES.filter(s => s.category === 'hard' || s.category === 'complex');
        }

        if (pool.length === 0) pool = PUZZLE_SHAPES;

        const rand = pool[Math.floor(Math.random() * pool.length)];
        shapes.push(rand);
    }
    return shapes;
};

const BlockPuzzleGame: React.FC<{ onBack: () => void; theme: ThemeType }> = ({ onBack, theme }) => {
    const [grid, setGrid] = useState<(string | null)[][]>(Array(8).fill(null).map(() => Array(8).fill(null)));
    const [clearingCells, setClearingCells] = useState<string[]>([]);
    const [hand, setHand] = useState<(ShapeDef | null)[]>(() => getSmartShapes(Array(8).fill(Array(8).fill(null)), 3));
    const [score, setScore] = useState(0);
    const [combo, setCombo] = useState(0);
    const [movesSinceClear, setMovesSinceClear] = useState(0);
    const [comboText, setComboText] = useState<{ main: string, sub: string } | null>(null);
    // const [isShaking, setIsShaking] = useState(false); // Removed shaking state

    const [isMuted, setIsMuted] = useState(false);

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBuffersRef = useRef<{ [key: string]: AudioBuffer }>({});
    const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const [highlightLines, setHighlightLines] = useState<{ rows: number[], cols: number[] }>({ rows: [], cols: [] });
    const [floatingTexts, setFloatingTexts] = useState<{ id: number, x: number, y: number, text: string }[]>([]);
    const floatingTextId = useRef(0);

    const [dragState, setDragState] = useState<{
        shapeIdx: number; startX: number; startY: number; currentX: number; currentY: number;
        startPointerX: number; startPointerY: number; hoverRow: number | null; hoverCol: number | null; boardCellSize: number;
    } | null>(null);

    const boardRef = useRef<HTMLDivElement>(null);
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number, cellSize: number } | null>(null);

    const getThemeColor = (key: ColorKey) => THEME_PALETTES[theme][key];

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
        }

        const loadSound = async (name: string) => {
            if (!audioContextRef.current) return;
            try {
                const response = await fetch(`/sounds/${name}.mp3`);
                const arrayBuffer = await response.arrayBuffer();
                const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                audioBuffersRef.current[name] = decodedBuffer;
            } catch (error) {
                console.error(`Failed to load sound: ${name}`, error);
            }
        };

        ['pickup', 'place', 'clear', 'gameover', 'bgm'].forEach(name => loadSound(name));

        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const playSound = useCallback((type: 'pickup' | 'place' | 'clear' | 'gameover') => {
        if (isMuted || !audioContextRef.current || !audioBuffersRef.current[type]) return;
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffersRef.current[type];
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.5;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
    }, [isMuted]);

    // Haptic Feedback Helper
    const triggerHaptic = () => {
        if (navigator.vibrate) {
            navigator.vibrate(HAPTIC_DURATION);
        }
    };

    useEffect(() => {
        const startBGM = () => {
            if (isMuted || !audioContextRef.current || !audioBuffersRef.current['bgm']) return;
            if (bgmSourceRef.current) return;
            const ctx = audioContextRef.current;
            const source = ctx.createBufferSource();
            source.buffer = audioBuffersRef.current['bgm'];
            source.loop = true;
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0.3;
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            source.start(0);
            bgmSourceRef.current = source;
        };

        const stopBGM = () => {
            if (bgmSourceRef.current) {
                try { bgmSourceRef.current.stop(); } catch { /* ignore */ }
                bgmSourceRef.current = null;
            }
        };

        if (isMuted) {
            stopBGM();
        } else {
            const checkBuffer = setInterval(() => {
                if (audioBuffersRef.current['bgm']) {
                    startBGM();
                    clearInterval(checkBuffer);
                }
            }, 500);
            return () => { clearInterval(checkBuffer); stopBGM(); };
        }
    }, [isMuted]);

    const toggleMute = () => { setIsMuted(prev => !prev); };

    useEffect(() => {
        if (hand.length > 0 && hand.every(h => h === null) && clearingCells.length === 0) {
            const timer = setTimeout(() => {
                setHand(getSmartShapes(grid, 3));
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [hand, clearingCells.length, grid]);

    const isGameOver = useMemo(() => {
        if (hand.every(h => h === null)) return false;
        if (clearingCells.length > 0) return false;
        let canMove = false;
        for (const shape of hand) {
            if (!shape) continue;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (canPlace(grid, shape.matrix, r, c)) {
                        canMove = true;
                        break;
                    }
                }
                if (canMove) break;
            }
            if (canMove) break;
        }
        return !canMove;
    }, [hand, grid, clearingCells.length]);

    useEffect(() => {
        if (isGameOver) playSound('gameover');
    }, [isGameOver, playSound]);

    const addFloatingText = (x: number, y: number, text: string) => {
        const id = floatingTextId.current++;
        setFloatingTexts(prev => [...prev, { id, x, y, text }]);
        setTimeout(() => {
            setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
        }, 1000);
    };

    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
        if (isGameOver || hand[idx] === null) return;
        playSound('pickup');
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        let currentCellSize = 40;
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            currentCellSize = rect.width / 8;
            boardMetrics.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, cellSize: currentCellSize };
        }

        setDragState({
            shapeIdx: idx,
            startX: e.clientX, startY: e.clientY,
            startPointerX: e.clientX, startPointerY: e.clientY,
            currentX: e.clientX, currentY: e.clientY,
            hoverRow: null, hoverCol: null,
            boardCellSize: currentCellSize
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.preventDefault();
        const { shapeIdx, startX, startY, startPointerX, startPointerY } = dragState;
        const shape = hand[shapeIdx];

        const deltaX = (e.clientX - startPointerX) * DRAG_SENSITIVITY;
        const deltaY = (e.clientY - startPointerY) * DRAG_SENSITIVITY;
        const currentX = startX + deltaX;
        const currentY = startY + deltaY;

        let bestRow: number | null = null;
        let bestCol: number | null = null;
        let hRows: number[] = [];
        let hCols: number[] = [];

        if (shape && boardMetrics.current) {
            const { left, top, cellSize } = boardMetrics.current;
            const shapeWidthPx = shape.matrix[0].length * cellSize;
            const shapeHeightPx = shape.matrix.length * cellSize;
            const visualTopLeftX = currentX - (shapeWidthPx / 2);
            const visualTopLeftY = currentY - TOUCH_OFFSET_Y - (shapeHeightPx / 2);

            let minDistance = Infinity;
            const SNAP_THRESHOLD = cellSize * 2.5;

            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (canPlace(grid, shape.matrix, r, c)) {
                        const targetX = left + (c * cellSize);
                        const targetY = top + (r * cellSize);
                        const dist = Math.hypot(targetX - visualTopLeftX, targetY - visualTopLeftY);

                        if (dist < minDistance && dist < SNAP_THRESHOLD) {
                            minDistance = dist;
                            bestRow = r;
                            bestCol = c;
                        }
                    }
                }
            }

            if (bestRow !== null && bestCol !== null) {
                const color = getThemeColor(shape.colorKey);
                const clears = getPotentialClears(grid, shape.matrix, bestRow, bestCol, color);
                hRows = clears.rows;
                hCols = clears.cols;
            }
        }

        setHighlightLines({ rows: hRows, cols: hCols });
        setDragState(prev => prev ? { ...prev, currentX, currentY, hoverRow: bestRow, hoverCol: bestCol } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        const { shapeIdx, hoverRow, hoverCol, currentX, currentY } = dragState;
        const shape = hand[shapeIdx];

        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        setHighlightLines({ rows: [], cols: [] });

        if (shape && hoverRow !== null && hoverCol !== null) {
            if (canPlace(grid, shape.matrix, hoverRow, hoverCol)) {

                playSound('place');

                const color = getThemeColor(shape.colorKey);
                let placementScore = 0;
                shape.matrix.forEach(row => row.forEach(val => { if (val === 1) placementScore++; }));

                const newGrid = grid.map(row => [...row]);
                const rows = shape.matrix.length;
                const cols = shape.matrix[0].length;
                for (let i = 0; i < rows; i++) {
                    for (let j = 0; j < cols; j++) {
                        if (shape.matrix[i][j] === 1) {
                            newGrid[hoverRow + i][hoverCol + j] = color;
                        }
                    }
                }

                setScore(prev => prev + placementScore);

                const newHand = [...hand];
                newHand[shapeIdx] = null;
                setHand(newHand);
                setGrid(newGrid);

                checkLinesAndScore(newGrid, placementScore, currentX, currentY - TOUCH_OFFSET_Y);
            }
        }
        setDragState(null);
    };

    const ghostCells = useMemo(() => {
        if (!dragState || dragState.hoverRow === null || dragState.hoverCol === null) return [];
        const shape = hand[dragState.shapeIdx];
        if (!shape) return [];
        const { hoverRow, hoverCol } = dragState;
        if (canPlace(grid, shape.matrix, hoverRow, hoverCol)) {
            const cells = [];
            for (let i = 0; i < shape.matrix.length; i++) {
                for (let j = 0; j < shape.matrix[0].length; j++) {
                    if (shape.matrix[i][j] === 1) {
                        cells.push(`${hoverRow + i}-${hoverCol + j}`);
                    }
                }
            }
            return cells;
        }
        return [];
    }, [dragState, grid, hand]);

    const checkLinesAndScore = (currentGrid: (string | null)[][], initialPlacementScore: number, animX: number, animY: number) => {
        const rowsToClear: number[] = [];
        const colsToClear: number[] = [];
        for (let r = 0; r < 8; r++) { if (currentGrid[r].every(cell => cell !== null)) rowsToClear.push(r); }
        for (let c = 0; c < 8; c++) {
            let full = true;
            for (let r = 0; r < 8; r++) { if (currentGrid[r][c] === null) { full = false; break; } }
            if (full) colsToClear.push(c);
        }

        const totalLines = rowsToClear.length + colsToClear.length;
        let totalMoveScore = initialPlacementScore;

        if (totalLines > 0) {
            playSound('clear');
            triggerHaptic(); // Vibrate when clearing lines
            setMovesSinceClear(0);

            const addedCombo = totalLines;
            const newCombo = combo + addedCombo;
            setCombo(newCombo);

            const baseLineScore = BASE_SCORES[totalLines] || (totalLines * 50);
            const lineScore = baseLineScore * newCombo;
            totalMoveScore += lineScore;

            let isAllClear = true;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (currentGrid[r][c] !== null && !rowsToClear.includes(r) && !colsToClear.includes(c)) {
                        isAllClear = false;
                        break;
                    }
                }
                if (!isAllClear) break;
            }

            if (isAllClear) {
                totalMoveScore += 300;
                setTimeout(() => {
                    setComboText({ main: "ALL CLEAR!", sub: "+300 Points" });
                    setTimeout(() => setComboText(null), 2000);
                }, 500);
            }

            if (newCombo >= 2) {
                let mainText = "Good!";
                if (newCombo >= 5) mainText = "Great!";
                if (newCombo >= 10) mainText = "Unstoppable!";
                if (totalLines >= 3) mainText = "Incredible!";

                if (!isAllClear) {
                    setComboText({ main: mainText, sub: `Combo x${newCombo}` });
                    setTimeout(() => setComboText(null), 1500);
                }
            }

            // Removed setIsShaking(true);

            const cellsToAnim: string[] = [];
            rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) cellsToAnim.push(`${r}-${c}`); });
            colsToClear.forEach(c => { for (let r = 0; r < 8; r++) cellsToAnim.push(`${r}-${c}`); });
            setClearingCells(cellsToAnim);

            setTimeout(() => {
                setScore(prev => prev + lineScore + (isAllClear ? 300 : 0));
                const nextGrid = currentGrid.map(row => [...row]);
                rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) nextGrid[r][c] = null; });
                colsToClear.forEach(c => { for (let r = 0; r < 8; r++) nextGrid[r][c] = null; });
                setGrid(nextGrid);
                setClearingCells([]);
            }, 400);
        } else {
            const newMovesSinceClear = movesSinceClear + 1;
            setMovesSinceClear(newMovesSinceClear);

            const limit = combo >= 10 ? 3 : 2;

            if (newMovesSinceClear > limit) {
                if (combo > 0) {
                    setCombo(0);
                    // Removed Combo Lost text logic
                }
                setMovesSinceClear(0);
            }
        }

        addFloatingText(animX, animY, `+${totalMoveScore}`);
    };

    return (
        <div className="game-container puzzle-mode" style={{ touchAction: 'none' }}>
            {comboText && <div className="combo-popup"><div className="combo-text">{comboText.main}</div><div className="combo-sub">{comboText.sub}</div></div>}

            {floatingTexts.map(ft => (
                <div key={ft.id} className="floating-text" style={{ left: ft.x, top: ft.y }}>
                    {ft.text}
                </div>
            ))}

            {isGameOver && (
                <div className="result-overlay">
                    <div className="result-card lose">
                        <h1 className="result-title neon-text-red">GAME OVER</h1>
                        <div className="final-score"><div className="score-box"><span className="label">SCORE</span><span className="value">{score}</span></div></div>
                        <button onClick={() => window.location.reload()} className="rematch-btn neon-btn">Try Again</button>
                    </div>
                </div>
            )}

            <div className="scoreboard glass-panel puzzle-header-layout">
                <div className="score-box left-align">
                    <span className="label">SCORE</span>
                    <span className={`value puzzle-score ${combo > 0 ? 'combo-active' : ''}`}>{score}</span>
                </div>

                <div className="combo-center-area">
                    {combo > 0 ? (
                        <div className="combo-badge-container-static">
                            <div className="combo-badge animate-pulse" style={{ color: combo >= 10 ? '#ffd700' : 'var(--accent-color)' }}>
                                {combo}x COMBO
                            </div>
                            {combo >= 10 ? (
                                <div className="shield-indicator" title="Shield Active: Protects combo from 3 misses">
                                    🛡️ {3 - movesSinceClear} left
                                </div>
                            ) : (
                                <div className="shield-indicator-small" style={{ fontSize: '0.75rem', opacity: 0.9, color: movesSinceClear === 2 ? '#ff6b6b' : 'inherit' }}>
                                    {movesSinceClear === 0 ? "Safe" :
                                        movesSinceClear === 1 ? "⚠️ Careful" : "🔥 Last Chance"}
                                </div>
                            )}
                        </div>
                    ) : (
                        <span className="game-title-small">BLOCK PUZZLE</span>
                    )}
                </div>

                <div className="right-align">
                    <button onClick={toggleMute} className="sound-btn" aria-label="Toggle Sound">
                        {isMuted ? '🔇' : '🔊'}
                    </button>
                    <button onClick={onBack} className="leave-btn">Exit</button>
                </div>
            </div>

            <div className="board-wrapper glass-panel">
                <div className="board puzzle-board" ref={boardRef}>
                    {grid.map((row, r) => row.map((cell, c) => {
                        const cellKey = `${r}-${c}`;
                        const isGhost = ghostCells.includes(cellKey);
                        const isClearing = clearingCells.includes(cellKey);
                        const isHighlightRow = highlightLines.rows.includes(r);
                        const isHighlightCol = highlightLines.cols.includes(c);

                        return (
                            <div
                                key={cellKey}
                                className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''} ${isClearing ? 'clearing' : ''}`}
                                style={cell ? { backgroundColor: cell } : {}}
                            >
                                {isGhost && <div className="ghost-overlay" />}
                                {(isHighlightRow || isHighlightCol) && <div className="potential-clear-overlay" />}
                            </div>
                        );
                    }))}
                </div>
            </div>

            <div className="hand-container">
                {hand.map((shape, idx) => {
                    const isDragging = dragState?.shapeIdx === idx;
                    const color = shape ? getThemeColor(shape.colorKey) : 'transparent';
                    return (
                        <div
                            key={idx}
                            className={`shape-item ${shape === null ? 'used' : ''} ${isDragging ? 'invisible' : ''}`}
                            onPointerDown={(e) => handlePointerDown(e, idx)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        >
                            {shape && (
                                <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell" style={{
                                            backgroundColor: val ? color : 'transparent',
                                            border: val ? 'var(--cell-border)' : 'none'
                                        }} />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {dragState && hand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${hand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                        width: `${hand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px`,
                    }}>
                        {hand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? getThemeColor(hand[dragState.shapeIdx]!.colorKey) : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`,
                                border: val ? 'var(--cell-border)' : 'none'
                            }} />
                        )))}
                    </div>
                </div>
            )}
            <div className="instructions">Drag blocks to grid</div>
        </div>
    );
};

export default BlockPuzzleGame;