'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { getSessionIdentity, type Identity } from '@/lib/identity'
import { loadContacts, type Contact } from '@/lib/storage'
import { importPrivateKey, deriveSharedSecret } from '@/lib/keys'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'
import { newGame, applyMove, getLegalMoves, PIECE_SYMBOLS, posToAlg, type GameState, type Pos, type Move, type Color, type ChessMessage } from '@/lib/chess'
import { ChessNostr } from '@/lib/chess-nostr'

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
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [pendingPromotion, setPendingPromotion] = useState<Move | null>(null)
  const [incomingChallenge, setIncomingChallenge] = useState<{ from: Contact; gameId: string; secret: Uint8Array } | null>(null)
  const [drawOffer, setDrawOffer] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const chessNostrs = useRef<Map<string, ChessNostr>>(new Map())
  const activeChessNostr = useRef<ChessNostr | null>(null)
  const sharedSecretRef = useRef<Uint8Array | null>(null)
  const gameStateRef = useRef<GameState | null>(null)
  const myColorRef = useRef<Color>('w')
  const gameIdRef = useRef('')

  useEffect(() => {
    if (!identity) return
    const cs = loadContacts(identity.publicKey)
    setContacts(cs)
    // Auto-connect to all contacts to listen for incoming challenges
    cs.forEach(async (contact) => {
      try {
        const privKey = await importPrivateKey(identity.privateKeyRaw)
        const secret = await deriveSharedSecret(privKey, contact.publicKey)
        const instance = new ChessNostr()
        await instance.connect(identity.publicKey, contact.publicKey, secret, (msg) => {
          handleMsgRef.current(msg, contact, secret)
        })
        chessNostrs.current.set(contact.publicKey, instance)
      } catch {}
    })
    return () => {
      chessNostrs.current.forEach(i => i.disconnect())
      chessNostrs.current.clear()
    }
  }, [identity])

  const addLog = (msg: string) => setLog(prev => [msg, ...prev].slice(0, 20))
  const handleMsgRef = useRef<(msg: ChessMessage, contact: Contact, secret: Uint8Array) => void>(() => {})

  const handleMsg = useCallback((msg: ChessMessage, fromContact?: Contact, secret?: Uint8Array) => {
    if (msg.gameId !== gameIdRef.current) {
      if (msg.type === 'challenge' && fromContact) {
        setIncomingChallenge({ from: fromContact, gameId: msg.gameId, secret: secret! })
      }
      return
    }
    if (msg.type === 'accept') {
      const gs = newGame()
      setGameState(gs); gameStateRef.current = gs
      setScreen('game')
      addLog('Challenge accepted. Game started!')
    }
    if (msg.type === 'decline') {
      setScreen('lobby'); addLog('Challenge declined.')
    }
    if (msg.type === 'move' && msg.move) {
      const gs = gameStateRef.current
      if (!gs) return
      const next = applyMove(gs, msg.move)
      setGameState(next); gameStateRef.current = next
      addLog(`${msg.move ? posToAlg(msg.move.from) + '→' + posToAlg(msg.move.to) : ''}`)
      if (next.status === 'checkmate') addLog(`Checkmate! ${next.winner === 'w' ? 'White' : 'Black'} wins.`)
      if (next.status === 'stalemate') addLog('Stalemate — draw.')
      if (next.status === 'check') addLog('Check!')
    }
    if (msg.type === 'resign') {
      setGameState(prev => prev ? { ...prev, status: 'resigned', winner: myColorRef.current } : prev)
      addLog('Opponent resigned. You win!')
    }
    if (msg.type === 'draw_offer') { setDrawOffer(true); addLog('Opponent offers a draw.') }
    if (msg.type === 'draw_accept') {
      setGameState(prev => prev ? { ...prev, status: 'draw' } : prev)
      addLog('Draw agreed.')
    }
    if (msg.type === 'draw_decline') { setDrawOffer(false); addLog('Draw declined.') }
  }, [identity])

  // Keep ref in sync so auto-connect closures always call latest version
  handleMsgRef.current = (msg, contact, secret) => handleMsg(msg, contact, secret)

  const connectToContact = async (contact: Contact) => {
    if (!identity) return
    const privKey = await importPrivateKey(identity.privateKeyRaw)
    const secret = await deriveSharedSecret(privKey, contact.publicKey)
    setSharedSecret(secret); sharedSecretRef.current = secret
    setOpponent(contact)
  }

  const handleChallenge = async (contact: Contact) => {
    await connectToContact(contact)
    const id = `${identity!.publicKey}:${contact.publicKey}:${Date.now()}`
    setGameId(id); gameIdRef.current = id
    const color: Color = 'w'
    setMyColor(color); myColorRef.current = color
    setScreen('waiting')
    addLog(`Challenging ${contact.name}...`)
    const instance = chessNostrs.current.get(contact.publicKey)
    activeChessNostr.current = instance || null
    const msg: ChessMessage = { type: 'challenge', gameId: id, color }
    if (instance) await instance.send(msg, sharedSecretRef.current!)
  }

  const handleAccept = async () => {
    if (!incomingChallenge || !identity) return
    const id = incomingChallenge.gameId
    const secret = incomingChallenge.secret
    const contact = incomingChallenge.from
    setGameId(id); gameIdRef.current = id
    setSharedSecret(secret); sharedSecretRef.current = secret
    const color: Color = 'b'
    setMyColor(color); myColorRef.current = color
    setOpponent(contact)
    setIncomingChallenge(null)
    const gs = newGame()
    setGameState(gs); gameStateRef.current = gs
    setScreen('game')
    // Use existing connection for this contact
    const instance = chessNostrs.current.get(contact.publicKey)
    activeChessNostr.current = instance || null
    const msg: ChessMessage = { type: 'accept', gameId: id }
    if (instance) await instance.send(msg, secret)
    addLog('Game started! You play Black.')
  }

  const handleDecline = async () => {
    if (!incomingChallenge) return
    const instance = chessNostrs.current.get(incomingChallenge.from.publicKey)
    if (instance) await instance.send({ type: 'decline', gameId: incomingChallenge.gameId }, incomingChallenge.secret)
    setIncomingChallenge(null)
  }

  const handleSquareClick = async (r: number, c: number) => {
    const gs = gameState
    if (!gs || gs.turn !== myColor || gs.status === 'checkmate' || gs.status === 'resigned' || gs.status === 'stalemate' || gs.status === 'draw') return
    const pos: Pos = { r, c }
    const piece = gs.board[r][c]

    if (selected) {
      const isLegal = legalMoves.some(m => m.r === r && m.c === c)
      if (isLegal) {
        const move: Move = { from: selected, to: pos }
        // Check promotion
        const movingPiece = gs.board[selected.r][selected.c]
        if (movingPiece?.type === 'P' && (r === 0 || r === 7)) {
          setPendingPromotion(move); setSelected(null); setLegalMoves([]); return
        }
        await sendMove(move, gs)
        setSelected(null); setLegalMoves([])
        return
      }
      if (piece?.color === myColor) {
        setSelected(pos)
        setLegalMoves(getLegalMoves(gs, pos))
        return
      }
      setSelected(null); setLegalMoves([])
      return
    }
    if (piece?.color === myColor) {
      setSelected(pos)
      setLegalMoves(getLegalMoves(gs, pos))
    }
  }

  const sendMove = async (move: Move, gs: GameState) => {
    const next = applyMove(gs, move)
    setGameState(next); gameStateRef.current = next
    const msg: ChessMessage = { type: 'move', gameId: gameIdRef.current, move }
    await activeChessNostr.current?.send(msg, sharedSecretRef.current!)
    addLog(`${posToAlg(move.from)}→${posToAlg(move.to)}`)
    if (next.status === 'checkmate') addLog(`Checkmate! You win.`)
    if (next.status === 'stalemate') addLog('Stalemate — draw.')
    if (next.status === 'check') addLog('Check!')
  }

  const handlePromotion = async (piece: 'Q' | 'R' | 'B' | 'N') => {
    if (!pendingPromotion || !gameState) return
    const move: Move = { ...pendingPromotion, promotion: piece }
    await sendMove(move, gameState)
    setPendingPromotion(null)
  }

  const handleResign = async () => {
    if (!gameState || !sharedSecret) return
    const msg: ChessMessage = { type: 'resign', gameId: gameIdRef.current }
    await activeChessNostr.current?.send(msg, sharedSecret)
    setGameState(prev => prev ? { ...prev, status: 'resigned', winner: myColor === 'w' ? 'b' : 'w' } : prev)
    addLog('You resigned.')
  }

  const handleDrawOffer = async () => {
    if (!sharedSecret) return
    const msg: ChessMessage = { type: 'draw_offer', gameId: gameIdRef.current }
    await activeChessNostr.current?.send(msg, sharedSecret)
    addLog('Draw offered.')
  }

  const handleDrawAccept = async () => {
    if (!sharedSecret) return
    const msg: ChessMessage = { type: 'draw_accept', gameId: gameIdRef.current }
    await activeChessNostr.current?.send(msg, sharedSecret)
    setGameState(prev => prev ? { ...prev, status: 'draw' } : prev)
    setDrawOffer(false)
    addLog('Draw accepted.')
  }

  if (!identity) return <IdentityGate backHref="/app" title="wspr / chess" onIdentityReady={id => { setIdentity(id); setContacts(loadContacts(id.publicKey)) }} />

  const isMyTurn = gameState?.turn === myColor
  const gameOver = gameState && ['checkmate','stalemate','draw','resigned'].includes(gameState.status)

  // Board rendering
  const renderBoard = () => {
    if (!gameState) return null
    const rows = flipped ? [0,1,2,3,4,5,6,7] : [0,1,2,3,4,5,6,7]
    const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7]
    const rankLabels = flipped ? RANKS.slice().reverse() : RANKS
    const fileLabels = flipped ? FILES.slice().reverse() : FILES

    return (
      <div style={{ display: 'inline-block', border: '1px solid var(--border)' }}>
        {rows.map((r, ri) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-5)', fontSize: '10px', width: '14px', textAlign: 'center', flexShrink: 0 }}>{rankLabels[ri]}</span>
            {cols.map((c, ci) => {
              const piece = gameState.board[r][c]
              const isLight = (r + c) % 2 === 0
              const isSelected = selected?.r === r && selected?.c === c
              const isLegal = legalMoves.some(m => m.r === r && m.c === c)
              const isLastMove = false
              const symbol = piece ? PIECE_SYMBOLS[piece.color + piece.type] : ''
              const bg = isSelected
                ? 'var(--bg-3)'
                : isLight ? 'var(--bg-2)' : 'var(--bg)'
              return (
                <div key={c} onClick={() => handleSquareClick(r, c)}
                  style={{
                    width: 48, height: 48,
                    background: bg,
                    border: isSelected ? '2px solid var(--text-2)' : '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: isMyTurn && !gameOver ? 'pointer' : 'default',
                    position: 'relative',
                    fontSize: '28px',
                    userSelect: 'none',
                  }}>
                  {isLegal && (
                    <div style={{
                      position: 'absolute',
                      width: piece ? '100%' : '30%',
                      height: piece ? '100%' : '30%',
                      borderRadius: piece ? 0 : '50%',
                      background: piece ? 'rgba(100,200,100,0.3)' : 'rgba(100,200,100,0.5)',
                      border: piece ? '3px solid rgba(100,200,100,0.6)' : 'none',
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
            <span key={f} style={{ color: 'var(--text-5)', fontSize: '10px', width: '48px', textAlign: 'center' }}>{f}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr / chess</span>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href="/app" style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8 max-w-3xl mx-auto w-full gap-6">

        {/* Incoming challenge */}
        {incomingChallenge && (
          <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)', width: '100%' }} className="p-4 flex items-center justify-between gap-4">
            <p style={{ color: 'var(--text-2)' }} className="text-xs">
              ♟ <strong>{incomingChallenge.from.name}</strong> challenges you to chess
            </p>
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
              Challenge a contact to encrypted chess over Nostr. Moves are encrypted with your shared secret — nobody else can see the game.
            </p>
            {contacts.length === 0 && (
              <p style={{ color: 'var(--text-5)' }} className="text-xs text-center mt-8">No contacts yet. Add contacts in chat first.</p>
            )}
            {contacts.map(contact => (
              <div key={contact.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-4 flex items-center justify-between">
                <div>
                  <p style={{ color: 'var(--text-2)' }} className="text-xs">{contact.name}</p>
                  <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">{contact.publicKey.slice(0,24)}...</p>
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
            <div style={{ color: 'var(--text-5)', fontSize: '32px' }}>♟</div>
            <p style={{ color: 'var(--text-5)' }} className="text-xs">Challenge sent. Waiting for them to accept.</p>
            <button onClick={() => setScreen('lobby')} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">Cancel</button>
          </div>
        )}

        {/* GAME */}
        {screen === 'game' && gameState && (
          <div className="w-full flex flex-col gap-4">
            {/* Game info bar */}
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <span style={{ color: 'var(--text-4)' }} className="text-xs">vs {opponent?.name}</span>
                <span style={{ color: 'var(--text-5)' }} className="text-xs">You: {myColor === 'w' ? '♔ White' : '♚ Black'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span style={{
                  color: gameOver ? 'var(--text-5)' : isMyTurn ? 'var(--text-2)' : 'var(--text-5)',
                  fontSize: '10px', border: '1px solid var(--border)', padding: '2px 8px'
                }}>
                  {gameOver
                    ? gameState.status === 'checkmate' ? `Checkmate — ${gameState.winner === myColor ? 'You win!' : 'You lose'}`
                    : gameState.status === 'resigned' ? (gameState.winner === myColor ? 'You win!' : 'You lose')
                    : gameState.status === 'stalemate' ? 'Stalemate'
                    : 'Draw'
                    : gameState.status === 'check' ? '⚠ Check!'
                    : isMyTurn ? 'Your turn' : "Opponent's turn"}
                </span>
                <button onClick={() => setFlipped(f => !f)} style={{ border: '1px solid var(--border)', color: 'var(--text-5)', background: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px 6px' }}>⇅</button>
              </div>
            </div>

            {/* Board */}
            <div className="flex justify-center overflow-x-auto">
              {renderBoard()}
            </div>

            {/* Promotion picker */}
            {pendingPromotion && (
              <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)' }} className="p-4 flex flex-col items-center gap-3">
                <p style={{ color: 'var(--text-3)' }} className="text-xs uppercase tracking-widest">Promote pawn</p>
                <div className="flex gap-4">
                  {(['Q','R','B','N'] as const).map(p => (
                    <button key={p} onClick={() => handlePromotion(p)}
                      style={{ border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: '28px', padding: '8px' }}>
                      {PIECE_SYMBOLS[myColor + p]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Draw offer */}
            {drawOffer && (
              <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)' }} className="p-3 flex items-center justify-between">
                <p style={{ color: 'var(--text-3)' }} className="text-xs">Opponent offers a draw</p>
                <div className="flex gap-2">
                  <button onClick={handleDrawAccept} style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }} className="px-3 py-1 text-xs">Accept</button>
                  <button onClick={async () => { setDrawOffer(false); await activeChessNostr.current?.send({ type: 'draw_decline', gameId: gameIdRef.current }, sharedSecretRef.current!) }} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-3 py-1 text-xs">Decline</button>
                </div>
              </div>
            )}

            {/* Controls */}
            {!gameOver && (
              <div className="flex gap-2 justify-center">
                <button onClick={handleDrawOffer} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">½ Draw</button>
                <button onClick={handleResign} style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }} className="px-4 py-2 text-xs uppercase hover:opacity-80">✕ Resign</button>
              </div>
            )}
            {gameOver && (
              <button onClick={() => { setScreen('lobby'); setGameState(null); setSelected(null); setLegalMoves([]) }}
                style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
                className="w-full py-3 text-xs uppercase tracking-widest">
                New Game
              </button>
            )}

            {/* Move log */}
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
