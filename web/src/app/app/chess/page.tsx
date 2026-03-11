'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { getSessionIdentity, type Identity } from '@/lib/identity'
import { loadContacts, type Contact } from '@/lib/storage'
import { ChessTransport } from '@/lib/chess-nostr'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'
import {
  newGame, applyMove, getLegalMoves, PIECE_SYMBOLS, posToAlg,
  type GameState, type Pos, type Move, type Color, type ChessMessage
} from '@/lib/chess'

type Screen = 'lobby' | 'waiting' | 'game'
const FILES = ['a','b','c','d','e','f','g','h']
const RANKS = ['8','7','6','5','4','3','2','1']

export default function ChessPage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [identity, setIdentity] = useState<Identity | null>(() => getSessionIdentity())
  const [contacts, setContacts] = useState<Contact[]>([])
  const [screen, setScreen] = useState<Screen>('lobby')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [myColor, setMyColor] = useState<Color>('w')
  const [opponent, setOpponent] = useState<Contact | null>(null)
  const [selected, setSelected] = useState<Pos | null>(null)
  const [legalMoves, setLegalMoves] = useState<Pos[]>([])
  const [gameId, setGameId] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [pendingPromotion, setPendingPromotion] = useState<Move | null>(null)
  const [incomingChallenge, setIncomingChallenge] = useState<{ from: Contact; gameId: string } | null>(null)
  const [drawOffer, setDrawOffer] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [status, setStatus] = useState('Connecting...')

  // One NostrChat per contact, keyed by pubkey
  const chats = useRef<Map<string, ChessTransport>>(new Map())
  const activeChat = useRef<NostrChat | null>(null)
  const gameStateRef = useRef<GameState | null>(null)
  const myColorRef = useRef<Color>('w')
  const gameIdRef = useRef('')
  const identityRef = useRef<Identity | null>(null)

  useEffect(() => { identityRef.current = identity }, [identity])

  const addLog = useCallback((msg: string) => setLog(prev => [msg, ...prev].slice(0, 30)), [])

  const handleChessMsg = useCallback((chess: ChessMessage, fromContact: Contact) => {
    console.log('[chess] msg from', fromContact.name, ':', chess.type, chess.gameId)
    if (chess.type === 'challenge') {
      setIncomingChallenge({ from: fromContact, gameId: chess.gameId })
      addLog(`♟ ${fromContact.name} challenges you!`)
      return
    }
    if (chess.gameId !== gameIdRef.current) return
    if (chess.type === 'accept') {
      const gs = newGame(); setGameState(gs); gameStateRef.current = gs; setScreen('game')
      addLog('Challenge accepted — game on!')
    }
    if (chess.type === 'decline') { setScreen('lobby'); addLog('Challenge declined.') }
    if (chess.type === 'move' && chess.move) {
      const gs = gameStateRef.current; if (!gs) return
      const next = applyMove(gs, chess.move)
      setGameState(next); gameStateRef.current = next
      addLog(`${posToAlg(chess.move.from)}→${posToAlg(chess.move.to)}`)
      if (next.status === 'checkmate') addLog(`☠ Checkmate — ${next.winner === myColorRef.current ? 'You win!' : 'You lose.'}`)
      else if (next.status === 'stalemate') addLog('½ Stalemate.')
      else if (next.status === 'check') addLog('⚠ Check!')
    }
    if (chess.type === 'resign') {
      setGameState(prev => prev ? { ...prev, status: 'resigned', winner: myColorRef.current } : prev)
      addLog('Opponent resigned. You win!')
    }
    if (chess.type === 'draw_offer') { setDrawOffer(true); addLog('½ Opponent offers draw.') }
    if (chess.type === 'draw_accept') { setGameState(prev => prev ? { ...prev, status: 'draw' } : prev); addLog('½ Draw agreed.') }
    if (chess.type === 'draw_decline') { setDrawOffer(false); addLog('Draw declined.') }
  }, [addLog])

  useEffect(() => {
    if (!identity) return
    const cs = loadContacts(identity.publicKey)
    setContacts(cs)
    if (cs.length === 0) { setStatus('No contacts'); return }
    let done = 0
    cs.forEach(async (contact) => {
      try {
        const transport = new ChessTransport()
        await transport.connect(identity.publicKey, contact.publicKey, (msg) => handleChessMsg(msg, contact))
        chats.current.set(contact.publicKey, transport)
        done++
        console.log('[chess] connected to', contact.name)
        if (done === cs.length) setStatus('Ready')
      } catch (e) { console.error('[chess] connect failed:', contact.name, e) }
    })
    return () => { chats.current.forEach(c => c.disconnect()); chats.current.clear() }
  }, [identity, handleChessMsg])

  const sendChess = useCallback(async (chess: ChessMessage, toPubKey: string) => {
    const transport = chats.current.get(toPubKey)
    if (!transport) { console.error('[chess] no transport for', toPubKey); return }
    await transport.send(chess)
  }, [])

  const handleChallenge = async (contact: Contact) => {
    const id = `${identity!.publicKey}:${contact.publicKey}:${Date.now()}`
    setGameId(id); gameIdRef.current = id
    setMyColor('w'); myColorRef.current = 'w'
    setOpponent(contact)
    activeChat.current = chats.current.get(contact.publicKey) || null
    setScreen('waiting')
    addLog(`Challenging ${contact.name}...`)
    await sendChess({ type: 'challenge', gameId: id }, contact.publicKey)
    addLog('Challenge sent!')
  }

  const handleAccept = async () => {
    if (!incomingChallenge) return
    const { from, gameId: id } = incomingChallenge
    setGameId(id); gameIdRef.current = id
    setMyColor('b'); myColorRef.current = 'b'
    setOpponent(from)
    activeChat.current = chats.current.get(from.publicKey) || null
    setIncomingChallenge(null)
    const gs = newGame()
    setGameState(gs); gameStateRef.current = gs
    setScreen('game')
    await sendChess({ type: 'accept', gameId: id }, from.publicKey)
    addLog('Game started! You play ♚ Black.')
  }

  const handleDecline = async () => {
    if (!incomingChallenge) return
    await sendChess({ type: 'decline', gameId: incomingChallenge.gameId }, incomingChallenge.from.publicKey)
    setIncomingChallenge(null)
  }

  const sendMove = useCallback(async (move: Move, gs: GameState) => {
    const next = applyMove(gs, move)
    setGameState(next); gameStateRef.current = next
    await sendChess({ type: 'move', gameId: gameIdRef.current, move }, opponent?.publicKey || '')
    addLog(`${posToAlg(move.from)}→${posToAlg(move.to)}`)
    if (next.status === 'checkmate') addLog(`☠ Checkmate — You win!`)
    else if (next.status === 'stalemate') addLog('½ Stalemate.')
    else if (next.status === 'check') addLog('⚠ Check!')
  }, [opponent, sendChess, addLog])

  const handleSquareClick = async (r: number, c: number) => {
    const gs = gameState
    if (!gs || gs.turn !== myColor) return
    if (['checkmate','resigned','stalemate','draw'].includes(gs.status)) return
    const pos: Pos = { r, c }
    const piece = gs.board[r][c]
    if (selected) {
      const isLegal = legalMoves.some(m => m.r === r && m.c === c)
      if (isLegal) {
        const move: Move = { from: selected, to: pos }
        if (gs.board[selected.r][selected.c]?.type === 'P' && (r === 0 || r === 7)) {
          setPendingPromotion(move); setSelected(null); setLegalMoves([]); return
        }
        await sendMove(move, gs)
        setSelected(null); setLegalMoves([])
        return
      }
      if (piece?.color === myColor) { setSelected(pos); setLegalMoves(getLegalMoves(gs, pos)); return }
      setSelected(null); setLegalMoves([])
      return
    }
    if (piece?.color === myColor) { setSelected(pos); setLegalMoves(getLegalMoves(gs, pos)) }
  }

  const handlePromotion = async (p: 'Q'|'R'|'B'|'N') => {
    if (!pendingPromotion || !gameState) return
    await sendMove({ ...pendingPromotion, promotion: p }, gameState)
    setPendingPromotion(null)
  }

  const handleResign = async () => {
    await sendChess({ type: 'resign', gameId: gameIdRef.current }, opponent?.publicKey || '')
    setGameState(prev => prev ? { ...prev, status: 'resigned', winner: myColor === 'w' ? 'b' : 'w' } : prev)
    addLog('You resigned.')
  }

  if (!identity) return (
    <IdentityGate backHref="/app" title="wspr / chess"
      onIdentityReady={id => { setIdentity(id); setContacts(loadContacts(id.publicKey)) }} />
  )

  const isMyTurn = gameState?.turn === myColor
  const gameOver = gameState && ['checkmate','stalemate','draw','resigned'].includes(gameState.status)

  const renderBoard = () => {
    if (!gameState) return null
    // White = rows 0-7 top to bottom (rank 8 at top), Black = flipped so rank 1 at top
    const baseFlip = myColor === 'b'
    const isFlipped = baseFlip !== flipped
    const rows = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7]
    const cols = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7]
    const rankLabels = isFlipped ? [...RANKS].reverse() : RANKS
    const fileLabels = isFlipped ? [...FILES].reverse() : FILES
    return (
      <div style={{ display: 'inline-block', border: '1px solid var(--border)' }}>
        {rows.map((r, ri) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-5)', fontSize: '10px', width: '14px', textAlign: 'center', flexShrink: 0 }}>{rankLabels[ri]}</span>
            {cols.map((c) => {
              const piece = gameState.board[r][c]
              const isLight = (r + c) % 2 === 0
              const isSel = selected?.r === r && selected?.c === c
              const isLegal = legalMoves.some(m => m.r === r && m.c === c)
              const symbol = piece ? PIECE_SYMBOLS[piece.color + piece.type] : ''
              return (
                <div key={c} onClick={() => handleSquareClick(r, c)} style={{
                  width: 46, height: 46,
                  background: isSel ? 'var(--bg-3)' : isLight ? 'var(--bg-2)' : 'var(--bg)',
                  border: isSel ? '2px solid var(--text-2)' : '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: isMyTurn && !gameOver ? 'pointer' : 'default',
                  position: 'relative', fontSize: '26px', userSelect: 'none',
                }}>
                  {isLegal && (
                    <div style={{
                      position: 'absolute',
                      width: piece ? '100%' : '28%', height: piece ? '100%' : '28%',
                      borderRadius: piece ? 0 : '50%',
                      background: piece ? 'rgba(80,180,80,0.25)' : 'rgba(80,180,80,0.55)',
                      border: piece ? '3px solid rgba(80,180,80,0.5)' : 'none',
                      pointerEvents: 'none',
                    }} />
                  )}
                  {symbol}
                </div>
              )
            })}
          </div>
        ))}
        <div style={{ display: 'flex', paddingLeft: '14px' }}>
          {fileLabels.map(f => (
            <span key={f} style={{ color: 'var(--text-5)', fontSize: '10px', width: '46px', textAlign: 'center' }}>{f}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr / chess</span>
        <div className="flex items-center gap-4">
          <span style={{ color: 'var(--text-5)', fontSize: '10px' }}>{status}</span>
          <button onClick={toggleTheme} style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>{theme === 'dark' ? '☀' : '☾'}</button>
          <Link href="/app" style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8 max-w-3xl mx-auto w-full gap-6">

        {/* Incoming challenge banner */}
        {incomingChallenge && (
          <div style={{ border: '1px solid var(--text-2)', background: 'var(--bg-2)', width: '100%' }} className="p-4 flex items-center justify-between gap-4">
            <p style={{ color: 'var(--text-2)' }} className="text-xs">♟ <strong>{incomingChallenge.from.name}</strong> challenges you to chess</p>
            <div className="flex gap-2">
              <button onClick={handleAccept} style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }} className="px-4 py-1 text-xs uppercase">Accept</button>
              <button onClick={handleDecline} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-1 text-xs uppercase">Decline</button>
            </div>
          </div>
        )}

        {/* LOBBY */}
        {screen === 'lobby' && (
          <div className="w-full flex flex-col gap-4">
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">
              Challenge a contact to encrypted chess over Nostr. Moves are end-to-end encrypted — no spectators.
            </p>
            {contacts.length === 0 && (
              <p style={{ color: 'var(--text-5)' }} className="text-xs text-center mt-8">No contacts yet. Add contacts in chat first.</p>
            )}
            {contacts.map(contact => (
              <div key={contact.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-4 flex items-center justify-between">
                <div>
                  <p style={{ color: 'var(--text-2)' }} className="text-xs">{contact.name}</p>
                  <p style={{ color: 'var(--text-5)', fontSize: '10px' }}>{contact.publicKey.slice(0,24)}...</p>
                </div>
                <button onClick={() => handleChallenge(contact)}
                  style={{ border: '1px solid var(--border-2)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
                  className="px-4 py-2 text-xs uppercase tracking-widest hover:opacity-80">
                  ♟ Challenge
                </button>
              </div>
            ))}
          </div>
        )}

        {/* WAITING */}
        {screen === 'waiting' && (
          <div className="w-full flex flex-col items-center gap-4 mt-8">
            <p style={{ color: 'var(--text-3)' }} className="text-xs uppercase tracking-widest">Waiting for {opponent?.name}...</p>
            <div style={{ color: 'var(--text-5)', fontSize: '40px', animation: 'pulse 2s infinite' }}>♟</div>
            <p style={{ color: 'var(--text-5)' }} className="text-xs">Challenge sent. Waiting for them to accept.</p>
            <button onClick={() => setScreen('lobby')} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">Cancel</button>
          </div>
        )}

        {/* GAME */}
        {screen === 'game' && gameState && (
          <div className="w-full flex flex-col gap-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <span style={{ color: 'var(--text-4)' }} className="text-xs">vs {opponent?.name}</span>
                <span style={{ color: 'var(--text-5)' }} className="text-xs">You: {myColor === 'w' ? '♔ White' : '♚ Black'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span style={{ color: gameOver ? 'var(--text-5)' : isMyTurn ? 'var(--text-2)' : 'var(--text-5)', fontSize: '10px', border: '1px solid var(--border)', padding: '2px 8px' }}>
                  {gameOver
                    ? gameState.status === 'checkmate' ? `☠ ${gameState.winner === myColor ? 'You win!' : 'You lose'}`
                    : gameState.status === 'resigned' ? (gameState.winner === myColor ? 'You win!' : 'You lose')
                    : gameState.status === 'stalemate' ? '½ Stalemate' : '½ Draw'
                    : gameState.status === 'check' ? '⚠ Check!'
                    : isMyTurn ? '▸ Your turn' : "Waiting..."}
                </span>
                <button onClick={() => setFlipped(f => !f)} style={{ border: '1px solid var(--border)', color: 'var(--text-5)', background: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px 6px' }}>⇅</button>
              </div>
            </div>

            <div className="flex justify-center overflow-x-auto">{renderBoard()}</div>

            {pendingPromotion && (
              <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)' }} className="p-4 flex flex-col items-center gap-3">
                <p style={{ color: 'var(--text-3)' }} className="text-xs uppercase tracking-widest">Promote pawn</p>
                <div className="flex gap-4">
                  {(['Q','R','B','N'] as const).map(p => (
                    <button key={p} onClick={() => handlePromotion(p)} style={{ border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: '28px', padding: '8px' }}>
                      {PIECE_SYMBOLS[myColor + p]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {drawOffer && (
              <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)' }} className="p-3 flex items-center justify-between">
                <p style={{ color: 'var(--text-3)' }} className="text-xs">½ Opponent offers a draw</p>
                <div className="flex gap-2">
                  <button onClick={async () => { await sendChess({ type: 'draw_accept', gameId: gameIdRef.current }, opponent?.publicKey||''); setGameState(prev => prev ? {...prev, status:'draw'} : prev); setDrawOffer(false); addLog('½ Draw accepted.') }} style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }} className="px-3 py-1 text-xs">Accept</button>
                  <button onClick={async () => { await sendChess({ type: 'draw_decline', gameId: gameIdRef.current }, opponent?.publicKey||''); setDrawOffer(false) }} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-3 py-1 text-xs">Decline</button>
                </div>
              </div>
            )}

            {!gameOver && (
              <div className="flex gap-2 justify-center">
                <button onClick={async () => { await sendChess({ type: 'draw_offer', gameId: gameIdRef.current }, opponent?.publicKey||''); addLog('½ Draw offered.') }} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">½ Draw</button>
                <button onClick={handleResign} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">✕ Resign</button>
              </div>
            )}
            {gameOver && (
              <button onClick={() => { setScreen('lobby'); setGameState(null); setSelected(null); setLegalMoves([]) }}
                style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
                className="w-full py-3 text-xs uppercase tracking-widest">New Game</button>
            )}

            {log.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)' }} className="pt-3 flex flex-col gap-1 max-h-32 overflow-y-auto">
                {log.map((l, i) => <p key={i} style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">{l}</p>)}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
