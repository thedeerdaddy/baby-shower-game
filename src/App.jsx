import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'bsg_v1'
const POLL_MS = 2500
const ROUND_SECS = 75
const HOST_PIN = import.meta.env.VITE_HOST_PIN || '1234'

const DEFAULT_QUIPLASH = [
  "The worst baby name ever thought up...",
  "What babies are really saying when they cry...",
  "The thing nobody tells you about having a baby...",
  "A lullaby that would definitely NOT work...",
  "The most useless item in any diaper bag...",
  "What the baby is plotting at 3am...",
  "A rejected slogan for baby formula...",
  "The baby's spirit animal is...",
  "What new parents miss most about sleep...",
  "The one thing you should never say to a new mom...",
  "Cooper and Michelle's baby will grow up to be...",
  "The worst advice anyone has ever given about babies...",
]

const INITIAL_STATE = {
  phase: 'lobby',
  players: [],
  activeGame: null,
  quiplash: {
    prompts: [...DEFAULT_QUIPLASH],
    usedPrompts: [],
    currentPrompt: null,
    answers: {},
    roundStart: null,
    round: 0,
  },
  wknwb: {
    submittedQuestions: [],
    currentQuestion: null,
    answers: {},
    revealedAnswers: [],
    round: 0,
    roundStart: null,
  },
  trivia: {
    questions: [],
    currentIdx: null,
    guesses: {},
    revealedIdx: [],
    round: 0,
    roundStart: null,
  },
}

