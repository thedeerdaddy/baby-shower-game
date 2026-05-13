import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'

const STORAGE_KEY = 'bsg_v4'
const POLL_MS = 2500
const ROUND_SECS = 75
const HOST_PIN = import.meta.env.VITE_HOST_PIN || '1234'
const JUDGE_PIN = 'baby' // Cooper and Michelle's judge PIN
const PHOTO_BUCKET = 'baby shower photos'

const DEFAULT_QUIPLASH = [
  "Lainey's first words will definitely be...",
  "The thing Cooper will be terrible at as a dad...",
  "Michelle's parenting motto will be...",
  "Lainey's most likely childhood nickname...",
  "The first thing Lainey will inherit from Cooper...",
  "The first thing Lainey will inherit from Michelle...",
  "Cooper's face in the delivery room looked like...",
  "The most useless gift at this baby shower...",
  "Lainey's future career, based on her parents...",
  "The one rule Cooper and Michelle will immediately break as parents...",
  "What Lainey is already plotting from the womb...",
  "The song Cooper will embarrassingly sing to Lainey at 3am...",
  "Michelle's search history in the first week home from the hospital...",
  "Cooper's search history in the first week home from the hospital...",
  "The thing nobody warned Cooper and Michelle about...",
  "Lainey's first Halloween costume, chosen by Cooper...",
  "Lainey's first Halloween costume, chosen by Michelle...",
  "What Lainey will tell her therapist about her parents someday...",
  "Lainey's first sentence will be a complaint about...",
  "The thing Cooper will try to automate about parenting first...",
  "The Canopy AI solution Cooper will try to sell to other new dads...",
  "Michelle will manage Lainey like a Smoky Mountain vacation rental, which means...",
  "The ClickUp task Michelle creates for Cooper on day one...",
  "Lainey's first property listing will describe her as...",
  "The Hospitable automated message Michelle sends to Lainey at bedtime...",
  "The worst baby name ever thought up...",
  "What babies are really saying when they cry...",
  "The thing nobody tells you about having a baby...",
  "A lullaby that would definitely NOT work...",
  "The most useless item in any diaper bag...",
  "What the baby is plotting at 3am...",
  "A rejected slogan for baby formula...",
  "What new parents miss most about sleep...",
  "The one thing you should never say to a new mom...",
  "The worst advice anyone has ever given about babies...",
]

// Prompts are stored as { text, submittedBy } objects
const DEFAULT_PROMPTS = DEFAULT_QUIPLASH.map(text => ({ text, submittedBy: 'Default' }))

const DEFAULT_TRIVIA = [
  "Where did Cooper and Michelle have their first date?",
  "Who said 'I love you' first?",
  "How did Cooper propose?",
  "Where did the proposal happen?",
  "What is Michelle's favorite movie?",
  "What is Cooper's most annoying habit according to Michelle?",
  "What is Michelle's most annoying habit according to Cooper?",
  "Who is the better cook?",
  "What is Cooper's go-to order at a restaurant?",
  "What was the first trip they took together?",
  "Who cried first when they found out they were pregnant?",
  "What did Cooper say when he found out it was a girl?",
  "What is Michelle's love language?",
  "What is Cooper's love language?",
  "Who takes longer to get ready?",
  "Who is more likely to get lost without GPS?",
  "What show are they currently watching together?",
  "Who initiated the first kiss?",
  "What is Lainey's due date?",
  "What name did they almost name Lainey before settling on Lainey?",
]

const DEFAULT_TRIVIA_QUESTIONS = DEFAULT_TRIVIA.map((question, i) => ({
  id: `default-trivia-${i}`,
  question,
  cooperAnswer: '???',
  michelleAnswer: '???',
}))

const INITIAL_STATE = {
  phase: 'lobby',
  players: [],
  scores: {},         // { playerName: tokenCount }
  lastRoundTokens: {}, // { playerName: tokensEarnedThisRound } — for animation

  quiplash: {
    prompts: [...DEFAULT_PROMPTS],
    usedPrompts: [],
    currentPrompt: null,
    answers: {},       // { playerName: answer }
    votes: {},         // { voterName: [answerPlayerName, ...] }
    judgeVotes: {},    // { 'cooper'|'michelle': [answerPlayerName, ...] }
    roundStart: null,
    round: 0,
    phase2: 'answering', // 'answering' | 'voting' | 'scored'
  },

  tyk: {
    cooperQuestions: [],
    michelleQuestions: [],
    currentQuestion: null,
    guesses: {},
    realAnswer: null,
    votes: {},         // { voterName: guessPlayerName }
    judgeVotes: {},    // { 'cooper'|'michelle': guessPlayerName }
    revealedIds: [],
    round: 0,
    roundStart: null,
    phase2: 'guessing',
  },

  trivia: {
    questions: [...DEFAULT_TRIVIA_QUESTIONS],
    currentIdx: null,
    guesses: {},
    revealedIdx: [],
    round: 0,
    roundStart: null,
  },

  qa: {
    questions: [],
  },
}

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
    if (!r.ok) return undefined // network/auth error — don't overwrite
    const data = await r.json()
    if (data && data[0]) return JSON.parse(data[0].value)
    return null // table empty — safe to initialize
  } catch { return undefined } // error — don't overwrite
}

async function saveState(s) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); return }
  try {
    await fetch(`${url}/rest/v1/game_state`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'main', value: JSON.stringify(s) })
    })
  } catch {}
}

const uid = () => Math.random().toString(36).slice(2, 9)
const promptText = (p) => (p && typeof p === 'object' ? p.text : p) || ''
const promptBy = (p) => (p && typeof p === 'object' ? p.submittedBy : null)

function migrateState(s) {
  if (!s) return null
  try {
    if (!s.tyk) s.tyk = JSON.parse(JSON.stringify(INITIAL_STATE.tyk))
    if (!s.qa) s.qa = JSON.parse(JSON.stringify(INITIAL_STATE.qa))
    if (!s.scores) s.scores = {}
    if (!s.lastRoundTokens) s.lastRoundTokens = {}
    if (!s.quiplash) s.quiplash = JSON.parse(JSON.stringify(INITIAL_STATE.quiplash))
    if (!s.quiplash.votes) s.quiplash.votes = {}
    if (!s.quiplash.judgeVotes) s.quiplash.judgeVotes = {}
    if (!s.quiplash.phase2) s.quiplash.phase2 = 'answering'
    if (!s.quiplash.prompts || !Array.isArray(s.quiplash.prompts) || s.quiplash.prompts.length === 0) s.quiplash.prompts = [...DEFAULT_PROMPTS]
    if (!s.quiplash.usedPrompts) s.quiplash.usedPrompts = []
    if (!s.tyk.votes) s.tyk.votes = {}
    if (!s.tyk.judgeVotes) s.tyk.judgeVotes = {}
    if (!s.tyk.cooperQuestions) s.tyk.cooperQuestions = []
    if (!s.tyk.michelleQuestions) s.tyk.michelleQuestions = []
    if (!s.tyk.revealedIds) s.tyk.revealedIds = []
    if (!s.trivia) s.trivia = JSON.parse(JSON.stringify(INITIAL_STATE.trivia))
    if (!s.trivia.questions || !Array.isArray(s.trivia.questions)) s.trivia.questions = [...DEFAULT_TRIVIA_QUESTIONS]
    if (!s.trivia.revealedIdx) s.trivia.revealedIdx = []
    if (!s.players || !Array.isArray(s.players)) s.players = []
    if (s.wknwb && s.tyk.cooperQuestions.length === 0) s.tyk.cooperQuestions = (s.wknwb.submittedQuestions || [])
    // migrate string prompts to objects
    if (s.quiplash.prompts.length > 0 && typeof s.quiplash.prompts[0] === 'string') {
      s.quiplash.prompts = s.quiplash.prompts.map(p => ({ text: p, submittedBy: DEFAULT_QUIPLASH.includes(p) ? 'Default' : 'Host' }))
    }
    if (s.quiplash.usedPrompts.length > 0 && typeof s.quiplash.usedPrompts[0] === 'string') {
      s.quiplash.usedPrompts = s.quiplash.usedPrompts.map(p => ({ text: p, submittedBy: 'Host' }))
    }
    if (s.quiplash.currentPrompt && typeof s.quiplash.currentPrompt === 'string') {
      s.quiplash.currentPrompt = { text: s.quiplash.currentPrompt, submittedBy: 'Host' }
    }
    return s
  } catch(e) {
    console.error('Migration error:', e)
    return null
  }
}

// ── SCORING HELPERS ────────────────────────────────────────────────────────
function computeQuiplashTokens(answers, votes, judgeVotes) {
  // votes: { voterName: [playerName, ...] }
  // judgeVotes: { cooper: [playerName], michelle: [playerName] }
  const tokens = {}
  Object.keys(answers).forEach(p => { tokens[p] = 0 })

  Object.values(votes).forEach(voted => {
    if (Array.isArray(voted)) voted.forEach(p => { if (tokens[p] !== undefined) tokens[p] += 100 })
  })
  Object.values(judgeVotes).forEach(voted => {
    if (Array.isArray(voted)) voted.forEach(p => { if (tokens[p] !== undefined) tokens[p] += 200 })
  })
  return tokens
}

