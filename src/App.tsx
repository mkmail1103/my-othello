import React, { useState, useEffect } from 'react';
import './App.css';
import type { ThemeType } from './types.js';
import OthelloGame from './components/OthelloGame.js';
import BlockPuzzleGame from './components/BlockPuzzleGame.js';
import BlockPuzzleOnline from './components/BlockPuzzleOnline.js';

enum GameMode {
    MENU = 'MENU',
    OTHELLO = 'OTHELLO',
    BLOCK_PUZZLE = 'BLOCK_PUZZLE',
    BLOCK_PUZZLE_ONLINE = 'BLOCK_PUZZLE_ONLINE'
}

const App: React.FC = () => {
    const [gameMode, setGameMode] = useState<GameMode>(GameMode.MENU);
    const [theme, setTheme] = useState<ThemeType>('muted-blue');

    // Apply theme to body
    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    // Update theme order: muted-blue, muted-purple, misty, pastel, neon
    const themes: ThemeType[] = ['muted-blue', 'muted-purple', 'misty', 'pastel', 'neon'];

    const getThemeGradient = (t: ThemeType) => {
        switch (t) {
            case 'neon': return 'linear-gradient(135deg, #000000, #10b981)';
            case 'pastel': return 'linear-gradient(135deg, #fff0f5, #f472b6)';
            case 'misty': return 'linear-gradient(135deg, #e0e1dd, #778da9)';
            case 'muted-blue': return 'linear-gradient(135deg, #d1d9e6, #5F9EA0)';
            case 'muted-purple': return 'linear-gradient(135deg, #e6e1e8, #9370DB)';
        }
        return '#fff';
    };

    if (gameMode === GameMode.MENU) {
        return (
            <div className="lobby-container">
                <div className="theme-selector-container glass-panel">
                    <span className="theme-label">THEME</span>
                    <div className="theme-options">
                        {themes.map(t => (
                            <button
                                key={t}
                                className={`theme-swatch ${theme === t ? 'active' : ''}`}
                                style={{ background: getThemeGradient(t) }}
                                onClick={() => setTheme(t)}
                                aria-label={`Select ${t} theme`}
                            />
                        ))}
                    </div>
                </div>

                <div className="lobby-card menu-card">
                    <h1 className="title neon-text">Game Menu</h1>
                    <div className="menu-buttons">
                        <button onClick={() => setGameMode(GameMode.OTHELLO)} className="menu-btn othello-btn glass-panel">
                            <span className="icon">⚫⚪</span>
                            <div className="text">
                                <span className="main neon-text-white">Online Othello</span>
                                <span className="sub">PVP Strategy</span>
                            </div>
                        </button>
                        <button onClick={() => setGameMode(GameMode.BLOCK_PUZZLE)} className="menu-btn puzzle-btn glass-panel">
                            <span className="icon">🧩</span>
                            <div className="text">
                                <span className="main neon-text-white">Block Puzzle (Solo)</span>
                                <span className="sub">Relaxing</span>
                            </div>
                        </button>
                        <button onClick={() => setGameMode(GameMode.BLOCK_PUZZLE_ONLINE)} className="menu-btn puzzle-btn glass-panel" style={{ borderLeftColor: '#f472b6' }}>
                            <span className="icon">⚔️</span>
                            <div className="text">
                                <span className="main neon-text-white">Block Puzzle (PvP)</span>
                                <span className="sub">Online Battle</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (gameMode === GameMode.OTHELLO) {
        return <OthelloGame onBack={() => setGameMode(GameMode.MENU)} />;
    }

    if (gameMode === GameMode.BLOCK_PUZZLE) {
        return <BlockPuzzleGame onBack={() => setGameMode(GameMode.MENU)} theme={theme} />;
    }

    if (gameMode === GameMode.BLOCK_PUZZLE_ONLINE) {
        return <BlockPuzzleOnline onBack={() => setGameMode(GameMode.MENU)} theme={theme} />;
    }

    return null;
};

export default App;
