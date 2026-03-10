// Full chess engine — legal moves, check, checkmate, draw

export type Color = 'w' | 'b'
export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'
export type Piece = { type: PieceType; color: Color }
export type Square = Piece | null
export type Board = Square[][]  // [row][col], row 0 = rank 8
export type Pos = { r: number; c: number }

export type GameState = {
  board: Board
  turn: Color
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean }
  enPassant: Pos | null
  halfMoves: number
  fullMoves: number
  status: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw' | 'resigned'
  winner: Color | null
}

export type Move = {
  from: Pos
  to: Pos
  promotion?: PieceType
}

export type ChessMessage = {
  type: 'challenge' | 'accept' | 'decline' | 'move' | 'resign' | 'draw_offer' | 'draw_accept' | 'draw_decline'
  gameId: string
  move?: Move
  color?: Color // which color the sender is playing
}

const INIT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

export function initBoard(): Board {
  const board: Board = Array(8).fill(null).map(() => Array(8).fill(null))
  const rows = INIT_FEN.split('/')
  rows.forEach((row, r) => {
    let c = 0
    for (const ch of row) {
      if ('12345678'.includes(ch)) { c += parseInt(ch); continue }
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b'
      const type = ch.toUpperCase() as PieceType
      board[r][c] = { type, color }
      c++
    }
  })
  return board
}

export function newGame(): GameState {
  return {
    board: initBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfMoves: 0,
    fullMoves: 1,
    status: 'playing',
    winner: null,
  }
}

function inBounds(r: number, c: number) { return r >= 0 && r < 8 && c >= 0 && c < 8 }

function kingPos(board: Board, color: Color): Pos {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.type === 'K' && board[r][c]?.color === color) return { r, c }
  return { r: -1, c: -1 }
}

function isAttacked(board: Board, pos: Pos, byColor: Color): boolean {
  const { r, c } = pos
  const opp = byColor

  // Pawns
  const pd = opp === 'w' ? 1 : -1
  for (const dc of [-1, 1]) {
    const pr = r + pd; const pc = c + dc
    if (inBounds(pr, pc) && board[pr][pc]?.type === 'P' && board[pr][pc]?.color === opp) return true
  }
  // Knights
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = r+dr; const nc = c+dc
    if (inBounds(nr,nc) && board[nr][nc]?.type === 'N' && board[nr][nc]?.color === opp) return true
  }
  // King
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = r+dr; const nc = c+dc
    if (inBounds(nr,nc) && board[nr][nc]?.type === 'K' && board[nr][nc]?.color === opp) return true
  }
  // Rook/Queen (straight)
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let nr = r+dr; let nc = c+dc
    while (inBounds(nr,nc)) {
      if (board[nr][nc]) {
        if ((board[nr][nc]?.type === 'R' || board[nr][nc]?.type === 'Q') && board[nr][nc]?.color === opp) return true
        break
      }
      nr += dr; nc += dc
    }
  }
  // Bishop/Queen (diagonal)
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let nr = r+dr; let nc = c+dc
    while (inBounds(nr,nc)) {
      if (board[nr][nc]) {
        if ((board[nr][nc]?.type === 'B' || board[nr][nc]?.type === 'Q') && board[nr][nc]?.color === opp) return true
        break
      }
      nr += dr; nc += dc
    }
  }
  return false
}

function isInCheck(board: Board, color: Color): boolean {
  return isAttacked(board, kingPos(board, color), color === 'w' ? 'b' : 'w')
}

function applyMoveRaw(state: GameState, move: Move): GameState {
  const board = state.board.map(r => [...r])
  const { from, to } = move
  const piece = board[from.r][from.c]!
  const castling = { ...state.castling }
  let enPassant: Pos | null = null

  // En passant capture
  if (piece.type === 'P' && state.enPassant && to.r === state.enPassant.r && to.c === state.enPassant.c) {
    const capRow = piece.color === 'w' ? to.r + 1 : to.r - 1
    board[capRow][to.c] = null
  }

  // Castling move
  if (piece.type === 'K') {
    if (piece.color === 'w') { castling.wK = false; castling.wQ = false }
    else { castling.bK = false; castling.bQ = false }
    if (Math.abs(to.c - from.c) === 2) {
      if (to.c === 6) { board[from.r][5] = board[from.r][7]; board[from.r][7] = null }
      else { board[from.r][3] = board[from.r][0]; board[from.r][0] = null }
    }
  }
  if (piece.type === 'R') {
    if (from.r === 7 && from.c === 0) castling.wQ = false
    if (from.r === 7 && from.c === 7) castling.wK = false
    if (from.r === 0 && from.c === 0) castling.bQ = false
    if (from.r === 0 && from.c === 7) castling.bK = false
  }

  // En passant target
  if (piece.type === 'P' && Math.abs(to.r - from.r) === 2) {
    enPassant = { r: (from.r + to.r) / 2, c: from.c }
  }

  board[to.r][to.c] = move.promotion ? { type: move.promotion, color: piece.color } : piece
  board[from.r][from.c] = null

  const next = state.turn === 'w' ? 'b' : 'w'
  return { ...state, board, turn: next, castling, enPassant, halfMoves: state.halfMoves + 1, fullMoves: state.turn === 'b' ? state.fullMoves + 1 : state.fullMoves, status: 'playing', winner: null }
}