function computeTykTokens(guesses, votes, judgeVotes) {
  // votes: { voterName: playerName }  (one choice per voter)
  // judgeVotes: { cooper: playerName, michelle: playerName }
  const tokens = {}
  Object.keys(guesses).forEach(p => { tokens[p] = 0 })

  Object.values(votes).forEach(chosen => { if (tokens[chosen] !== undefined) tokens[chosen] += 100 })
  Object.values(judgeVotes).forEach(chosen => { if (tokens[chosen] !== undefined) tokens[chosen] += 200 })
  return tokens
}

export default function App() {
  const [state, setState] = useState(null)
  const [view, setView] = useState('join')
  const [isHost, setIsHost] = useState(false)
  const [isJudge, setIsJudge] = useState(false) // Cooper or Michelle
  const [judgeName, setJudgeName] = useState('') // 'Cooper' | 'Michelle'
  const [playerName, setPlayerName] = useState('')
  const [joined, setJoined] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [hasVoted, setHasVoted] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [pinMode, setPinMode] = useState('host') // 'host' | 'judge'
  const [timerPct, setTimerPct] = useState(100)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [animatingTokens, setAnimatingTokens] = useState({}) // { playerName: tokens }
  const stateRef = useRef(state)
  stateRef.current = state

  const refresh = useCallback(async () => {
    const raw = await loadState()
    if (raw === undefined) return // network/auth error — don't touch state
    if (raw === null) {
      // No row in Supabase — initialize fresh
      setState(INITIAL_STATE)
      saveState(INITIAL_STATE)
      return
    }
    const s = migrateState(raw)
    if (!s) return // migration failed — don't touch state
    setState(prev => {
      if (JSON.stringify(prev) === JSON.stringify(s)) return prev
      return s
    })
  }, [])

  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t) }, [refresh])

  const prevPhase = useRef(null)
  useEffect(() => {
    if (!state) return
    if (state.phase !== prevPhase.current) {
      if (state.phase.endsWith('-round')) { setHasSubmitted(false); setHasVoted(false) }
      if (state.phase.endsWith('-reveal') || state.phase === 'quiplash-vote') { setHasVoted(false) }
      prevPhase.current = state.phase
    }
  }, [state?.phase])

  // Token animation trigger
  const prevLastRound = useRef({})
  useEffect(() => {
    if (!state?.lastRoundTokens) return
    if (JSON.stringify(state.lastRoundTokens) !== JSON.stringify(prevLastRound.current)) {
      prevLastRound.current = state.lastRoundTokens
      if (Object.keys(state.lastRoundTokens).length > 0) {
        setAnimatingTokens(state.lastRoundTokens)
        setShowLeaderboard(true)
        setTimeout(() => setAnimatingTokens({}), 2500)
      }
    }
  }, [state?.lastRoundTokens])

  useEffect(() => {
    if (!state) return
    const roundStart = state.quiplash?.roundStart || state.tyk?.roundStart || state.trivia?.roundStart
    if (state.phase.endsWith('-round') && roundStart) {
      const t = setInterval(() => {
        const elapsed = Date.now() - roundStart
        setTimerPct(Math.max(0, ((ROUND_SECS * 1000 - elapsed) / (ROUND_SECS * 1000)) * 100))
      }, 500)
      return () => clearInterval(t)
    } else { setTimerPct(100) }
  }, [state?.phase, state?.quiplash?.roundStart, state?.tyk?.roundStart, state?.trivia?.roundStart])

  const update = async (updater) => {
    const fresh = migrateState(await loadState()) || stateRef.current || INITIAL_STATE
    const next = updater(JSON.parse(JSON.stringify(fresh)))
    setState(next)
    await saveState(next)
  }

  const hostLogin = () => {
    if (pinMode === 'host' && pinInput === HOST_PIN) { setIsHost(true); setView('host') }
    else if (pinMode === 'judge' && pinInput === JUDGE_PIN) { setIsJudge(true); setView('judge') }
    else { setPinError(true); setTimeout(() => setPinError(false), 1500) }
    setPinInput('')
  }

  const selectGame = (game) => update(s => { s.activeGame = game; s.phase = `${game}-host`; return s })

  const resetAll = () => update(s => {
    const fresh = JSON.parse(JSON.stringify(INITIAL_STATE))
    fresh.players = s.players
    fresh.scores = s.scores
    fresh.quiplash.prompts = s.quiplash.prompts
    fresh.trivia.questions = s.trivia.questions.length > 0 ? s.trivia.questions : [...DEFAULT_TRIVIA_QUESTIONS]
    fresh.tyk.cooperQuestions = s.tyk.cooperQuestions
    fresh.tyk.michelleQuestions = s.tyk.michelleQuestions
    fresh.qa.questions = s.qa.questions
    return fresh
  })

  const resetScores = () => update(s => { s.scores = {}; s.lastRoundTokens = {}; return s })

  // QUIPLASH HOST
  const startQuiplashRound = () => update(s => {
    const used = s.quiplash.usedPrompts || []
    const usedTexts = used.map(p => p.text || p)
    const pool = s.quiplash.prompts.filter(p => !usedTexts.includes(p.text || p))
    const src = pool.length > 0 ? pool : s.quiplash.prompts
    const prompt = src[Math.floor(Math.random() * src.length)]
    s.quiplash = { ...s.quiplash, currentPrompt: prompt, answers: {}, votes: {}, judgeVotes: {}, round: (s.quiplash.round || 0) + 1, roundStart: Date.now(), usedPrompts: [...used, prompt], phase2: 'answering' }
    s.lastRoundTokens = {}
    s.phase = 'quiplash-round'
    return s
  })

  const openQuiplashVoting = () => update(s => { s.quiplash.phase2 = 'voting'; s.phase = 'quiplash-vote'; return s })

  const scoreQuiplash = () => update(s => {
    const earned = computeQuiplashTokens(s.quiplash.answers, s.quiplash.votes, s.quiplash.judgeVotes)
    Object.entries(earned).forEach(([p, t]) => { s.scores[p] = (s.scores[p] || 0) + t })
    s.lastRoundTokens = earned
    s.quiplash.phase2 = 'scored'
    s.phase = 'quiplash-reveal'
    return s
  })

  const nextQuiplash = () => update(s => { s.quiplash.answers = {}; s.quiplash.votes = {}; s.quiplash.judgeVotes = {}; s.phase = 'quiplash-host'; return s })

  // TYK HOST
  const startTykRound = (target) => update(s => {
    const pool = target === 'cooper'
      ? s.tyk.cooperQuestions.filter(q => !s.tyk.revealedIds.includes(q.id))
      : s.tyk.michelleQuestions.filter(q => !s.tyk.revealedIds.includes(q.id))
    if (!pool.length) return s
    const q = pool[Math.floor(Math.random() * pool.length)]
    s.tyk = { ...s.tyk, currentQuestion: { ...q, target }, guesses: {}, votes: {}, judgeVotes: {}, realAnswer: null, round: (s.tyk.round || 0) + 1, roundStart: Date.now(), phase2: 'guessing' }
    s.lastRoundTokens = {}
    s.phase = 'tyk-round'
    return s
  })

  const openTykVoting = () => update(s => { s.tyk.phase2 = 'voting'; s.phase = 'tyk-vote'; return s })

  const setTykRealAnswer = (answer) => update(s => {
    s.tyk.realAnswer = answer
    if (s.tyk.currentQuestion) s.tyk.revealedIds.push(s.tyk.currentQuestion.id)
    return s
  })

  const scoreTyk = () => update(s => {
    const earned = computeTykTokens(s.tyk.guesses, s.tyk.votes, s.tyk.judgeVotes)
    Object.entries(earned).forEach(([p, t]) => { s.scores[p] = (s.scores[p] || 0) + t })
    s.lastRoundTokens = earned
    s.tyk.phase2 = 'scored'
    s.phase = 'tyk-reveal'
    return s
  })

  const nextTyk = () => update(s => { s.tyk.guesses = {}; s.tyk.votes = {}; s.tyk.judgeVotes = {}; s.tyk.realAnswer = null; s.phase = 'tyk-host'; return s })

  // TRIVIA
  const startTriviaRound = () => update(s => {
    const unrevealed = s.trivia.questions.map((_, i) => i).filter(i => !s.trivia.revealedIdx.includes(i))
    if (!unrevealed.length) return s
    const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)]
    s.trivia = { ...s.trivia, currentIdx: idx, guesses: {}, round: (s.trivia.round || 0) + 1, roundStart: Date.now() }
    s.lastRoundTokens = {}
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
  const joinGame = (name) => { update(s => { if (!s.players.includes(name)) s.players.push(name); if (!s.scores[name]) s.scores[name] = 0; return s }); setPlayerName(name); setJoined(true) }
  const submitQuiplash = (answer) => { update(s => { s.quiplash.answers[playerName] = answer; return s }); setHasSubmitted(true) }
  const submitTykGuess = (answer) => { update(s => { s.tyk.guesses[playerName] = answer; return s }); setHasSubmitted(true) }
  const submitTrivia = (answer) => { update(s => { s.trivia.guesses[playerName] = answer; return s }); setHasSubmitted(true) }

  // VOTING — quiplash: multi-select, tyk: single pick
  const voteQuiplash = (chosenPlayers) => {
    update(s => { s.quiplash.votes[playerName] = chosenPlayers; return s })
    setHasVoted(true)
  }
  const voteTyk = (chosenPlayer) => {
    update(s => { s.tyk.votes[playerName] = chosenPlayer; return s })
    setHasVoted(true)
  }

  // JUDGE VOTES
  const judgeVoteQuiplash = (jName, chosenPlayers) => {
    update(s => { s.quiplash.judgeVotes[jName.toLowerCase()] = chosenPlayers; return s })
  }
  const judgeVoteTyk = (jName, chosenPlayer) => {
    update(s => { s.tyk.judgeVotes[jName.toLowerCase()] = chosenPlayer; return s })
  }

  // LOBBY SUBMISSIONS
  const submitCooperQuestion = (text) => update(s => { s.tyk.cooperQuestions.push({ id: uid(), text, submittedBy: playerName }); return s })
  const submitMichelleQuestion = (text) => update(s => { s.tyk.michelleQuestions.push({ id: uid(), text, submittedBy: playerName }); return s })
  const submitQA = (text) => update(s => { s.qa.questions.push({ id: uid(), text, submittedBy: playerName }); return s })

  // HOST MGMT
  const addQuiplashPrompt = (text, submittedBy) => update(s => { s.quiplash.prompts.push({ text, submittedBy: submittedBy || 'Host' }); return s })
  const removeQuiplashPrompt = (text) => update(s => { s.quiplash.prompts = s.quiplash.prompts.filter(p => (p.text || p) !== text); return s })
  const addTriviaQuestion = (q, ca, ma) => update(s => { s.trivia.questions.push({ id: uid(), question: q, cooperAnswer: ca, michelleAnswer: ma }); return s })
  const removeTriviaQuestion = (id) => update(s => { s.trivia.questions = s.trivia.questions.filter(q => q.id !== id); return s })
  const removeCooperQuestion = (id) => update(s => { s.tyk.cooperQuestions = s.tyk.cooperQuestions.filter(q => q.id !== id); return s })
  const removeMichelleQuestion = (id) => update(s => { s.tyk.michelleQuestions = s.tyk.michelleQuestions.filter(q => q.id !== id); return s })
  const markQAAnswered = (id, answeredBy, answer) => update(s => { const q = s.qa.questions.find(q => q.id === id); if (q) { q.answeredBy = answeredBy; q.answer = answer }; return s })
  const removeQA = (id) => update(s => { s.qa.questions = s.qa.questions.filter(q => q.id !== id); return s })

  const generateAIPrompts = async () => {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: 'Generate 8 funny creative Quiplash-style open-ended prompts for a baby shower for Cooper and Michelle. Appropriate for mixed adults. Return ONLY a JSON array of strings, no markdown.' }] })
      })
      const data = await resp.json()
      const prompts = JSON.parse(data.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim())
      if (Array.isArray(prompts)) { update(s => { s.quiplash.prompts = [...s.quiplash.prompts, ...prompts.map(t => ({ text: t, submittedBy: 'AI' }))]; return s }); return prompts.length }
    } catch {}
    return 0
  }

  if (!state) return <div className="app"><div className="main" style={{ textAlign: 'center', paddingTop: 80 }}>🍼 Loading...</div></div>

  const appUrl = window.location.href.split('?')[0]
  const phase = state.phase

  return (
    <div className="app">
      <nav className="nav no-print">
        <div className="nav-title">Lainey's Baby Shower</div>
        <div className="nav-tabs">
          <button className={`nav-tab ${view === 'join' ? 'active' : ''}`} onClick={() => setView('join')}>{joined ? 'Play' : 'Join'}</button>
          <button className={`nav-tab ${view === 'qa' ? 'active' : ''}`} onClick={() => setView('qa')}>Ask</button>
          <button className={`nav-tab ${view === 'scores' ? 'active' : ''}`} onClick={() => setView('scores')}>Scores</button>
          <button className={`nav-tab ${view === 'host' || view === 'pin' ? 'active' : ''}`} onClick={() => { setPinMode('host'); isHost ? setView('host') : setView('pin') }}>Host</button>
          <button className={`nav-tab ${view === 'judge' ? 'active' : ''}`} onClick={() => { setPinMode('judge'); isJudge ? setView('judge') : setView('pin') }}>Judge</button>
          <button className={`nav-tab ${view === 'photos' ? 'active' : ''}`} onClick={() => setView('photos')}>Photos</button>
          <button className={`nav-tab ${view === 'qr' ? 'active' : ''}`} onClick={() => setView('qr')}>QR</button>
        </div>
      </nav>

      {/* LEADERBOARD OVERLAY — shows after each scored round */}
      {showLeaderboard && view !== 'scores' && Object.keys(state.lastRoundTokens || {}).some(p => state.lastRoundTokens[p] > 0) && (
        <LeaderboardOverlay state={state} animatingTokens={animatingTokens} onClose={() => setShowLeaderboard(false)} />
      )}

      <main className="main">
        {view === 'join' && <JoinView state={state} joined={joined} playerName={playerName} hasSubmitted={hasSubmitted} hasVoted={hasVoted} timerPct={timerPct} onJoin={joinGame} onSubmitQuiplash={submitQuiplash} onVoteQuiplash={voteQuiplash} onSubmitTykGuess={submitTykGuess} onVoteTyk={voteTyk} onSubmitTrivia={submitTrivia} onSubmitCooperQuestion={submitCooperQuestion} onSubmitMichelleQuestion={submitMichelleQuestion} onAddQuiplashPrompt={addQuiplashPrompt} onSubmitQA={submitQA} />}
        {view === 'qa' && <QAView state={state} joined={joined} playerName={playerName} onSubmitQA={submitQA} />}
        {view === 'scores' && <ScoresView state={state} animatingTokens={animatingTokens} />}
        {view === 'pin' && <PinView pinInput={pinInput} setPinInput={setPinInput} pinError={pinError} pinMode={pinMode} onLogin={hostLogin} />}
        {view === 'host' && isHost && <HostView state={state} timerPct={timerPct} playerCount={state.players.length} onSelectGame={selectGame} onResetAll={resetAll} onResetScores={resetScores} onStartQuiplash={startQuiplashRound} onOpenQuiplashVoting={openQuiplashVoting} onScoreQuiplash={scoreQuiplash} onNextQuiplash={nextQuiplash} onStartTyk={startTykRound} onOpenTykVoting={openTykVoting} onSetTykRealAnswer={setTykRealAnswer} onScoreTyk={scoreTyk} onNextTyk={nextTyk} onStartTrivia={startTriviaRound} onRevealTrivia={revealTrivia} onNextTrivia={nextTrivia} onAddQuiplashPrompt={addQuiplashPrompt} onRemoveQuiplashPrompt={removeQuiplashPrompt} onAddTriviaQuestion={addTriviaQuestion} onRemoveTriviaQuestion={removeTriviaQuestion} onRemoveCooperQuestion={removeCooperQuestion} onRemoveMichelleQuestion={removeMichelleQuestion} onMarkQAAnswered={markQAAnswered} onRemoveQA={removeQA} onGenerateAI={generateAIPrompts} />}
        {view === 'judge' && isJudge && <JudgeView state={state} judgeName={judgeName} setJudgeName={setJudgeName} onJudgeVoteQuiplash={judgeVoteQuiplash} onJudgeVoteTyk={judgeVoteTyk} />}
        {view === 'photos' && <PhotosView isHost={isHost} isJudge={isJudge} />}
        {view === 'qr' && <QRView appUrl={appUrl} />}
      </main>
    </div>
  )
}

