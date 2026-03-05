'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { generateKeyPair, deriveSharedSecret, exportPrivateKey, importPrivateKey, generateSafetyNumber } from '@/lib/keys'
import { encryptMessage, decryptMessage, encryptFile, decryptFile } from '@/lib/chat-crypto'
import { NostrChat, NostrMessage } from '@/lib/nostr'
import {
  saveIdentity, loadIdentity,
  saveContact, loadContacts, deleteContact, updateContactLastSeen,
  saveChannelMessage, loadChannelMessages, clearChannelMessages,
  exportProfile, importProfile,
  type Contact, type StoredMessage
} from '@/lib/storage'
import Link from 'next/link'

type Screen = 'contacts' | 'chat' | 'settings'

const nostrClient = new NostrChat()

export default function ChatPage() {
  const [screen, setScreen] = useState<Screen>('contacts')

  // Identity
  const [myPublicKey, setMyPublicKey] = useState('')
  const [myPrivateKeyRaw, setMyPrivateKeyRaw] = useState('')
  const [hasIdentity, setHasIdentity] = useState(false)

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [newContactName, setNewContactName] = useState('')
  const [newContactKey, setNewContactKey] = useState('')
  const [activeContact, setActiveContact] = useState<Contact | null>(null)

  // Chat state
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | undefined>()
  const sharedSecretRef = useRef<Uint8Array | undefined>(undefined)
  const onMessageRef = useRef<((msg: NostrMessage) => void) | null>(null)
  const [safetyNumber, setSafetyNumber] = useState('')
  const [safetyVerified, setSafetyVerified] = useState(false)
  const [messages, setMessages] = useState<(StoredMessage & { plaintext?: string; imageUrl?: string })[]>([])
  const [input, setInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [networkStatus, setNetworkStatus] = useState<'offline' | 'connecting' | 'online'>('offline')
  const [showSidebar, setShowSidebar] = useState(false)
  const [log, setLog] = useState<string[]>([])

  // Settings
  const [showExport, setShowExport] = useState(false)
  const [importText, setImportText] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 20))
  }

  // Load identity and contacts on mount
  useEffect(() => {
    const identity = loadIdentity()
    if (identity) {
      setMyPublicKey(identity.publicKey)
      setMyPrivateKeyRaw(identity.privateKeyRaw)
      setHasIdentity(true)
    }
    setContacts(loadContacts())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleGenerateIdentity = async () => {
    const pair = await generateKeyPair()
    const privRaw = await exportPrivateKey(pair.privateKey)
    const identity = { publicKey: pair.publicKeyRaw, privateKeyRaw: privRaw, createdAt: Date.now() }
    saveIdentity(identity)
    setMyPublicKey(pair.publicKeyRaw)
    setMyPrivateKeyRaw(privRaw)
    setHasIdentity(true)
    addLog('Identity generated and saved.')
  }

  const handleAddContact = () => {
    if (!newContactName.trim() || !newContactKey.trim()) return
    const contact: Contact = {
      id: crypto.randomUUID(),
      name: newContactName.trim(),
      publicKey: newContactKey.trim(),
      addedAt: Date.now()
    }
    saveContact(contact)
    setContacts(loadContacts())
    setNewContactName('')
    setNewContactKey('')
    addLog(`Contact added: ${contact.name}`)
  }

  const handleDeleteContact = (id: string) => {
    deleteContact(id)
    setContacts(loadContacts())
  }

  const handleOpenChat = async (contact: Contact) => {
    if (!myPrivateKeyRaw) return
    setActiveContact(contact)
    setConnecting(true)
    setNetworkStatus('connecting')
    setScreen('chat')
    setMessages([])

    try {
      // Derive shared secret
      const privateKey = await importPrivateKey(myPrivateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, contact.publicKey)
      const safety = await generateSafetyNumber(myPublicKey, contact.publicKey)
      setSharedSecret(secret)
      sharedSecretRef.current = secret
      setSafetyNumber(safety)

      // Load history
      const history = loadChannelMessages(myPublicKey, contact.publicKey)
      setMessages(history)
      addLog(`Loaded ${history.length} messages from history.`)

      // Connect to Nostr
      onMessageRef.current = async (nostrMsg: NostrMessage) => {
        const currentSecret = sharedSecretRef.current
        if (!currentSecret) return
        const plaintext = await decryptMessage(nostrMsg.ciphertext, currentSecret, nostrMsg.id)
        if (!plaintext) return

        const stored: StoredMessage = {
          id: nostrMsg.id,
          from: nostrMsg.from,
          ciphertext: nostrMsg.ciphertext,
          timestamp: nostrMsg.timestamp,
          type: nostrMsg.type,
          fileName: nostrMsg.fileName,
          mine: false
        }
        saveChannelMessage(myPublicKey, contact.publicKey, stored)
        updateContactLastSeen(contact.publicKey)
        setMessages(prev => {
          if (prev.find(m => m.id === nostrMsg.id)) return prev
          return [...prev, { ...stored, plaintext }]
        })
      }

      await nostrClient.connect(
        myPublicKey,
        contact.publicKey,
        (msg: NostrMessage) => { if (onMessageRef.current) onMessageRef.current(msg) }
      )

      setNetworkStatus('online')
      setConnected(true)
      addLog(`Connected to Nostr. Chatting with ${contact.name}.`)
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Connection failed'}`)
      setNetworkStatus('offline')
    } finally {
      setConnecting(false)
    }
  }

  const handleBackToContacts = () => {
    nostrClient.disconnect()
    setConnected(false)
    setNetworkStatus('offline')
    setActiveContact(null)
    setSharedSecret(undefined)
    sharedSecretRef.current = undefined
    setMessages([])
    setScreen('contacts')
  }

  const handleSend = async () => {
    if (!input.trim() || !sharedSecret || !activeContact) return
    const id = crypto.randomUUID()
    const ciphertext = await encryptMessage(input.trim(), sharedSecret, id)
    const msg: NostrMessage = {
      id,
      from: myPublicKey.slice(0, 16),
      ciphertext,
      timestamp: Date.now(),
      type: 'text'
    }
    try {
      await nostrClient.send(msg)
      const stored: StoredMessage = { ...msg, mine: true, plaintext: input.trim() }
      saveChannelMessage(myPublicKey, activeContact.publicKey, stored)
      setMessages(prev => [...prev, { ...stored, plaintext: input.trim() }])
      setInput('')
      inputRef.current?.focus()
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Send failed'}`)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !sharedSecret || !activeContact) return
    if (f.size > 500 * 1024) return addLog('ERROR: Max 500KB.')
    const buf = await f.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const id = crypto.randomUUID()
    const ciphertext = await encryptFile(bytes, sharedSecret, id)
    const isImage = f.type.startsWith('image/')
    const msg: NostrMessage = {
      id,
      from: myPublicKey.slice(0, 16),
      ciphertext,
      timestamp: Date.now(),
      type: isImage ? 'image' : 'file',
      fileName: f.name
    }
    try {
      await nostrClient.send(msg)
      const stored: StoredMessage = { ...msg, mine: true }
      saveChannelMessage(myPublicKey, activeContact.publicKey, stored)
      const imageUrl = isImage ? URL.createObjectURL(f) : undefined
      setMessages(prev => [...prev, { ...stored, imageUrl, plaintext: isImage ? undefined : `[file: ${f.name}]` }])
      addLog(`Sent: ${f.name}`)
    } catch { addLog('ERROR: Send failed.') }
  }

  const handleDecryptImage = async (msg: StoredMessage) => {
    if (!sharedSecret) return
    const bytes = await decryptFile(msg.ciphertext, sharedSecret, msg.id)
    if (!bytes) return
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, imageUrl: url } : m))
  }

  const handleDecryptFile = async (msg: StoredMessage) => {
    if (!sharedSecret) return
    const bytes = await decryptFile(msg.ciphertext, sharedSecret, msg.id)
    if (!bytes) return
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = msg.fileName || 'file'
    a.click()
  }

  const handleImportProfile = () => {
    if (!importText.trim()) return
    const ok = importProfile(importText.trim())
    if (ok) {
      const identity = loadIdentity()
      if (identity) {
        setMyPublicKey(identity.publicKey)
        setMyPrivateKeyRaw(identity.privateKeyRaw)
        setHasIdentity(true)
      }
      setContacts(loadContacts())
      setImportText('')
      addLog('Profile imported.')
    } else {
      addLog('ERROR: Invalid profile data.')
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col" style={{ fontFamily: 'monospace' }}>

      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {screen === 'chat' && (
            <button onClick={handleBackToContacts} className="text-zinc-600 hover:text-zinc-400 text-xs transition-all mr-1">←</button>
          )}
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            networkStatus === 'online' ? 'bg-zinc-400' :
            networkStatus === 'connecting' ? 'bg-yellow-500' : 'bg-zinc-700'}`} />
          <span className="text-zinc-500 text-xs tracking-widest uppercase">
            wspr / {screen === 'chat' && activeContact ? activeContact.name : screen}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/app" className="text-zinc-700 hover:text-zinc-400 text-xs transition-all uppercase tracking-widest">← tool</Link>
          <button
            onClick={() => setScreen(s => s === 'settings' ? 'contacts' : 'settings')}
            className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all ml-2">
            {screen === 'settings' ? 'BACK' : 'SETTINGS'}
          </button>
          {screen === 'chat' && (
            <button
              onClick={() => setShowSidebar(v => !v)}
              className="text-xs text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-3 py-1 transition-all">
              INFO
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* CONTACTS SCREEN */}
          {screen === 'contacts' && (
            <div className="flex-1 overflow-y-auto">

              {/* Identity block */}
              <div className="border-b border-zinc-800 p-4">
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Your Identity</p>
                {!hasIdentity ? (
                  <button onClick={handleGenerateIdentity}
                    className="w-full border border-zinc-600 text-zinc-300 text-xs py-3 uppercase tracking-widest hover:bg-zinc-900 transition-all">
                    Generate Identity
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="bg-zinc-900 border border-zinc-800 p-3">
                      <p className="text-zinc-500 text-xs break-all leading-relaxed">{myPublicKey}</p>
                    </div>
                    <button onClick={() => navigator.clipboard.writeText(myPublicKey)}
                      className="text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800 py-2 transition-all">
                      Copy public key
                    </button>
                  </div>
                )}
              </div>

              {/* Add contact */}
              {hasIdentity && (
                <div className="border-b border-zinc-800 p-4">
                  <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Add Contact</p>
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={newContactName}
                      onChange={e => setNewContactName(e.target.value)}
                      placeholder="Name"
                      autoComplete="off"
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 placeholder-zinc-800"
                    />
                    <textarea
                      value={newContactKey}
                      onChange={e => setNewContactKey(e.target.value)}
                      placeholder="Their public key..."
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-16 placeholder-zinc-800"
                    />
                    <button
                      onClick={handleAddContact}
                      disabled={!newContactName.trim() || !newContactKey.trim()}
                      className="border border-zinc-600 text-zinc-300 text-xs py-2 uppercase tracking-widest hover:bg-zinc-900 transition-all disabled:opacity-30">
                      Add Contact
                    </button>
                  </div>
                </div>
              )}

              {/* Contact list */}
              <div className="p-4">
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">
                  Contacts {contacts.length > 0 && <span className="text-zinc-800">({contacts.length})</span>}
                </p>
                {contacts.length === 0 && (
                  <p className="text-zinc-800 text-xs">No contacts yet. Add one above.</p>
                )}
                {contacts.map(contact => (
                  <div key={contact.id} className="border border-zinc-900 hover:border-zinc-800 mb-2 transition-all">
                    <div className="flex items-center justify-between p-3">
                      <button
                        onClick={() => handleOpenChat(contact)}
                        className="flex-1 text-left">
                        <p className="text-zinc-300 text-xs">{contact.name}</p>
                        <p className="text-zinc-700 text-xs mt-1">{contact.publicKey.slice(0, 24)}...</p>
                        {contact.lastSeen && (
                          <p className="text-zinc-800 text-xs mt-1">
                            last seen {new Date(contact.lastSeen).toLocaleDateString()}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center gap-2 ml-3">
                        <button
                          onClick={() => handleOpenChat(contact)}
                          className="text-xs border border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-300 px-3 py-1 transition-all">
                          Chat →
                        </button>
                        <button
                          onClick={() => handleDeleteContact(contact.id)}
                          className="text-xs text-zinc-800 hover:text-zinc-600 transition-all px-1">
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CHAT SCREEN */}
          {screen === 'chat' && (
            <>
              {connecting && (
                <div className="border-b border-zinc-800 px-4 py-2">
                  <p className="text-yellow-600 text-xs">Connecting to Nostr network...</p>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {messages.length === 0 && !connecting && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-zinc-800 text-xs">No messages yet.</p>
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs md:max-w-md border p-3 ${
                      msg.mine ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-950'}`}>

                      {msg.type === 'text' && (
                        <p className="text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap break-words">
                          {msg.plaintext || '[encrypted]'}
                        </p>
                      )}

                      {msg.type === 'image' && msg.imageUrl && (
                        <img src={msg.imageUrl} alt={msg.fileName} className="max-w-full max-h-48 object-contain" />
                      )}
                      {msg.type === 'image' && !msg.imageUrl && (
                        <button onClick={() => handleDecryptImage(msg)}
                          className="text-zinc-600 hover:text-zinc-400 text-xs border border-zinc-800 px-3 py-2 transition-all">
                          Decrypt image: {msg.fileName}
                        </button>
                      )}

                      {msg.type === 'file' && (
                        <button onClick={() => handleDecryptFile(msg)}
                          className="text-zinc-600 hover:text-zinc-400 text-xs border border-zinc-800 px-3 py-2 transition-all">
                          ↓ {msg.fileName}
                        </button>
                      )}

                      <p className="text-zinc-800 text-xs mt-2">
                        {new Date(msg.timestamp).toTimeString().slice(0, 5)}
                        {!msg.mine && ` · ${msg.from.slice(0, 8)}...`}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-zinc-800 p-3 flex gap-2 flex-shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-zinc-800 hover:border-zinc-600 text-zinc-600 hover:text-zinc-400 px-3 text-xs transition-all flex-shrink-0">
                  +
                </button>
                <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder={connected ? 'Message...' : 'Connecting...'}
                  disabled={!connected}
                  autoComplete="off"
                  spellCheck={false}
                  rows={1}
                  className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-2 focus:outline-none focus:border-zinc-600 resize-none placeholder-zinc-800 disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || !connected}
                  className="border border-zinc-600 hover:border-zinc-400 text-zinc-300 px-4 text-xs uppercase tracking-widest transition-all disabled:opacity-30 flex-shrink-0">
                  Send
                </button>
              </div>
            </>
          )}

          {/* SETTINGS SCREEN */}
          {screen === 'settings' && (
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-zinc-600 text-xs uppercase tracking-widest mb-6">Settings</p>

              {/* Export */}
              <div className="border border-zinc-900 p-4 mb-4">
                <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Export Profile</p>
                <p className="text-zinc-700 text-xs mb-3">Export your identity and contacts to restore on another device.</p>
                <button
                  onClick={() => {
                    const data = exportProfile()
                    const blob = new Blob([data], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'wspr-profile.json'
                    a.click()
                    setShowExport(true)
                  }}
                  className="w-full border border-zinc-700 text-zinc-400 text-xs py-2 uppercase tracking-widest hover:bg-zinc-900 transition-all">
                  Download profile.json
                </button>
              </div>

              {/* Import */}
              <div className="border border-zinc-900 p-4 mb-4">
                <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Import Profile</p>
                <p className="text-zinc-700 text-xs mb-3">Paste exported profile JSON to restore identity and contacts.</p>
                <textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder="Paste profile JSON..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-3 focus:outline-none focus:border-zinc-600 resize-none h-24 placeholder-zinc-800 mb-2"
                />
                <button
                  onClick={handleImportProfile}
                  disabled={!importText.trim()}
                  className="w-full border border-zinc-600 text-zinc-300 text-xs py-2 uppercase tracking-widest hover:bg-zinc-900 transition-all disabled:opacity-30">
                  Import
                </button>
              </div>

              {/* Danger zone */}
              <div className="border border-zinc-900 p-4">
                <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Danger Zone</p>
                <button
                  onClick={() => {
                    if (!confirm('Delete identity and all contacts? This cannot be undone.')) return
                    localStorage.clear()
                    setMyPublicKey('')
                    setMyPrivateKeyRaw('')
                    setHasIdentity(false)
                    setContacts([])
                    setScreen('contacts')
                    addLog('All data cleared.')
                  }}
                  className="w-full border border-zinc-900 text-zinc-700 hover:border-red-900 hover:text-red-800 text-xs py-2 uppercase tracking-widest transition-all">
                  Clear all data
                </button>
              </div>

              {/* Log */}
              {log.length > 0 && (
                <div className="mt-6">
                  <p className="text-zinc-700 text-xs uppercase tracking-widest mb-2">Log</p>
                  {log.map((entry, i) => (
                    <p key={i} className={`text-xs mb-1 ${entry.includes('ERROR') ? 'text-zinc-500' : 'text-zinc-700'}`}>
                      {entry}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        {screen === 'chat' && showSidebar && (
          <div className="w-64 border-l border-zinc-800 flex flex-col overflow-y-auto flex-shrink-0">
            <div className="border-b border-zinc-800 p-4">
              <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Network</p>
              <div className="flex flex-col gap-2">
                {[
                  ['Protocol', 'Nostr'],
                  ['Relays', '5 public'],
                  ['Status', networkStatus],
                  ['IP exposed', 'No'],
                  ['Encryption', 'AES-256-GCM'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-700 text-xs">{k}</span>
                    <span className={`text-xs ${k === 'Status' && networkStatus === 'online' ? 'text-zinc-400' : 'text-zinc-500'}`}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {safetyNumber && (
              <div className="border-b border-zinc-800 p-4">
                <p className="text-zinc-600 text-xs uppercase tracking-widest mb-3">Safety Number</p>
                <div className="bg-zinc-900 border border-zinc-800 p-3 mb-3">
                  <p className="text-zinc-300 text-xs tracking-widest font-mono text-center">{safetyNumber}</p>
                </div>
                <button
                  onClick={() => setSafetyVerified(v => !v)}
                  className={`w-full text-xs py-2 border transition-all ${
                    safetyVerified ? 'border-zinc-500 text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>
                  {safetyVerified ? 'Verified ✓' : 'Mark verified'}
                </button>
              </div>
            )}

            <div className="p-4">
              <button
                onClick={() => {
                  if (!activeContact) return
                  clearChannelMessages(myPublicKey, activeContact.publicKey)
                  setMessages([])
                  addLog('Chat cleared.')
                }}
                className="w-full text-xs py-2 border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-all uppercase tracking-widest">
                Clear history
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