// ── STORAGE (Supabase REST or localStorage fallback) ───────────────────────
async function loadState() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null }
  }
  try {
    const r = await fetch(`${url}/rest/v1/game_state?key=eq.main&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    })
    const data = await r.json()
    if (data && data[0]) return JSON.parse(data[0].value)
    return null
  } catch { return null }
}

async function saveState(state) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return
  }
  try {
    await fetch(`${url}/rest/v1/game_state`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: 'main', value: JSON.stringify(state) })
    })
  } catch {}
}

const uid = () => Math.random().toString(36).slice(2, 9)

// ── APP ────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(null)
  const [view, setView] = useState('join')
  const [isHost, setIsHost] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [timerPct, setTimerPct] = useState(100)
  const stateRef = useRef(state)
  stateRef.current = state

  const refresh = useCallback(async () => {
    const s = await loadState()
    if (!s) { setState(INITIAL_STATE); return }
    setState(prev => JSON.stringify(prev) === JSON.stringify(s) ? prev : s)
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const prevPhase = useRef(null)
  useEffect(() => {
    if (!state) return
    if (state.phase !== prevPhase.current) {
      if (state.phase.endsWith('-round')) setHasSubmitted(false)
      prevPhase.current = state.phase
    }
  }, [state?.phase])

  useEffect(() => {
    if (!state) return
    const roundStart = state.quiplash?.roundStart || state.wknwb?.roundStart || state.trivia?.roundStart
    if (state.phase.endsWith('-round') && roundStart) {
      const t = setInterval(() => {
        const elapsed = Date.now() - roundStart
        setTimerPct(Math.max(0, ((ROUND_SECS * 1000 - elapsed) / (ROUND_SECS * 1000)) * 100))
      }, 500)
      return () => clearInterval(t)
    } else { setTimerPct(100) }
  }, [state?.phase, state?.quiplash?.roundStart, state?.wknwb?.roundStart, state?.trivia?.roundStart])

  const update = async (updater) => {
    const fresh = await loadState() || stateRef.current || INITIAL_STATE
    const next = updater(JSON.parse(JSON.stringify(fresh)))
    setState(next)
    await saveState(next)
  }

  // HOST ACTIONS
  const hostLogin = () => {
    if (pinInput === HOST_PIN) { setIsHost(true); setView('host') }
    else { setPinError(true); setTimeout(() => setPinError(false), 1500) }
  }

  const selectGame = (game) => update(s => { s.activeGame = game; s.phase = `${game}-host`; return s })

  const resetAll = () => update(s => {
    const fresh = JSON.parse(JSON.stringify(INITIAL_STATE))
    fresh.players = s.players
    fresh.quiplash.prompts = s.quiplash.prompts
    fresh.trivia.questions = s.trivia.questions
    fresh.wknwb.submittedQuestions = s.wknwb.submittedQuestions
    return fresh
  })

  const startQuiplashRound = () => update(s => {
    const used = s.quiplash.usedPrompts || []
    const pool = s.quiplash.prompts.filter(p => !used.includes(p))
    const src = pool.length > 0 ? pool : s.quiplash.prompts
    const prompt = src[Math.floor(Math.random() * src.length)]
    s.quiplash = { ...s.quiplash, currentPrompt: prompt, answers: {}, round: (s.quiplash.round || 0) + 1, roundStart: Date.now(), usedPrompts: [...used, prompt] }
    s.phase = 'quiplash-round'
    return s
  })
  const revealQuiplash = () => update(s => { s.phase = 'quiplash-reveal'; return s })
  const nextQuiplash = () => update(s => { s.quiplash.answers = {}; s.phase = 'quiplash-host'; return s })

  const startWknwbRound = () => update(s => {
    const unanswered = s.wknwb.submittedQuestions.filter(q => !s.wknwb.revealedAnswers.includes(q.id))
    if (!unanswered.length) return s
    const q = unanswered[Math.floor(Math.random() * unanswered.length)]
    s.wknwb = { ...s.wknwb, currentQuestion: q, answers: {}, round: (s.wknwb.round || 0) + 1, roundStart: Date.now() }
    s.phase = 'wknwb-round'
    return s
  })
  const revealWknwb = () => update(s => {
    if (s.wknwb.currentQuestion) s.wknwb.revealedAnswers.push(s.wknwb.currentQuestion.id)
    s.phase = 'wknwb-reveal'
    return s
  })
  const nextWknwb = () => update(s => { s.wknwb.answers = {}; s.phase = 'wknwb-host'; return s })

  const startTriviaRound = () => update(s => {
    const unrevealed = s.trivia.questions.map((_, i) => i).filter(i => !s.trivia.revealedIdx.includes(i))
    if (!unrevealed.length) return s
    const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)]
    s.trivia = { ...s.trivia, currentIdx: idx, guesses: {}, round: (s.trivia.round || 0) + 1, roundStart: Date.now() }
    s.phase = 'trivia-round'
    return s
  })
  const revealTrivia = () => update(s => {
    if (s.trivia.currentIdx !== null) s.trivia.revealedIdx.push(s.trivia.currentIdx)
    s.phase = 'trivia-reveal'
    return s
  })
  const nextTrivia = () => update(s => { s.trivia.guesses = {}; s.phase = 'trivia-host'; return s })

  // PLAYER ACTIONS
  const joinGame = (name) => {
    update(s => { if (!s.players.includes(name)) s.players.push(name); return s })
    setPlayerName(name); setJoined(true)
  }
  const submitQuiplash = (answer) => { update(s => { s.quiplash.answers[playerName] = answer; return s }); setHasSubmitted(true) }
  const submitWknwb = (cooper, michelle) => { update(s => { s.wknwb.answers[playerName] = { cooper, michelle }; return s }); setHasSubmitted(true) }
  const submitTrivia = (answer) => { update(s => { s.trivia.guesses[playerName] = answer; return s }); setHasSubmitted(true) }
  const submitWknwbQuestion = (text) => update(s => { s.wknwb.submittedQuestions.push({ id: uid(), text, submittedBy: playerName }); return s })
  const addTriviaQuestion = (q, ca, ma) => update(s => { s.trivia.questions.push({ id: uid(), question: q, cooperAnswer: ca, michelleAnswer: ma }); return s })
  const addQuiplashPrompt = (text) => update(s => { s.quiplash.prompts.push(text); return s })
  const removeQuiplashPrompt = (text) => update(s => { s.quiplash.prompts = s.quiplash.prompts.filter(p => p !== text); return s })
  const removeTriviaQuestion = (id) => update(s => { s.trivia.questions = s.trivia.questions.filter(q => q.id !== id); return s })
  const removeWknwbQuestion = (id) => update(s => { s.wknwb.submittedQuestions = s.wknwb.submittedQuestions.filter(q => q.id !== id); return s })

  const generateAIPrompts = async () => {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Generate 8 funny creative Quiplash-style open-ended prompts for a baby shower for a couple named Cooper and Michelle. Appropriate for mixed adults. Return ONLY a JSON array of strings, no preamble, no markdown backticks.' }]
        })
      })
      const data = await resp.json()
      const text = data.content.map(c => c.text || '').join('')
      const prompts = JSON.parse(text.replace(/```json|```/g, '').trim())
      if (Array.isArray(prompts)) {
        update(s => { s.quiplash.prompts = [...s.quiplash.prompts, ...prompts]; return s })
        return prompts.length
      }
    } catch {}
    return 0
  }

  if (!state) return <div className="app"><div className="main" style={{ textAlign: 'center', paddingTop: 80 }}>🍼 Loading...</div></div>

  const appUrl = window.location.href.split('?')[0]

  return (
    <div className="app">
      <nav className="nav no-print">
        <div className="nav-title">Cooper & Michelle 🍼</div>
        <div className="nav-tabs">
          <button className={`nav-tab ${view === 'join' ? 'active' : ''}`} onClick={() => setView('join')}>{joined ? '📱 Play' : '🎉 Join'}</button>
          <button className={`nav-tab ${view === 'host' || view === 'pin' ? 'active' : ''}`} onClick={() => isHost ? setView('host') : setView('pin')}>📺 Host</button>
          <button className={`nav-tab ${view === 'qr' ? 'active' : ''}`} onClick={() => setView('qr')}>QR</button>
        </div>
      </nav>

      <main className="main">
        {view === 'join' && (
          <JoinView state={state} joined={joined} playerName={playerName} hasSubmitted={hasSubmitted} timerPct={timerPct}
            onJoin={joinGame} onSubmitQuiplash={submitQuiplash} onSubmitWknwb={submitWknwb} onSubmitTrivia={submitTrivia} onSubmitWknwbQuestion={submitWknwbQuestion} />
        )}
        {view === 'pin' && <PinView pinInput={pinInput} setPinInput={setPinInput} pinError={pinError} onLogin={hostLogin} />}
        {(view === 'host' && isHost) && (
          <HostView state={state} timerPct={timerPct} playerCount={state.players.length}
            onSelectGame={selectGame} onResetAll={resetAll}
            onStartQuiplash={startQuiplashRound} onRevealQuiplash={revealQuiplash} onNextQuiplash={nextQuiplash}
            onStartWknwb={startWknwbRound} onRevealWknwb={revealWknwb} onNextWknwb={nextWknwb}
            onStartTrivia={startTriviaRound} onRevealTrivia={revealTrivia} onNextTrivia={nextTrivia}
            onAddQuiplashPrompt={addQuiplashPrompt} onRemoveQuiplashPrompt={removeQuiplashPrompt}
            onAddTriviaQuestion={addTriviaQuestion} onRemoveTriviaQuestion={removeTriviaQuestion}
            onRemoveWknwbQuestion={removeWknwbQuestion} onGenerateAI={generateAIPrompts} />
        )}
        {view === 'qr' && <QRView appUrl={appUrl} />}
      </main>
    </div>
  )
}

// ── JOIN VIEW ──────────────────────────────────────────────────────────────
function JoinView({ state, joined, playerName, hasSubmitted, timerPct, onJoin, onSubmitQuiplash, onSubmitWknwb, onSubmitTrivia, onSubmitWknwbQuestion }) {
  const [nameInput, setNameInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [cooperAns, setCooperAns] = useState('')
  const [michelleAns, setMichelleAns] = useState('')
  const [triviaAns, setTriviaAns] = useState('')
  const [wknwbQ, setWknwbQ] = useState('')
  const [qSubmitted, setQSubmitted] = useState(false)
  const phase = state.phase

  if (!joined) {
    return (
      <>
        <div className="hero">
          <div className="hero-eyebrow">Baby Shower Games</div>
          <h1>Welcome to Cooper<br />& <em>Michelle's</em> Party</h1>
          <p className="hero-sub">Enter your name to join the fun</p>
        </div>
        <div className="card">
          <div className="field">
            <label>Your Name</label>
            <input className="input" placeholder="e.g. Grandma Karen..." value={nameInput}
              onChange={e => setNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && nameInput.trim() && onJoin(nameInput.trim())} autoFocus />
          </div>
          <button className="btn btn-primary btn-block" onClick={() => onJoin(nameInput.trim())} disabled={!nameInput.trim()}>Join the Party 🎀</button>
          <div className="divider" />
          <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{state.players.length} guests have joined</p>
        </div>
      </>
    )
  }

  if (phase === 'lobby' || phase === 'game-select') {
    return (
      <>
        <div className="hero">
          <div className="hero-eyebrow">You're in, {playerName}!</div>
          <h1>Waiting for<br /><em>the party</em> to start</h1>
          <p className="hero-sub">Submit questions while you wait!</p>
        </div>
        <div className="card">
          <div className="card-title">Submit a Question 💬</div>
          <p className="card-sub">These will be used in "Who Knows Who Better?" — guess how Cooper & Michelle answer</p>
          {qSubmitted
            ? <div className="submitted-state"><div className="big">✅</div><p>Question submitted!</p><button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setWknwbQ(''); setQSubmitted(false) }}>Add another</button></div>
            : <>
              <div className="field"><textarea className="input" placeholder="e.g. Who is more likely to panic in the delivery room?" value={wknwbQ} onChange={e => setWknwbQ(e.target.value)} /></div>
              <button className="btn btn-sage btn-block" disabled={!wknwbQ.trim()} onClick={() => { onSubmitWknwbQuestion(wknwbQ.trim()); setQSubmitted(true) }}>Submit Question 🌿</button>
            </>
          }
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🍼</div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{state.players.length} guest{state.players.length !== 1 ? 's' : ''} ready</p>
          <div className="player-list" style={{ justifyContent: 'center', marginTop: 12 }}>
            {state.players.map(p => <span key={p} className="player-tag">{p}</span>)}
          </div>
        </div>
      </>
    )
  }

  if (phase === 'quiplash-host') return <WaitCard icon="😂" text="Quiplash — host is starting a round..." />

  if (phase === 'quiplash-round') {
    if (hasSubmitted) return <SubmittedCard message="Answer locked in! Waiting for everyone..." />
    return (
      <>
        <div className="prompt-display">
          <div className="round-label">Round {state.quiplash.round} — Quiplash</div>
          <div className="prompt-text">{state.quiplash.currentPrompt}</div>
        </div>
        <div className="card">
          <div className="field"><label>Your funniest answer</label><textarea className="input" placeholder="Type your answer..." value={answer} onChange={e => setAnswer(e.target.value)} maxLength={200} autoFocus /></div>
          <button className="btn btn-primary btn-block" disabled={!answer.trim()} onClick={() => { onSubmitQuiplash(answer.trim()); setAnswer('') }}>Submit ✨</button>
        </div>
        <TimerBar pct={timerPct} />
      </>
    )
  }

  if (phase === 'quiplash-reveal') return <WaitCard icon="🎉" text="Look at the big screen for the reveal!" />

  if (phase === 'wknwb-host') return <WaitCard icon="💬" text="Who Knows Who Better? — host is starting a round..." />

  if (phase === 'wknwb-round') {
    const q = state.wknwb.currentQuestion
    if (!q) return <WaitCard icon="⏳" text="Round starting..." />
    if (hasSubmitted) return <SubmittedCard message="Answers locked in! Watch the big screen..." />
    return (
      <>
        <div className="prompt-display">
          <div className="round-label">Round {state.wknwb.round} — Who Knows Who Better?</div>
          <div className="prompt-text">{q.text}</div>
        </div>
        <div className="card">
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Guess how each of them would answer</p>
          <div className="field"><label>🔵 Cooper would say...</label><input className="input" placeholder="Cooper's answer" value={cooperAns} onChange={e => setCooperAns(e.target.value)} /></div>
          <div className="field"><label>🌸 Michelle would say...</label><input className="input" placeholder="Michelle's answer" value={michelleAns} onChange={e => setMichelleAns(e.target.value)} /></div>
          <button className="btn btn-primary btn-block" disabled={!cooperAns.trim() || !michelleAns.trim()} onClick={() => { onSubmitWknwb(cooperAns.trim(), michelleAns.trim()); setCooperAns(''); setMichelleAns('') }}>Lock In 🔒</button>
        </div>
        <TimerBar pct={timerPct} />
      </>
    )
  }

  if (phase === 'wknwb-reveal') return <WaitCard icon="🎉" text="Look at the big screen for the reveal!" />

  if (phase === 'trivia-host') return <WaitCard icon="🎯" text="Cooper & Michelle Trivia — host is starting a round..." />

  if (phase === 'trivia-round') {
    const q = state.trivia.currentIdx !== null ? state.trivia.questions[state.trivia.currentIdx] : null
    if (!q) return <WaitCard icon="⏳" text="Round starting..." />
    if (hasSubmitted) return <SubmittedCard message="Guess locked in! Watch the big screen..." />
    return (
      <>
        <div className="prompt-display">
          <div className="round-label">Round {state.trivia.round} — Trivia</div>
          <div className="prompt-text">{q.question}</div>
        </div>
        <div className="card">
          <div className="field"><label>Your guess</label><input className="input" placeholder="What's your answer?" value={triviaAns} onChange={e => setTriviaAns(e.target.value)} autoFocus /></div>
          <button className="btn btn-primary btn-block" disabled={!triviaAns.trim()} onClick={() => { onSubmitTrivia(triviaAns.trim()); setTriviaAns('') }}>Submit Guess 🎯</button>
        </div>
        <TimerBar pct={timerPct} />
      </>
    )
  }

  if (phase === 'trivia-reveal') return <WaitCard icon="🎉" text="Look at the big screen for the reveal!" />

  return <WaitCard icon="🍼" text="Waiting for the next game..." />
}

// ── HOST VIEW ──────────────────────────────────────────────────────────────
function HostView({ state, timerPct, playerCount, onSelectGame, onResetAll, onStartQuiplash, onRevealQuiplash, onNextQuiplash, onStartWknwb, onRevealWknwb, onNextWknwb, onStartTrivia, onRevealTrivia, onNextTrivia, onAddQuiplashPrompt, onRemoveQuiplashPrompt, onAddTriviaQuestion, onRemoveTriviaQuestion, onRemoveWknwbQuestion, onGenerateAI }) {
  const phase = state.phase

  if (phase === 'lobby' || phase === 'game-select') return (
    <LobbyHostView state={state} playerCount={playerCount} onSelectGame={onSelectGame} onResetAll={onResetAll}
      onAddQuiplashPrompt={onAddQuiplashPrompt} onRemoveQuiplashPrompt={onRemoveQuiplashPrompt}
      onAddTriviaQuestion={onAddTriviaQuestion} onRemoveTriviaQuestion={onRemoveTriviaQuestion}
      onRemoveWknwbQuestion={onRemoveWknwbQuestion} onGenerateAI={onGenerateAI} />
  )
  if (phase === 'quiplash-host') return <QuiplashHostView state={state} playerCount={playerCount} onStart={onStartQuiplash} onBack={onResetAll} />
  if (phase === 'quiplash-round') return <QuiplashRoundView state={state} timerPct={timerPct} playerCount={playerCount} onReveal={onRevealQuiplash} />
  if (phase === 'quiplash-reveal') return <QuiplashRevealView state={state} onNext={onNextQuiplash} onDone={onResetAll} />
  if (phase === 'wknwb-host') return <WknwbHostView state={state} playerCount={playerCount} onStart={onStartWknwb} onBack={onResetAll} />
  if (phase === 'wknwb-round') return <WknwbRoundView state={state} timerPct={timerPct} playerCount={playerCount} onReveal={onRevealWknwb} />
  if (phase === 'wknwb-reveal') return <WknwbRevealView state={state} onNext={onNextWknwb} onDone={onResetAll} />
  if (phase === 'trivia-host') return <TriviaHostView state={state} playerCount={playerCount} onStart={onStartTrivia} onBack={onResetAll} />
  if (phase === 'trivia-round') return <TriviaRoundView state={state} timerPct={timerPct} playerCount={playerCount} onReveal={onRevealTrivia} />
  if (phase === 'trivia-reveal') return <TriviaRevealView state={state} onNext={onNextTrivia} onDone={onResetAll} />
  return null
}

// ── LOBBY HOST ─────────────────────────────────────────────────────────────
function LobbyHostView({ state, playerCount, onSelectGame, onResetAll, onAddQuiplashPrompt, onRemoveQuiplashPrompt, onAddTriviaQuestion, onRemoveTriviaQuestion, onRemoveWknwbQuestion, onGenerateAI }) {
  const [tab, setTab] = useState('quiplash')
  const [newPrompt, setNewPrompt] = useState('')
  const [triviaQ, setTriviaQ] = useState(''); const [cooperA, setCooperA] = useState(''); const [michelleA, setMichelleA] = useState('')
  const [genStatus, setGenStatus] = useState('')

  const handleGen = async () => {
    setGenStatus('Generating...')
    const n = await onGenerateAI()
    setGenStatus(n > 0 ? `Added ${n} prompts!` : 'Error. Try again.')
    setTimeout(() => setGenStatus(''), 3000)
  }

  const customPrompts = state.quiplash.prompts.filter(p => !DEFAULT_QUIPLASH.includes(p))

  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Host Dashboard</div>
        <h1>Cooper & <em>Michelle's</em><br />Baby Shower</h1>
        <p className="hero-sub">{playerCount} guest{playerCount !== 1 ? 's' : ''} joined</p>
      </div>

      {state.players.length > 0 && (
        <div className="player-list" style={{ marginBottom: 20 }}>
          {state.players.map(p => <span key={p} className="player-tag">{p}</span>)}
        </div>
      )}

      {/* Game tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        {['quiplash', 'wknwb', 'trivia'].map(g => (
          <button key={g} onClick={() => setTab(g)} style={{ padding: '8px 16px', borderRadius: 40, border: 'none', fontSize: 13, fontWeight: 600, background: tab === g ? 'var(--dusty-rose)' : 'var(--cream)', color: tab === g ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>
            {g === 'quiplash' ? '😂 Quiplash' : g === 'wknwb' ? '💬 Who Knows' : '🎯 Trivia'}
          </button>
        ))}
      </div>

      {/* QUIPLASH */}
      {tab === 'quiplash' && (
        <div className="card">
          <div className="card-title">Quiplash Prompts</div>
          <p className="card-sub">{state.quiplash.prompts.length} total ({DEFAULT_QUIPLASH.length} default + {customPrompts.length} custom)</p>
          <div className="answer-scroll" style={{ marginBottom: 12 }}>
            {customPrompts.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>12 built-in prompts active. Add custom ones or generate with AI below.</p>
              : customPrompts.map(p => (
                <div key={p} className="list-item"><span className="li-text">{p}</span><button className="li-del" onClick={() => onRemoveQuiplashPrompt(p)}>✕</button></div>
              ))
            }
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="input" style={{ flex: 1, padding: '10px 14px' }} placeholder="Add a custom prompt..." value={newPrompt} onChange={e => setNewPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && newPrompt.trim() && (onAddQuiplashPrompt(newPrompt.trim()), setNewPrompt(''))} />
            <button className="btn btn-ghost btn-sm" disabled={!newPrompt.trim()} onClick={() => { onAddQuiplashPrompt(newPrompt.trim()); setNewPrompt('') }}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <button className="btn btn-sage btn-sm" onClick={handleGen}>✨ Generate AI Prompts</button>
            {genStatus && <span style={{ fontSize: 13, color: 'var(--sage-dark)' }}>{genStatus}</span>}
          </div>
          <div className="divider" />
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('quiplash')} disabled={playerCount === 0}>
            Launch Quiplash 😂
          </button>
          {playerCount === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>Waiting for guests to join</p>}
        </div>
      )}

      {/* WHO KNOWS WHO BETTER */}
      {tab === 'wknwb' && (
        <div className="card">
          <div className="card-title">Who Knows Who Better?</div>
          <p className="card-sub">{state.wknwb.submittedQuestions.length} questions submitted by guests</p>
          <div className="answer-scroll" style={{ marginBottom: 16 }}>
            {state.wknwb.submittedQuestions.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No questions yet. Guests add them from the Join tab while waiting.</p>
              : state.wknwb.submittedQuestions.map(q => (
                <div key={q.id} className="list-item">
                  <span className="li-text">{q.text} <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {q.submittedBy}</span></span>
                  <button className="li-del" onClick={() => onRemoveWknwbQuestion(q.id)}>✕</button>
                </div>
              ))
            }
          </div>
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('wknwb')} disabled={state.wknwb.submittedQuestions.length === 0 || playerCount === 0}>
            Launch Who Knows Who Better? 💬
          </button>
          {state.wknwb.submittedQuestions.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>Need at least 1 question</p>}
        </div>
      )}

      {/* TRIVIA */}
      {tab === 'trivia' && (
        <div className="card">
          <div className="card-title">Cooper & Michelle Trivia</div>
          <p className="card-sub">{state.trivia.questions.length} questions loaded</p>
          <div className="answer-scroll" style={{ marginBottom: 12 }}>
            {state.trivia.questions.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No questions yet. Add some below — only you and Michelle know the answers.</p>
              : state.trivia.questions.map(q => (
                <div key={q.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{q.question}</span>
                    <button className="li-del" onClick={() => onRemoveTriviaQuestion(q.id)}>✕</button>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>🔵 {q.cooperAnswer} | 🌸 {q.michelleAnswer}</span>
                </div>
              ))
            }
          </div>
          <div className="field"><label>Question</label><input className="input" placeholder="e.g. Where was your first date?" value={triviaQ} onChange={e => setTriviaQ(e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}><label>🔵 Cooper's Answer</label><input className="input" placeholder="Cooper's answer" value={cooperA} onChange={e => setCooperA(e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>🌸 Michelle's Answer</label><input className="input" placeholder="Michelle's answer" value={michelleA} onChange={e => setMichelleA(e.target.value)} /></div>
          </div>
          <button className="btn btn-ghost btn-block" onClick={() => { if (triviaQ && cooperA && michelleA) { onAddTriviaQuestion(triviaQ.trim(), cooperA.trim(), michelleA.trim()); setTriviaQ(''); setCooperA(''); setMichelleA('') } }} disabled={!triviaQ.trim() || !cooperA.trim() || !michelleA.trim()}>Add Question</button>
          <div className="divider" />
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('trivia')} disabled={state.trivia.questions.length === 0 || playerCount === 0}>
            Launch Trivia 🎯
          </button>
          {state.trivia.questions.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>Need at least 1 question</p>}
        </div>
      )}

      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onResetAll}>↺ Reset All Games</button>
    </>
  )
}

// ── GAME HOST VIEWS ────────────────────────────────────────────────────────
function QuiplashHostView({ state, playerCount, onStart, onBack }) {
  const remaining = state.quiplash.prompts.length - (state.quiplash.usedPrompts?.length || 0)
  return (
    <>
      <TVScreen><div className="tv-idle-icon">😂</div><div className="tv-idle-title">Quiplash</div><div className="tv-idle-sub">Round {(state.quiplash.round || 0) + 1} ready · {remaining} prompts left</div></TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onStart} disabled={playerCount === 0}>Start Round</button>
        <button className="btn btn-ghost" onClick={onBack}>← Menu</button>
      </div>
      <div className="card"><p style={{ fontSize: 14, color: 'var(--muted)' }}>{playerCount} players in game</p></div>
    </>
  )
}

function QuiplashRoundView({ state, timerPct, playerCount, onReveal }) {
  const answerCount = Object.keys(state.quiplash.answers || {}).length
  return (
    <>
      <TVScreen>
        <div className="tv-label">Round {state.quiplash.round} — Quiplash</div>
        <div className="tv-prompt">{state.quiplash.currentPrompt}</div>
        <div className="tv-sub">{answerCount} / {playerCount} answered</div>
        <TimerBar pct={timerPct} />
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onReveal}>Reveal Answers</button></div>
    </>
  )
}

function QuiplashRevealView({ state, onNext, onDone }) {
  const answers = Object.entries(state.quiplash.answers || {})
  return (
    <>
      <TVScreen>
        <div className="tv-label" style={{ marginBottom: 12 }}>{state.quiplash.currentPrompt}</div>
        <div className="tv-answers">
          {answers.length === 0
            ? <div className="tv-sub">No answers submitted</div>
            : answers.map(([name, ans]) => <div key={name} className="answer-chip"><div className="chip-name">{name}</div><div className="chip-text">{ans}</div></div>)
          }
        </div>
      </TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onNext}>Next Round</button>
        <button className="btn btn-ghost" onClick={onDone}>End Game</button>
      </div>
    </>
  )
}

function WknwbHostView({ state, playerCount, onStart, onBack }) {
  const remaining = state.wknwb.submittedQuestions.filter(q => !state.wknwb.revealedAnswers.includes(q.id)).length
  return (
    <>
      <TVScreen><div className="tv-idle-icon">💬</div><div className="tv-idle-title">Who Knows Who Better?</div><div className="tv-idle-sub">{remaining} questions remaining</div></TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onStart} disabled={remaining === 0 || playerCount === 0}>Start Round</button>
        <button className="btn btn-ghost" onClick={onBack}>← Menu</button>
      </div>
    </>
  )
}

function WknwbRoundView({ state, timerPct, playerCount, onReveal }) {
  const q = state.wknwb.currentQuestion
  const answerCount = Object.keys(state.wknwb.answers || {}).length
  return (
    <>
      <TVScreen>
        <div className="tv-label">Round {state.wknwb.round} — Who Knows Who Better?</div>
        <div className="tv-prompt">{q?.text}</div>
        <div className="tv-sub">{answerCount} / {playerCount} answered</div>
        <TimerBar pct={timerPct} />
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onReveal}>Reveal Answers</button></div>
    </>
  )
}

function WknwbRevealView({ state, onNext, onDone }) {
  const q = state.wknwb.currentQuestion
  const answers = Object.entries(state.wknwb.answers || {})
  return (
    <>
      <TVScreen>
        <div className="tv-label" style={{ marginBottom: 12 }}>{q?.text}</div>
        <div className="tv-answers">
          {answers.map(([name, ans]) => (
            <div key={name} className="answer-chip">
              <div className="chip-name">{name}</div>
              <div className="chip-text">🔵 {ans.cooper} · 🌸 {ans.michelle}</div>
            </div>
          ))}
        </div>
      </TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onNext}>Next Round</button>
        <button className="btn btn-ghost" onClick={onDone}>End Game</button>
      </div>
    </>
  )
}

function TriviaHostView({ state, playerCount, onStart, onBack }) {
  const remaining = state.trivia.questions.length - (state.trivia.revealedIdx?.length || 0)
  return (
    <>
      <TVScreen><div className="tv-idle-icon">🎯</div><div className="tv-idle-title">Cooper & Michelle Trivia</div><div className="tv-idle-sub">{remaining} questions remaining</div></TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onStart} disabled={remaining === 0 || playerCount === 0}>Start Round</button>
        <button className="btn btn-ghost" onClick={onBack}>← Menu</button>
      </div>
    </>
  )
}

function TriviaRoundView({ state, timerPct, playerCount, onReveal }) {
  const q = state.trivia.currentIdx !== null ? state.trivia.questions[state.trivia.currentIdx] : null
  const guessCount = Object.keys(state.trivia.guesses || {}).length
  return (
    <>
      <TVScreen>
        <div className="tv-label">Round {state.trivia.round} — Trivia</div>
        <div className="tv-prompt">{q?.question}</div>
        <div className="tv-sub">{guessCount} / {playerCount} guessed</div>
        <TimerBar pct={timerPct} />
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onReveal}>Reveal Answer</button></div>
    </>
  )
}

function TriviaRevealView({ state, onNext, onDone }) {
  const q = state.trivia.currentIdx !== null ? state.trivia.questions[state.trivia.currentIdx] : null
  const guesses = Object.entries(state.trivia.guesses || {})
  const isClose = (g, a) => g && a && (g.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(g.toLowerCase()))
  return (
    <>
      <TVScreen>
        <div className="tv-label" style={{ marginBottom: 10 }}>{q?.question}</div>
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>🔵 Cooper</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#fff' }}>{q?.cooperAnswer}</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>🌸 Michelle</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#fff' }}>{q?.michelleAnswer}</div>
          </div>
        </div>
        <div className="tv-answers">
          {guesses.map(([name, g]) => (
            <div key={name} className="answer-chip" style={isClose(g, q?.cooperAnswer) || isClose(g, q?.michelleAnswer) ? { background: 'rgba(168,197,160,0.3)', borderColor: 'rgba(168,197,160,0.6)' } : {}}>
              <div className="chip-name">{name}</div>
              <div className="chip-text">{g}</div>
            </div>
          ))}
        </div>
      </TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onNext}>Next Question</button>
        <button className="btn btn-ghost" onClick={onDone}>End Game</button>
      </div>
    </>
  )
}

// ── SHARED ─────────────────────────────────────────────────────────────────
function TVScreen({ children }) {
  return (
    <div className="tv">
      <div className="tv-dots">
        <div className="tv-dot" style={{ background: '#F2C4C4' }} />
        <div className="tv-dot" style={{ background: '#FAC775' }} />
        <div className="tv-dot" style={{ background: '#A8C5A0' }} />
      </div>
      {children}
    </div>
  )
}

function TimerBar({ pct }) {
  return (
    <div className="timer-bar">
      <div className="timer-fill" style={{ width: `${pct}%`, background: pct < 25 ? '#e74c3c' : pct < 50 ? '#FAC775' : 'var(--sage)' }} />
    </div>
  )
}

function SubmittedCard({ icon = '✅', message }) {
  return <div className="submitted-state"><div className="big">{icon}</div><p>{message}</p></div>
}

function WaitCard({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <p style={{ color: 'var(--muted)', fontSize: 15 }}>{text}</p>
    </div>
  )
}

function PinView({ pinInput, setPinInput, pinError, onLogin }) {
  return (
    <div style={{ maxWidth: 340, margin: '60px auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div className="card-title" style={{ marginBottom: 4 }}>Host Access</div>
        <p className="card-sub">Enter the host PIN to control the game</p>
        <div className="field">
          <input className="input" type="password" placeholder="PIN" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onLogin()} autoFocus style={pinError ? { borderColor: '#e74c3c' } : {}} />
          {pinError && <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>Wrong PIN</p>}
        </div>
        <button className="btn btn-primary btn-block" onClick={onLogin}>Enter Host Mode</button>
      </div>
    </div>
  )
}

function QRView({ appUrl }) {
  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Print & Display</div>
        <h1>Scan to <em>Join</em> the Party</h1>
        <p className="hero-sub">One at each table — guests scan to play on their phone</p>
      </div>
      <div className="qr-print-card">
        <h2>Cooper & Michelle's Baby Shower 🍼</h2>
        <p>Scan with your phone camera to join the games!</p>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
          <QRCodeSVG value={appUrl} size={220} bgColor="#ffffff" fgColor="#2C1F2E" level="H" includeMargin />
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all', marginTop: 8 }}>{appUrl}</p>
      </div>
      <button className="btn btn-primary no-print" style={{ marginTop: 16, width: '100%' }} onClick={() => window.print()}>
        🖨️ Print QR Code
      </button>
    </>
  )
}