// ── LEADERBOARD OVERLAY ────────────────────────────────────────────────────
function LeaderboardOverlay({ state, animatingTokens, onClose }) {
  const sorted = Object.entries(state.scores || {}).sort((a, b) => b[1] - a[1])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,31,46,0.92)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--warm-gold)', marginBottom: 24, textAlign: 'center' }}>
        🏆 Round Tokens
      </div>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {sorted.map(([name, total], i) => {
          const earned = animatingTokens[name] || 0
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '12px 18px' }}>
              <div style={{ fontSize: 18, color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'rgba(255,255,255,0.3)', width: 28, textAlign: 'center', fontFamily: 'var(--font-display)' }}>{i + 1}</div>
              <div style={{ flex: 1, color: '#fff', fontSize: 16, fontWeight: 600 }}>{name}</div>
              {earned > 0 && (
                <div style={{ fontSize: 13, color: 'var(--warm-gold)', fontWeight: 700, animation: 'tokenPop 0.4s ease-out' }}>+{earned} 🪙</div>
              )}
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warm-gold)', minWidth: 60, textAlign: 'right' }}>{total} 🪙</div>
            </div>
          )
        })}
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 24, color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onClose}>Continue</button>
      <style>{`@keyframes tokenPop { 0% { transform: scale(0) translateY(-10px); opacity:0 } 60% { transform: scale(1.3); opacity:1 } 100% { transform: scale(1); opacity:1 } }`}</style>
    </div>
  )
}

// ── SCORES VIEW ────────────────────────────────────────────────────────────
function ScoresView({ state, animatingTokens }) {
  const sorted = Object.entries(state.scores || {}).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return (
    <div className="hero" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🏆</div>
      <h1>No scores <em>yet</em></h1>
      <p className="hero-sub">Tokens appear after rounds are scored</p>
    </div>
  )
  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Leaderboard</div>
        <h1><em>Token</em> Standings</h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map(([name, total], i) => {
          const earned = animatingTokens[name] || 0
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 14, background: i === 0 ? 'linear-gradient(135deg, #FFF8DC, #FDF6EE)' : 'var(--surface)', border: `1px solid ${i === 0 ? '#E8C547' : 'var(--border)'}`, borderRadius: 16, padding: '16px 20px' }}>
              <div style={{ fontSize: 22, minWidth: 32, textAlign: 'center' }}>{medal}</div>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 17 }}>{name}</div>
              {earned > 0 && <div style={{ fontSize: 13, color: 'var(--gold-dark)', fontWeight: 700, animation: 'tokenPop 0.4s ease-out' }}>+{earned} 🪙</div>}
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--gold-dark)', fontWeight: 700 }}>{total} 🪙</div>
            </div>
          )
        })}
      </div>
      <style>{`@keyframes tokenPop { 0% { transform: scale(0); opacity:0 } 60% { transform: scale(1.3); opacity:1 } 100% { transform: scale(1); opacity:1 } }`}</style>
    </>
  )
}