export function getLegalMoves(state: GameState, from: Pos): Pos[] {
  const piece = state.board[from.r][from.c]
  if (!piece || piece.color !== state.turn) return []
  const moves: Pos[] = []
  const { r, c } = from
  const board = state.board
  const color = piece.color
  const opp: Color = color === 'w' ? 'b' : 'w'

  const tryAdd = (tr: number, tc: number) => {
    if (!inBounds(tr, tc)) return false
    if (board[tr][tc]?.color === color) return false
    moves.push({ r: tr, c: tc })
    return board[tr][tc] === null
  }

  const slide = (dirs: [number,number][]) => {
    for (const [dr, dc] of dirs) {
      let nr = r+dr; let nc = c+dc
      while (inBounds(nr,nc)) {
        if (board[nr][nc]?.color === color) break
        moves.push({ r: nr, c: nc })
        if (board[nr][nc]) break
        nr += dr; nc += dc
      }
    }
  }

  if (piece.type === 'P') {
    const dir = color === 'w' ? -1 : 1
    const startRow = color === 'w' ? 6 : 1
    if (inBounds(r+dir,c) && !board[r+dir][c]) {
      moves.push({ r: r+dir, c })
      if (r === startRow && !board[r+2*dir][c]) moves.push({ r: r+2*dir, c })
    }
    for (const dc of [-1,1]) {
      if (!inBounds(r+dir,c+dc)) continue
      if (board[r+dir][c+dc]?.color === opp) moves.push({ r: r+dir, c: c+dc })
      if (state.enPassant?.r === r+dir && state.enPassant?.c === c+dc) moves.push({ r: r+dir, c: c+dc })
    }
  } else if (piece.type === 'N') {
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) tryAdd(r+dr,c+dc)
  } else if (piece.type === 'B') {
    slide([[-1,-1],[-1,1],[1,-1],[1,1]])
  } else if (piece.type === 'R') {
    slide([[-1,0],[1,0],[0,-1],[0,1]])
  } else if (piece.type === 'Q') {
    slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]])
  } else if (piece.type === 'K') {
    for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) tryAdd(r+dr,c+dc)
    // Castling
    if (color === 'w' && r === 7) {
      if (state.castling.wK && !board[7][5] && !board[7][6] && !isAttacked(board,{r:7,c:4},opp) && !isAttacked(board,{r:7,c:5},opp) && !isAttacked(board,{r:7,c:6},opp)) moves.push({r:7,c:6})
      if (state.castling.wQ && !board[7][3] && !board[7][2] && !board[7][1] && !isAttacked(board,{r:7,c:4},opp) && !isAttacked(board,{r:7,c:3},opp) && !isAttacked(board,{r:7,c:2},opp)) moves.push({r:7,c:2})
    }
    if (color === 'b' && r === 0) {
      if (state.castling.bK && !board[0][5] && !board[0][6] && !isAttacked(board,{r:0,c:4},opp) && !isAttacked(board,{r:0,c:5},opp) && !isAttacked(board,{r:0,c:6},opp)) moves.push({r:0,c:6})
      if (state.castling.bQ && !board[0][3] && !board[0][2] && !board[0][1] && !isAttacked(board,{r:0,c:4},opp) && !isAttacked(board,{r:0,c:3},opp) && !isAttacked(board,{r:0,c:2},opp)) moves.push({r:0,c:2})
    }
  }

  // Filter moves that leave king in check
  return moves.filter(to => {
    const next = applyMoveRaw(state, { from, to })
    return !isInCheck(next.board, color)
  })
}

export function applyMove(state: GameState, move: Move): GameState {
  const next = applyMoveRaw(state, move)
  // Check game status for the next player
  const allMoves = getAllLegalMoves(next)
  const inCheck = isInCheck(next.board, next.turn)
  if (allMoves.length === 0) {
    if (inCheck) return { ...next, status: 'checkmate', winner: state.turn }
    return { ...next, status: 'stalemate' }
  }
  if (inCheck) return { ...next, status: 'check' }
  return next
}

function getAllLegalMoves(state: GameState): Move[] {
  const moves: Move[] = []
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c]?.color === state.turn)
        getLegalMoves(state, { r, c }).forEach(to => moves.push({ from: { r, c }, to }))
  return moves
}

export const PIECE_SYMBOLS: Record<string, string> = {
  'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
  'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟',
}

export function posToAlg(pos: Pos): string {
  return String.fromCharCode(97 + pos.c) + (8 - pos.r)
}

export function algToPos(alg: string): Pos {
  return { r: 8 - parseInt(alg[1]), c: alg.charCodeAt(0) - 97 }
}
