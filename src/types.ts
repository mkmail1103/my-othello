export type PlayerColor = 'black' | 'white';
export type CellState = PlayerColor | null;
export type BoardState = CellState[][];

export type ThemeType = 'neon' | 'pastel' | 'misty' | 'muted-blue' | 'muted-purple';

export interface Player {
    id: string;
    color: PlayerColor;
}

export interface GameState {
    board: BoardState;
    turn: PlayerColor;
    players: Player[];
    status: 'waiting' | 'playing' | 'finished' | 'aborted';
    winner?: PlayerColor | 'draw';
    scores?: { black: number; white: number };
}