// ── JUDGE VIEW ─────────────────────────────────────────────────────────────
function JudgeView({ state, judgeName, setJudgeName, onJudgeVoteQuiplash, onJudgeVoteTyk }) {
  const [selectedQuiplash, setSelectedQuiplash] = useState([])
  const [selectedTyk, setSelectedTyk] = useState(null)
  const [judgeSubmitted, setJudgeSubmitted] = useState(false)
  const phase = state.phase

  const prevPhase = useRef(null)
  useEffect(() => {
    if (phase !== prevPhase.current) { setSelectedQuiplash([]); setSelectedTyk(null); setJudgeSubmitted(false); prevPhase.current = phase }
  }, [phase])

  if (!judgeName) {
    return (
      <div style={{ maxWidth: 340, margin: '60px auto' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⭐</div>
          <div className="card-title" style={{ marginBottom: 4 }}>Who are you?</div>
          <p className="card-sub">Select your name to judge</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-sage" style={{ flex: 1 }} onClick={() => setJudgeName('Cooper')}>🔵 Cooper</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setJudgeName('Michelle')}>🌸 Michelle</button>
          </div>
        </div>
      </div>
    )
  }

  const judgeKey = judgeName.toLowerCase()

  if (phase === 'quiplash-vote') {
    const answers = state.quiplash?.answers || {}
    const myExistingVotes = state.quiplash?.judgeVotes?.[judgeKey] || []
    const active = judgeSubmitted ? myExistingVotes : selectedQuiplash

    const togglePick = (player) => {
      setSelectedQuiplash(prev => prev.includes(player) ? prev.filter(p => p !== player) : [...prev, player])
    }

    return (
      <>
        <div className="hero">
          <div className="hero-eyebrow">Judge — {judgeName}</div>
          <h1>Pick your <em>favorites</em></h1>
          <p className="hero-sub">Choose as many as you like. Each pick gives 200 tokens.</p>
        </div>
        <div className="card">
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{promptText(state.quiplash?.currentPrompt)}</div>
          {Object.entries(answers).map(([player, ans]) => (
            <div key={player} onClick={() => !judgeSubmitted && togglePick(player)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: `2px solid ${active.includes(player) ? 'var(--warm-gold)' : 'var(--border)'}`, marginBottom: 10, cursor: judgeSubmitted ? 'default' : 'pointer', background: active.includes(player) ? '#FFF8DC' : 'var(--cream)', transition: 'all 0.15s' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{player}</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{ans}</div>
              </div>
              {active.includes(player) && <div style={{ fontSize: 20 }}>⭐</div>}
            </div>
          ))}
          {!judgeSubmitted
            ? <button className="btn btn-gold btn-block" disabled={selectedQuiplash.length === 0} onClick={() => { onJudgeVoteQuiplash(judgeName, selectedQuiplash); setJudgeSubmitted(true) }}>Submit Judge Picks ⭐</button>
            : <div className="submitted-state"><div className="big">⭐</div><p>Picks submitted! The host will score the round.</p></div>
          }
        </div>
      </>
    )
  }

  if (phase === 'tyk-vote') {
    const guesses = state.tyk?.guesses || {}
    const q = state.tyk?.currentQuestion
    const realAnswer = state.tyk?.realAnswer
    const myPick = judgeSubmitted ? state.tyk?.judgeVotes?.[judgeKey] : selectedTyk

    return (
      <>
        <div className="hero">
          <div className="hero-eyebrow">Judge — {judgeName}</div>
          <h1>Pick the <em>best guess</em></h1>
          <p className="hero-sub">Pick the guess closest to your real answer. Worth 200 tokens.</p>
        </div>
        <div className="card">
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{q?.target === 'cooper' ? '🔵 Cooper answers:' : '🌸 Michelle answers:'}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 16 }}>{q?.text}</div>
          {realAnswer && <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '10px 14px', borderLeft: '3px solid var(--dusty-rose)', marginBottom: 16 }}><div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Your real answer</div><div style={{ fontSize: 16, fontWeight: 600 }}>{realAnswer}</div></div>}
          {Object.entries(guesses).map(([player, guess]) => (
            <div key={player} onClick={() => !judgeSubmitted && setSelectedTyk(player)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: `2px solid ${myPick === player ? 'var(--warm-gold)' : 'var(--border)'}`, marginBottom: 10, cursor: judgeSubmitted ? 'default' : 'pointer', background: myPick === player ? '#FFF8DC' : 'var(--cream)', transition: 'all 0.15s' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{player}</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{guess}</div>
              </div>
              {myPick === player && <div style={{ fontSize: 20 }}>⭐</div>}
            </div>
          ))}
          {!judgeSubmitted
            ? <button className="btn btn-gold btn-block" disabled={!selectedTyk} onClick={() => { onJudgeVoteTyk(judgeName, selectedTyk); setJudgeSubmitted(true) }}>Submit Judge Pick ⭐</button>
            : <div className="submitted-state"><div className="big">⭐</div><p>Pick submitted!</p></div>
          }
        </div>
      </>
    )
  }

  return (
    <div style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⭐</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--dusty-rose)', marginBottom: 8 }}>Judging as {judgeName}</div>
      <p style={{ color: 'var(--muted)', fontSize: 15 }}>Waiting for voting to open...</p>
    </div>
  )
}

// ── JOIN VIEW ──────────────────────────────────────────────────────────────
function JoinView({ state, joined, playerName, hasSubmitted, hasVoted, timerPct, onJoin, onSubmitQuiplash, onVoteQuiplash, onSubmitTykGuess, onVoteTyk, onSubmitTrivia, onSubmitCooperQuestion, onSubmitMichelleQuestion, onAddQuiplashPrompt, onSubmitQA }) {
  const [nameInput, setNameInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [tykAns, setTykAns] = useState('')
  const [triviaAns, setTriviaAns] = useState('')
  const [cooperQ, setCooperQ] = useState('')
  const [michelleQ, setMichelleQ] = useState('')
  const [cooperQDone, setCooperQDone] = useState(false)
  const [michelleQDone, setMichelleQDone] = useState(false)
  const [quiplashPrompt, setQuiplashPrompt] = useState('')
  const [quiplashPromptDone, setQuiplashPromptDone] = useState(false)
  const [qaQuestion, setQaQuestion] = useState('')
  const [qaQuestionDone, setQaQuestionDone] = useState(false)
  const [selectedVotes, setSelectedVotes] = useState([])
  const [selectedTykVote, setSelectedTykVote] = useState(null)
  const phase = state.phase

  if (!joined) {
    return (
      <>
        <div className="hero">
          <div className="hero-eyebrow">Baby Shower Games</div>
          <h1>Welcome to <em>Lainey's</em><br />Baby Shower</h1>
          <p className="hero-sub">Enter your name to join the fun</p>
        </div>
        <div className="card">
          <div className="field"><label>Your Name</label><input className="input" placeholder="e.g. Grandma Karen..." value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && nameInput.trim() && onJoin(nameInput.trim())} autoFocus /></div>
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
          <div className="card-title">Test Their Knowledge 🧠</div>
          <p className="card-sub">Submit a question for Cooper and Michelle to answer about each other</p>
          <div style={{ marginBottom: 8 }}>
            {cooperQDone ? <div style={{ textAlign: 'center', padding: '8px 0' }}><span style={{ color: 'var(--sage-dark)', fontWeight: 600 }}>✅ Submitted!</span> <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setCooperQ(''); setCooperQDone(false) }}>Add another</button></div>
              : <div style={{ display: 'flex', gap: 8 }}><input className="input" style={{ flex: 1 }} placeholder="e.g. What is your biggest fear as a parent?" value={cooperQ} onChange={e => setCooperQ(e.target.value)} /><button className="btn btn-sage btn-sm" disabled={!cooperQ.trim()} onClick={() => { onSubmitCooperQuestion(cooperQ.trim()); setCooperQDone(true) }}>Add</button></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Ask Anything 💌</div>
          <p className="card-sub">Ask Cooper and Michelle anything!</p>
          {qaQuestionDone
            ? <div style={{ textAlign: 'center', padding: '8px 0' }}><span style={{ color: 'var(--sage-dark)', fontWeight: 600 }}>✅ Submitted!</span> <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setQaQuestion(''); setQaQuestionDone(false) }}>Ask another</button></div>
            : <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="e.g. What are you most excited about?" value={qaQuestion} onChange={e => setQaQuestion(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={!qaQuestion.trim()} onClick={() => { onSubmitQA(qaQuestion.trim()); setQaQuestionDone(true) }}>Add</button>
            </div>
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

  // QUIPLASH ANSWER
  if (phase === 'quiplash-round') {
    if (hasSubmitted) return <SubmittedCard message="Answer locked in! Waiting for voting to open..." />
    return (
      <>
        <div className="prompt-display"><div className="round-label">Round {state.quiplash.round} — Quiplash</div><div className="prompt-text">{promptText(state.quiplash.currentPrompt)}</div>{promptBy(state.quiplash.currentPrompt) && promptBy(state.quiplash.currentPrompt) !== 'Default' && <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:6}}>submitted by {promptBy(state.quiplash.currentPrompt)}</div>}</div>
        <div className="card">
          <div className="field"><label>Your funniest answer</label><textarea className="input" placeholder="Type your answer..." value={answer} onChange={e => setAnswer(e.target.value)} maxLength={200} autoFocus /></div>
          <button className="btn btn-primary btn-block" disabled={!answer.trim()} onClick={() => { onSubmitQuiplash(answer.trim()); setAnswer('') }}>Submit ✨</button>
        </div>
        <TimerBar pct={timerPct} />
      </>
    )
  }

  // QUIPLASH VOTE
  if (phase === 'quiplash-vote') {
    const answers = state.quiplash?.answers || {}
    const myAnswers = Object.entries(answers).filter(([p]) => p !== playerName)
    if (hasVoted) return <SubmittedCard icon="🗳️" message="Votes locked in! Waiting for judges and host..." />
    const toggle = (p) => setSelectedVotes(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
    return (
      <>
        <div className="prompt-display"><div className="round-label">Vote — Quiplash</div><div className="prompt-text">{promptText(state.quiplash.currentPrompt)}</div></div>
        <div className="card">
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>Pick your favorites. Each vote gives that player 100 🪙</p>
          {myAnswers.map(([player, ans]) => (
            <div key={player} onClick={() => toggle(player)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: `2px solid ${selectedVotes.includes(player) ? 'var(--dusty-rose)' : 'var(--border)'}`, marginBottom: 10, cursor: 'pointer', background: selectedVotes.includes(player) ? '#FEF5F7' : 'var(--cream)', transition: 'all 0.15s' }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 600 }}>{ans}</div><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{player}</div></div>
              {selectedVotes.includes(player) && <div style={{ fontSize: 18 }}>❤️</div>}
            </div>
          ))}
          <button className="btn btn-primary btn-block" disabled={selectedVotes.length === 0} onClick={() => { onVoteQuiplash(selectedVotes); setSelectedVotes([]) }}>Lock In Votes 🗳️</button>
        </div>
      </>
    )
  }

  if (phase === 'quiplash-reveal') return <WaitCard icon="🎉" text="Look at the big screen for the scores!" />

  // TYK GUESS
  if (phase === 'tyk-round') {
    const q = state.tyk?.currentQuestion
    if (!q) return <WaitCard icon="⏳" text="Round starting..." />
    if (hasSubmitted) return <SubmittedCard message="Guess locked in! Voting opens next..." />
    return (
      <>
        <div className="prompt-display"><div className="round-label">Round {state.tyk.round} — Test Their Knowledge</div><div className="prompt-text">{q.text}</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>{q.target === 'cooper' ? '🔵 Cooper' : '🌸 Michelle'} will answer this</div></div>
        <div className="card">
          <div className="field"><label>What do you think they'll say?</label><input className="input" placeholder="Your guess..." value={tykAns} onChange={e => setTykAns(e.target.value)} autoFocus /></div>
          <button className="btn btn-primary btn-block" disabled={!tykAns.trim()} onClick={() => { onSubmitTykGuess(tykAns.trim()); setTykAns('') }}>Lock In Guess 🔒</button>
        </div>
        <TimerBar pct={timerPct} />
      </>
    )
  }

  // TYK VOTE
  if (phase === 'tyk-vote') {
    const guesses = state.tyk?.guesses || {}
    const q = state.tyk?.currentQuestion
    const othersGuesses = Object.entries(guesses).filter(([p]) => p !== playerName)
    if (hasVoted) return <SubmittedCard icon="🗳️" message="Vote locked in! Waiting for the judges..." />
    return (
      <>
        <div className="prompt-display"><div className="round-label">Vote — Test Their Knowledge</div><div className="prompt-text">{q?.text}</div></div>
        <div className="card">
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>Pick the best guess. Worth 100 🪙</p>
          {othersGuesses.map(([player, guess]) => (
            <div key={player} onClick={() => setSelectedTykVote(player)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: `2px solid ${selectedTykVote === player ? 'var(--dusty-rose)' : 'var(--border)'}`, marginBottom: 10, cursor: 'pointer', background: selectedTykVote === player ? '#FEF5F7' : 'var(--cream)', transition: 'all 0.15s' }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 600 }}>{guess}</div><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{player}</div></div>
              {selectedTykVote === player && <div style={{ fontSize: 18 }}>❤️</div>}
            </div>
          ))}
          <button className="btn btn-primary btn-block" disabled={!selectedTykVote} onClick={() => { onVoteTyk(selectedTykVote); setSelectedTykVote(null) }}>Lock In Vote 🗳️</button>
        </div>
      </>
    )
  }

  if (phase === 'tyk-host' || phase === 'tyk-reveal') return <WaitCard icon="🧠" text={phase === 'tyk-reveal' ? 'Look at the big screen!' : 'Test Their Knowledge — host is picking a question...'} />

  if (phase === 'trivia-host') return <WaitCard icon="🎯" text="Trivia — host is starting a round..." />
  if (phase === 'trivia-round') {
    const q = state.trivia.currentIdx !== null ? state.trivia.questions[state.trivia.currentIdx] : null
    if (!q) return <WaitCard icon="⏳" text="Round starting..." />
    if (hasSubmitted) return <SubmittedCard message="Guess locked in!" />
    return (
      <>
        <div className="prompt-display"><div className="round-label">Round {state.trivia.round} — Trivia</div><div className="prompt-text">{q.question}</div></div>
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
function HostView({ state, timerPct, playerCount, onSelectGame, onResetAll, onResetScores, onStartQuiplash, onOpenQuiplashVoting, onScoreQuiplash, onNextQuiplash, onStartTyk, onOpenTykVoting, onSetTykRealAnswer, onScoreTyk, onNextTyk, onStartTrivia, onRevealTrivia, onNextTrivia, onAddQuiplashPrompt, onRemoveQuiplashPrompt, onAddTriviaQuestion, onRemoveTriviaQuestion, onRemoveCooperQuestion, onRemoveMichelleQuestion, onMarkQAAnswered, onRemoveQA, onGenerateAI }) {
  const phase = state.phase
  if (phase === 'lobby' || phase === 'game-select') return <LobbyHostView state={state} playerCount={playerCount} onSelectGame={onSelectGame} onResetAll={onResetAll} onResetScores={onResetScores} onAddQuiplashPrompt={onAddQuiplashPrompt} onRemoveQuiplashPrompt={onRemoveQuiplashPrompt} onAddTriviaQuestion={onAddTriviaQuestion} onRemoveTriviaQuestion={onRemoveTriviaQuestion} onRemoveCooperQuestion={onRemoveCooperQuestion} onRemoveMichelleQuestion={onRemoveMichelleQuestion} onMarkQAAnswered={onMarkQAAnswered} onRemoveQA={onRemoveQA} onGenerateAI={onGenerateAI} />
  if (phase === 'quiplash-host') return <QuiplashHostView state={state} playerCount={playerCount} onStart={onStartQuiplash} onBack={onResetAll} />
  if (phase === 'quiplash-round') return <QuiplashRoundView state={state} timerPct={timerPct} playerCount={playerCount} onOpenVoting={onOpenQuiplashVoting} />
  if (phase === 'quiplash-vote') return <QuiplashVoteView state={state} playerCount={playerCount} onScore={onScoreQuiplash} />
  if (phase === 'quiplash-reveal') return <QuiplashRevealView state={state} onNext={onNextQuiplash} onDone={onResetAll} />
  if (phase === 'tyk-host') return <TykHostView state={state} playerCount={playerCount} onStart={onStartTyk} onBack={onResetAll} />
  if (phase === 'tyk-round') return <TykRoundView state={state} timerPct={timerPct} playerCount={playerCount} onOpenVoting={onOpenTykVoting} />
  if (phase === 'tyk-vote') return <TykVoteView state={state} playerCount={playerCount} onSetRealAnswer={onSetTykRealAnswer} onScore={onScoreTyk} />
  if (phase === 'tyk-reveal') return <TykRevealView state={state} onNext={onNextTyk} onDone={onResetAll} />
  if (phase === 'trivia-host') return <TriviaHostView state={state} playerCount={playerCount} onStart={onStartTrivia} onBack={onResetAll} />
  if (phase === 'trivia-round') return <TriviaRoundView state={state} timerPct={timerPct} playerCount={playerCount} onReveal={onRevealTrivia} />
  if (phase === 'trivia-reveal') return <TriviaRevealView state={state} onNext={onNextTrivia} onDone={onResetAll} />
  return null
}

// ── LOBBY HOST ─────────────────────────────────────────────────────────────
function LobbyHostView({ state, playerCount, onSelectGame, onResetAll, onResetScores, onAddQuiplashPrompt, onRemoveQuiplashPrompt, onAddTriviaQuestion, onRemoveTriviaQuestion, onRemoveCooperQuestion, onRemoveMichelleQuestion, onMarkQAAnswered, onRemoveQA, onGenerateAI }) {
  const [tab, setTab] = useState('quiplash')
  const [newPrompt, setNewPrompt] = useState('')
  const [triviaQ, setTriviaQ] = useState(''); const [cooperA, setCooperA] = useState(''); const [michelleA, setMichelleA] = useState('')
  const [genStatus, setGenStatus] = useState('')
  const [qaAnswerId, setQaAnswerId] = useState(null); const [qaAnswerText, setQaAnswerText] = useState(''); const [qaAnsweredBy, setQaAnsweredBy] = useState('Cooper')

  const handleGen = async () => { setGenStatus('Generating...'); const n = await onGenerateAI(); setGenStatus(n > 0 ? `Added ${n} prompts!` : 'Error.'); setTimeout(() => setGenStatus(''), 3000) }
  const customPrompts = state.quiplash.prompts.filter(p => (p.submittedBy || 'Default') !== 'Default')
  const cooperQs = state.tyk?.cooperQuestions || []
  const michelleQs = state.tyk?.michelleQuestions || []
  const qaQuestions = state.qa?.questions || []
  const pendingQA = qaQuestions.filter(q => !q.answeredBy)

  const tabs = [
    { id: 'quiplash', label: '😂 Quiplash' },
    { id: 'tyk', label: '🧠 Test Knowledge' },
    { id: 'trivia', label: '🎯 Trivia' },
    { id: 'qa', label: `💌 Q&A${pendingQA.length > 0 ? ` (${pendingQA.length})` : ''}` },
  ]

  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Host Dashboard</div>
        <h1>Cooper & <em>Michelle's</em><br />Baby Shower</h1>
        <p className="hero-sub">{playerCount} guest{playerCount !== 1 ? 's' : ''} joined · Judge PIN: <strong>baby</strong></p>
      </div>
      {state.players.length > 0 && <div className="player-list" style={{ marginBottom: 20 }}>{state.players.map(p => <span key={p} className="player-tag">{p} <span style={{ fontSize: 11, color: 'var(--gold-dark)' }}>{state.scores[p] || 0}🪙</span></span>)}</div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 14px', borderRadius: 40, border: 'none', fontSize: 13, fontWeight: 600, background: tab === t.id ? 'var(--dusty-rose)' : 'var(--cream)', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>{t.label}</button>)}
      </div>

      {tab === 'quiplash' && (
        <div className="card">
          <div className="card-title">Quiplash Prompts</div>
          <p className="card-sub">{state.quiplash.prompts.length} total · {customPrompts.length} custom</p>
          <div className="answer-scroll" style={{ marginBottom: 12 }}>
            {customPrompts.length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>12 built-in prompts active.</p>
              : customPrompts.map(p => <div key={p.text} className="list-item"><span className="li-text">{p.text} {p.submittedBy && p.submittedBy !== 'Default' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {p.submittedBy}</span>}</span><button className="li-del" onClick={() => onRemoveQuiplashPrompt(p.text)}>✕</button></div>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input className="input" style={{ flex: 1, padding: '10px 14px' }} placeholder="Add a custom prompt..." value={newPrompt} onChange={e => setNewPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && newPrompt.trim() && (onAddQuiplashPrompt(newPrompt.trim()), setNewPrompt(''))} />
            <button className="btn btn-ghost btn-sm" disabled={!newPrompt.trim()} onClick={() => { onAddQuiplashPrompt(newPrompt.trim()); setNewPrompt('') }}>Add</button>
          </div>
          <div className="divider" />
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('quiplash')} disabled={playerCount === 0}>Launch Quiplash 😂</button>
        </div>
      )}

      {tab === 'tyk' && (
        <div className="card">
          <div className="card-title">Test Their Knowledge</div>
          <p className="card-sub">Questions Cooper and Michelle will both answer live</p>
          <div style={{ marginBottom: 16 }}>
            {[...(state.tyk?.cooperQuestions || []), ...(state.tyk?.michelleQuestions || [])].length === 0
              ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No questions yet. Guests add them from the Play tab.</p>
              : [...(state.tyk?.cooperQuestions || []), ...(state.tyk?.michelleQuestions || [])].map(q => (
                <div key={q.id} className="list-item">
                  <span className="li-text">{q.text} <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {q.submittedBy}</span></span>
                  <button className="li-del" onClick={() => onRemoveCooperQuestion(q.id)}>✕</button>
                </div>
              ))
            }
          </div>
          <div className="divider" />
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('tyk')} disabled={(state.tyk?.cooperQuestions?.length + state.tyk?.michelleQuestions?.length || 0) === 0 || playerCount === 0}>
            Launch Test Their Knowledge 🧠
          </button>
        </div>
      )}

      {tab === 'trivia' && (
        <div className="card">
          <div className="card-title">Cooper & Michelle Trivia</div>
          <p className="card-sub">{state.trivia.questions.length} questions loaded</p>
          <div className="answer-scroll" style={{ marginBottom: 12 }}>
            {state.trivia.questions.length === 0 ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No questions yet.</p>
              : state.trivia.questions.map(q => (
                <div key={q.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}><span style={{ fontWeight: 600, fontSize: 14 }}>{q.question}</span><button className="li-del" onClick={() => onRemoveTriviaQuestion(q.id)}>✕</button></div>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>🔵 {q.cooperAnswer} | 🌸 {q.michelleAnswer}</span>
                </div>
              ))}
          </div>
          <div className="field"><label>Question</label><input className="input" placeholder="e.g. Where was your first date?" value={triviaQ} onChange={e => setTriviaQ(e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}><label>🔵 Cooper's Answer</label><input className="input" placeholder="Cooper's answer" value={cooperA} onChange={e => setCooperA(e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>🌸 Michelle's Answer</label><input className="input" placeholder="Michelle's answer" value={michelleA} onChange={e => setMichelleA(e.target.value)} /></div>
          </div>
          <button className="btn btn-ghost btn-block" disabled={!triviaQ.trim() || !cooperA.trim() || !michelleA.trim()} onClick={() => { onAddTriviaQuestion(triviaQ.trim(), cooperA.trim(), michelleA.trim()); setTriviaQ(''); setCooperA(''); setMichelleA('') }}>Add Question</button>
          <div className="divider" />
          <button className="btn btn-primary btn-block" onClick={() => onSelectGame('trivia')} disabled={state.trivia.questions.length === 0 || playerCount === 0}>Launch Trivia 🎯</button>
        </div>
      )}

      {tab === 'qa' && (
        <div className="card">
          <div className="card-title">Ask Anything</div>
          <p className="card-sub">Read these out loud, type Cooper or Michelle's response. Guests see it live.</p>
          {qaQuestions.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No questions yet.</p>}
          {pendingQA.map(q => (
            <div key={q.id} style={{ background: 'var(--cream)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div><p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>from {q.submittedBy}</p><p style={{ fontSize: 15, fontWeight: 600 }}>{q.text}</p></div>
                <button className="li-del" onClick={() => onRemoveQA(q.id)}>✕</button>
              </div>
              {qaAnswerId === q.id ? (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    {['Cooper', 'Michelle', 'Both'].map(n => <button key={n} onClick={() => setQaAnsweredBy(n)} style={{ padding: '6px 14px', borderRadius: 20, border: '1.5px solid var(--border)', background: qaAnsweredBy === n ? 'var(--deep)' : 'transparent', color: qaAnsweredBy === n ? '#fff' : 'var(--deep)', cursor: 'pointer', fontSize: 13 }}>{n}</button>)}
                  </div>
                  <textarea className="input" style={{ height: 70, marginBottom: 8 }} placeholder="Type their answer..." value={qaAnswerText} onChange={e => setQaAnswerText(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" disabled={!qaAnswerText.trim()} onClick={() => { onMarkQAAnswered(q.id, qaAnsweredBy, qaAnswerText.trim()); setQaAnswerId(null); setQaAnswerText('') }}>Post Answer</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setQaAnswerId(null); setQaAnswerText('') }}>Cancel</button>
                  </div>
                </div>
              ) : <button className="btn btn-sage btn-sm" onClick={() => setQaAnswerId(q.id)}>Record Answer</button>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onResetAll}>↺ Reset Games</button>
        <button className="btn btn-ghost btn-sm" onClick={onResetScores}>↺ Reset Scores</button>
      </div>
    </>
  )
}

// ── QUIPLASH HOST VIEWS ────────────────────────────────────────────────────
function QuiplashHostView({ state, playerCount, onStart, onBack }) {
  return (
    <>
      <TVScreen><div className="tv-idle-icon">😂</div><div className="tv-idle-title">Quiplash</div><div className="tv-idle-sub">Round {(state.quiplash.round || 0) + 1} ready</div></TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onStart} disabled={playerCount === 0}>Start Round</button><button className="btn btn-ghost" onClick={onBack}>← Menu</button></div>
    </>
  )
}
function QuiplashRoundView({ state, timerPct, playerCount, onOpenVoting }) {
  const answerCount = Object.keys(state.quiplash.answers || {}).length
  return (
    <>
      <TVScreen><div className="tv-label">Round {state.quiplash.round} — Quiplash</div><div className="tv-prompt">{promptText(state.quiplash.currentPrompt)}</div>{promptBy(state.quiplash.currentPrompt) && promptBy(state.quiplash.currentPrompt) !== 'Default' && <div className="tv-sub" style={{marginBottom:4}}>submitted by {promptBy(state.quiplash.currentPrompt)}</div>}<div className="tv-sub">{answerCount} / {playerCount} answered</div><TimerBar pct={timerPct} /></TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onOpenVoting}>Open Voting</button></div>
    </>
  )
}
function QuiplashVoteView({ state, playerCount, onScore }) {
  const voteCount = Object.keys(state.quiplash.votes || {}).length
  const judgeCount = Object.keys(state.quiplash.judgeVotes || {}).length
  const answers = Object.entries(state.quiplash.answers || {})
  return (
    <>
      <TVScreen>
        <div className="tv-label">Voting Open — Quiplash</div>
        <div className="tv-prompt" style={{ fontSize: 18, marginBottom: 12 }}>{promptText(state.quiplash.currentPrompt)}</div>
        <div className="tv-answers">
          {answers.map(([name, ans]) => <div key={name} className="answer-chip"><div className="chip-name">{name}</div><div className="chip-text">{ans}</div></div>)}
        </div>
        <div className="tv-sub" style={{ marginTop: 12 }}>{voteCount} / {playerCount} voted · {judgeCount} judge{judgeCount !== 1 ? 's' : ''} picked</div>
      </TVScreen>
      <div className="btn-row"><button className="btn btn-gold" onClick={onScore}>Score Round 🪙</button></div>
      <div className="card"><p style={{ fontSize: 13, color: 'var(--muted)' }}>Guests vote from their phones. Cooper and Michelle judge from the ⭐ Judge tab. Hit Score when ready.</p></div>
    </>
  )
}
function QuiplashRevealView({ state, onNext, onDone }) {
  const answers = Object.entries(state.quiplash.answers || {})
  const votes = state.quiplash.votes || {}
  const judgeVotes = state.quiplash.judgeVotes || {}
  const earned = computeQuiplashTokens(state.quiplash.answers, votes, judgeVotes)
  return (
    <>
      <TVScreen>
        <div className="tv-label" style={{ marginBottom: 10 }}>{promptText(state.quiplash.currentPrompt)}</div>
        <div className="tv-answers">
          {answers.map(([name, ans]) => {
            const t = earned[name] || 0
            return (
              <div key={name} className="answer-chip" style={t > 0 ? { borderColor: 'var(--warm-gold)', background: 'rgba(232,197,71,0.15)' } : {}}>
                <div className="chip-name">{name}</div>
                <div className="chip-text">{ans}</div>
                {t > 0 && <div style={{ fontSize: 12, color: 'var(--warm-gold)', marginTop: 4, fontWeight: 700 }}>+{t} 🪙</div>}
              </div>
            )
          })}
        </div>
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onNext}>Next Round</button><button className="btn btn-ghost" onClick={onDone}>End Game</button></div>
    </>
  )
}

// ── TYK HOST VIEWS ─────────────────────────────────────────────────────────
function TykHostView({ state, playerCount, onStart, onBack }) {
  const tyk = state.tyk || {}
  const remaining = [...(tyk.cooperQuestions || []), ...(tyk.michelleQuestions || [])].filter(q => !tyk.revealedIds?.includes(q.id)).length
  return (
    <>
      <TVScreen><div className="tv-idle-icon">🧠</div><div className="tv-idle-title">Test Their Knowledge</div><div className="tv-idle-sub">{remaining} questions remaining</div></TVScreen>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => onStart('cooper')} disabled={remaining === 0 || playerCount === 0}>Start Round</button>
        <button className="btn btn-ghost" onClick={onBack}>← Menu</button>
      </div>
    </>
  )
}
function TykRoundView({ state, timerPct, playerCount, onOpenVoting }) {
  const q = state.tyk?.currentQuestion
  const guessCount = Object.keys(state.tyk?.guesses || {}).length
  return (
    <>
      <TVScreen><div className="tv-label">Round {state.tyk?.round} — {q?.target === 'cooper' ? '🔵 Cooper' : '🌸 Michelle'} answers</div><div className="tv-prompt">{q?.text}</div><div className="tv-sub">{guessCount} / {playerCount} guessed</div><TimerBar pct={timerPct} /></TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onOpenVoting}>Open Voting</button></div>
    </>
  )
}
function TykVoteView({ state, playerCount, onSetRealAnswer, onScore }) {
  const q = state.tyk?.currentQuestion
  const guesses = state.tyk?.guesses || {}
  const realAnswer = state.tyk?.realAnswer
  const [cooperInput, setCooperInput] = useState('')
  const [michelleInput, setMichelleInput] = useState('')
  const [cooperLocked, setCooperLocked] = useState(false)
  const [michelleLocked, setMichelleLocked] = useState(false)

  return (
    <>
      <TVScreen>
        <div className="tv-label">🧠 Test Their Knowledge</div>
        <div className="tv-prompt" style={{ fontSize: 20, marginBottom: 12 }}>{q?.text}</div>
        {realAnswer
          ? <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: '#fff' }}>{realAnswer}</div>
            </div>
          : <div className="tv-sub">{Object.keys(guesses).length} / {playerCount} guessed</div>
        }
      </TVScreen>
      {!realAnswer && (
        <div className="card">
          <div className="card-title">Record their answers</div>
          <div className="field">
            <label>🔵 Cooper's answer</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="What Cooper says..." value={cooperInput} onChange={e => setCooperInput(e.target.value)} disabled={cooperLocked} />
              <button className="btn btn-sage btn-sm" disabled={!cooperInput.trim() || cooperLocked} onClick={() => setCooperLocked(true)}>{cooperLocked ? '✓' : 'Lock'}</button>
            </div>
          </div>
          <div className="field">
            <label>🌸 Michelle's answer</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="What Michelle says..." value={michelleInput} onChange={e => setMichelleInput(e.target.value)} disabled={michelleLocked} />
              <button className="btn btn-primary btn-sm" disabled={!michelleInput.trim() || michelleLocked} onClick={() => setMichelleLocked(true)}>{michelleLocked ? '✓' : 'Lock'}</button>
            </div>
          </div>
          <button className="btn btn-gold btn-block" disabled={!cooperLocked || !michelleLocked} onClick={() => onSetRealAnswer(`🔵 Cooper: ${cooperInput}  |  🌸 Michelle: ${michelleInput}`)}>
            Reveal Answers 🎉
          </button>
        </div>
      )}
      {realAnswer && <div className="btn-row"><button className="btn btn-primary" onClick={onScore}>Next Round</button></div>}
    </>
  )
}
function TykRevealView({ state, onNext, onDone }) {
  const q = state.tyk?.currentQuestion
  const guesses = Object.entries(state.tyk?.guesses || {})
  return (
    <>
      <TVScreen>
        <div className="tv-label" style={{ marginBottom: 8 }}>🧠 {q?.text}</div>
        {state.tyk?.realAnswer && <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--mint)', marginBottom: 12, position: 'relative', zIndex: 1 }}>{state.tyk.realAnswer}</div>}
        <div className="tv-answers">
          {guesses.map(([name, g]) => <div key={name} className="answer-chip"><div className="chip-name">{name}</div><div className="chip-text">{g}</div></div>)}
        </div>
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onNext}>Next Round</button><button className="btn btn-ghost" onClick={onDone}>End Game</button></div>
    </>
  )
}

// ── TRIVIA VIEWS ───────────────────────────────────────────────────────────
function TriviaHostView({ state, playerCount, onStart, onBack }) {
  const remaining = state.trivia.questions.length - (state.trivia.revealedIdx?.length || 0)
  return (
    <>
      <TVScreen><div className="tv-idle-icon">🎯</div><div className="tv-idle-title">Trivia</div><div className="tv-idle-sub">{remaining} questions left</div></TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onStart} disabled={remaining === 0 || playerCount === 0}>Start Round</button><button className="btn btn-ghost" onClick={onBack}>← Menu</button></div>
    </>
  )
}
function TriviaRoundView({ state, timerPct, playerCount, onReveal }) {
  const q = state.trivia.currentIdx !== null ? state.trivia.questions[state.trivia.currentIdx] : null
  const guessCount = Object.keys(state.trivia.guesses || {}).length
  return (
    <>
      <TVScreen><div className="tv-label">Round {state.trivia.round} — Trivia</div><div className="tv-prompt">{q?.question}</div><div className="tv-sub">{guessCount} / {playerCount} guessed</div><TimerBar pct={timerPct} /></TVScreen>
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
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>🔵 Cooper</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#fff' }}>{q?.cooperAnswer}</div></div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>🌸 Michelle</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#fff' }}>{q?.michelleAnswer}</div></div>
        </div>
        <div className="tv-answers">
          {guesses.map(([name, g]) => <div key={name} className="answer-chip" style={isClose(g, q?.cooperAnswer) || isClose(g, q?.michelleAnswer) ? { background: 'rgba(168,197,160,0.3)', borderColor: 'rgba(168,197,160,0.6)' } : {}}><div className="chip-name">{name}</div><div className="chip-text">{g}</div></div>)}
        </div>
      </TVScreen>
      <div className="btn-row"><button className="btn btn-primary" onClick={onNext}>Next Question</button><button className="btn btn-ghost" onClick={onDone}>End Game</button></div>
    </>
  )
}

// ── ASK ANYTHING VIEW ──────────────────────────────────────────────────────
function QAView({ state, joined, playerName, onSubmitQA }) {
  const [question, setQuestion] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const questions = state?.qa?.questions || []
  const answered = questions.filter(q => q.answeredBy)
  const pending = questions.filter(q => !q.answeredBy)
  return (
    <>
      <div className="hero"><div className="hero-eyebrow">Ask Anything</div><h1>Questions for<br /><em>Cooper & Michelle</em></h1><p className="hero-sub">The host will read them out and log the answers live</p></div>
      {!joined ? <div className="card" style={{ textAlign: 'center' }}><p style={{ color: 'var(--muted)' }}>Join the game from the Play tab first!</p></div>
        : submitted ? <div className="card"><div className="submitted-state"><div className="big">💌</div><p>Submitted!</p><button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setQuestion(''); setSubmitted(false) }}>Ask another</button></div></div>
        : <div className="card"><div className="card-title">Your question</div><p className="card-sub">Ask Cooper, Michelle, or both anything</p><div className="field"><textarea className="input" placeholder="e.g. Cooper, what are you most nervous about as a new dad?" value={question} onChange={e => setQuestion(e.target.value)} /></div><button className="btn btn-primary btn-block" disabled={!question.trim()} onClick={() => { onSubmitQA(question.trim()); setSubmitted(true) }}>Submit 💌</button></div>
      }
      {answered.length > 0 && <div className="card"><div className="card-title">Answered</div>{answered.map(q => <div key={q.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}><p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Asked by {q.submittedBy}</p><p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{q.text}</p><div style={{ background: 'var(--cream)', borderRadius: 10, padding: '10px 14px', borderLeft: '3px solid var(--dusty-rose)' }}><p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{q.answeredBy} says</p><p style={{ fontSize: 15 }}>{q.answer}</p></div></div>)}</div>}
      {pending.length > 0 && <div className="card"><div className="card-title">In the queue</div><p className="card-sub">{pending.length} waiting</p>{pending.map(q => <div key={q.id} className="list-item"><span className="li-text">{q.text} <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {q.submittedBy}</span></span></div>)}</div>}
    </>
  )
}

// ── SHARED ─────────────────────────────────────────────────────────────────
function TVScreen({ children }) {
  return <div className="tv"><div className="tv-dots"><div className="tv-dot" style={{ background: '#F2C4C4' }} /><div className="tv-dot" style={{ background: '#FAC775' }} /><div className="tv-dot" style={{ background: '#A8C5A0' }} /></div>{children}</div>
}
function TimerBar({ pct }) {
  return <div className="timer-bar"><div className="timer-fill" style={{ width: `${pct}%`, background: pct < 25 ? '#e74c3c' : pct < 50 ? '#FAC775' : 'var(--sage)' }} /></div>
}
function SubmittedCard({ icon = '✅', message }) {
  return <div className="submitted-state"><div className="big">{icon}</div><p>{message}</p></div>
}
function WaitCard({ icon, text }) {
  return <div style={{ textAlign: 'center', paddingTop: 60 }}><div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div><p style={{ color: 'var(--muted)', fontSize: 15 }}>{text}</p></div>
}
function PinView({ pinInput, setPinInput, pinError, pinMode, onLogin }) {
  return (
    <div style={{ maxWidth: 340, margin: '60px auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>{pinMode === 'judge' ? '⭐' : '🔒'}</div>
        <div className="card-title" style={{ marginBottom: 4 }}>{pinMode === 'judge' ? 'Judge Access' : 'Host Access'}</div>
        <p className="card-sub">{pinMode === 'judge' ? 'For Cooper and Michelle only' : 'Enter the host PIN'}</p>
        <div className="field">
          <input className="input" type="password" placeholder="PIN" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onLogin()} autoFocus style={pinError ? { borderColor: '#e74c3c' } : {}} />
          {pinError && <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>Wrong PIN</p>}
        </div>
        <button className="btn btn-primary btn-block" onClick={onLogin}>Enter</button>
      </div>
    </div>
  )
}
// ── PHOTOS VIEW ────────────────────────────────────────────────────────────
function PhotosView({ isHost, isJudge }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [touchStart, setTouchStart] = useState(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const intervalRef = useRef(null)
  const fileRef = useRef(null)
  const canUpload = true
  const canDelete = isHost || isJudge

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const fetchPhotos = useCallback(async () => {
    if (!supabaseUrl || !supabaseKey) return
    try {
      const bucket = encodeURIComponent(PHOTO_BUCKET)
      const r = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 200, offset: 0, sortBy: { column: 'created_at', order: 'asc' } })
      })
      const data = await r.json()
      if (Array.isArray(data)) {
        const urls = data
          .filter(f => f.name && !f.name.endsWith('/'))
          .map(f => ({
            name: f.name,
            url: `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(PHOTO_BUCKET)}/${f.name}`
          }))
        setPhotos(urls)
      }
    } catch {}
    setLoading(false)
  }, [supabaseUrl, supabaseKey])

  useEffect(() => { fetchPhotos() }, [fetchPhotos])

  // Auto-advance slideshow
  useEffect(() => {
    if (isPlaying && photos.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentIdx(i => (i + 1) % photos.length)
      }, 4000)
    }
    return () => clearInterval(intervalRef.current)
  }, [isPlaying, photos.length])

  const goTo = (idx) => {
    setCurrentIdx((idx + photos.length) % photos.length)
    // reset auto-play timer
    clearInterval(intervalRef.current)
    if (isPlaying && photos.length > 1) {
      intervalRef.current = setInterval(() => setCurrentIdx(i => (i + 1) % photos.length), 4000)
    }
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    const bucket = encodeURIComponent(PHOTO_BUCKET)
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      try {
        const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${name}`, {
          method: 'POST',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': file.type },
          body: file
        })
        if (!res.ok) console.error('Upload failed', await res.text())
      } catch(e) { console.error('Upload error', e) }
    }
    await fetchPhotos()
    setCurrentIdx(Math.max(0, photos.length))
    setUploading(false)
    e.target.value = ''
  }

  const handleDelete = async (name) => {
    try {
      await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(PHOTO_BUCKET)}/${name}`, {
        method: 'DELETE',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
      })
      await fetchPhotos()
      setCurrentIdx(0)
    } catch {}
  }

  // Touch swipe
  const onTouchStart = (e) => setTouchStart(e.touches[0].clientX)
  const onTouchEnd = (e) => {
    if (touchStart === null) return
    const diff = touchStart - e.changedTouches[0].clientX
    if (Math.abs(diff) > 40) diff > 0 ? goTo(currentIdx + 1) : goTo(currentIdx - 1)
    setTouchStart(null)
  }

  if (loading) return <div style={{ textAlign: 'center', paddingTop: 60 }}><div style={{ fontSize: 32 }}>📸</div><p style={{ color: 'var(--muted)', marginTop: 12 }}>Loading photos...</p></div>

  return (
    <>
      <div className="hero">
        <div className="hero-eyebrow">Memory Lane</div>
        <h1>Cooper & <em>Michelle</em></h1>
        <p className="hero-sub">{photos.length} photo{photos.length !== 1 ? 's' : ''}</p>
      </div>

      {photos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>No photos yet. Be the first to add one!</p>
          <button className="btn btn-primary" onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : '📸 Add a Photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleUpload} />
        </div>
      ) : (
        <>
          {/* MAIN PHOTO */}
          <div
            style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', marginBottom: 16, background: 'var(--deep)', aspectRatio: '4/3', cursor: 'pointer' }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <img
              src={photos[currentIdx]?.url}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'opacity 0.3s' }}
            />

            {/* Nav arrows */}
            {photos.length > 1 && (
              <>
                <button onClick={() => goTo(currentIdx - 1)} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                <button onClick={() => goTo(currentIdx + 1)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
              </>
            )}

            {/* Counter */}
            <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>
              {currentIdx + 1} / {photos.length}
            </div>

            {/* Delete button — host/judge only */}
            {canDelete && deleteMode && (
              <button onClick={() => handleDelete(photos[currentIdx].name)} style={{ position: 'absolute', top: 10, right: 10, background: '#e74c3c', border: 'none', borderRadius: '50%', width: 32, height: 32, color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            )}
          </div>

          {/* Dot indicators */}
          {photos.length > 1 && photos.length <= 20 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
              {photos.map((_, i) => (
                <div key={i} onClick={() => goTo(i)} style={{ width: i === currentIdx ? 16 : 6, height: 6, borderRadius: 3, background: i === currentIdx ? 'var(--dusty-rose)' : 'var(--border)', cursor: 'pointer', transition: 'all 0.2s' }} />
              ))}
            </div>
          )}

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
              {photos.map((p, i) => (
                <img key={p.name} src={p.url} alt="" onClick={() => goTo(i)} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 10, flexShrink: 0, border: i === currentIdx ? '2px solid var(--dusty-rose)' : '2px solid transparent', cursor: 'pointer', opacity: i === currentIdx ? 1 : 0.6, transition: 'all 0.2s' }} />
              ))}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {photos.length > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setIsPlaying(p => !p)}>
                {isPlaying ? '⏸ Pause' : '▶ Play'} Slideshow
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => fileRef.current.click()} disabled={uploading}>
              {uploading ? 'Uploading...' : '📸 Add Photos'}
            </button>
            {canDelete && (
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteMode(d => !d)} style={deleteMode ? { borderColor: '#e74c3c', color: '#e74c3c' } : {}}>
                {deleteMode ? 'Done Deleting' : 'Delete'}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleUpload} />
          </div>
        </>
      )}
    </>
  )
}

// ── QR VIEW ────────────────────────────────────────────────────────────────
function QRView({ appUrl }) {
  return (
    <>
      <div className="hero"><div className="hero-eyebrow">Print & Display</div><h1>Scan to <em>Join</em> the Party</h1><p className="hero-sub">One at each table</p></div>
      <div className="qr-print-card">
        <h2>Cooper & Michelle's Baby Shower 🍼</h2>
        <p>Scan with your phone camera to join the games!</p>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}><QRCodeSVG value={appUrl} size={220} bgColor="#ffffff" fgColor="#2C1F2E" level="H" includeMargin /></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all', marginTop: 8 }}>{appUrl}</p>
      </div>
      <button className="btn btn-primary no-print" style={{ marginTop: 16, width: '100%' }} onClick={() => window.print()}>🖨️ Print QR Code</button>
    </>
  )
}
