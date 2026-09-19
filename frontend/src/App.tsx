import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  Hash,
  LogOut,
  Package,
  Lock,
  LockOpen,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import './App.css'

type Item = {
  id: number
  name: string
  rarity: 'Rare' | 'Epic' | 'Legendary'
  status: 'available' | 'claimed'
  claimedBy?: string
}

type Reservation = {
  member: string
  items: string[]
}

const items: Item[] = Array.from({ length: 200 }, (_, index) => {
  const number = index + 1

  return {
    id: number,
    name: `Item ${String(number).padStart(2, '0')}`,
    rarity: number % 7 === 0 ? 'Legendary' : number % 3 === 0 ? 'Epic' : 'Rare',
    status: 'available',
  }
})

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userName, setUserName] = useState('')
  const [ign, setIgn] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isAdmin, setIsAdmin] = useState(false)
  const [roundNumber] = useState(1)
  const [timeLeft, setTimeLeft] = useState(15 * 60)
  const [isAuctionStarted, setIsAuctionStarted] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const lockedPages = new Set<number>()
  const heldPagesRound = false
  const durationMinutes = 15
  const [adminConfigOpen, setAdminConfigOpen] = useState(false)
  const [adminMembers, setAdminMembers] = useState<string[]>([])
  const [adminSearch, setAdminSearch] = useState('')
  const [itemList, setItemList] = useState(items)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [notice, setNotice] = useState('')

  const visibleItems = useMemo(
    () => itemList.slice((currentPage - 1) * 100, currentPage * 100),
    [currentPage, itemList],
  )
  const pageBlocks = useMemo(
    () => Array.from({ length: 25 }, (_, index) => ({
      page: (currentPage - 1) * 25 + index + 1,
      items: visibleItems.slice(index * 4, index * 4 + 4),
    })),
    [currentPage, visibleItems],
  )
  const claimedCount = itemList.filter((item) => item.status === 'claimed').length
  const guildMembers = ['KirinFox', 'MoonRider', 'NoxLuna', 'PixelMew', 'RinHana', 'StormByte', 'TaroZen', 'VioletArc', 'WispTH', 'YukiNova', 'AsterRay', 'CloverMint', 'DuskRune', 'EchoMori', 'FrostKite', 'HanaByte', 'IvyShade', 'JadeOrbit', 'KuroPanda', 'LotusWing']
  const filteredGuildMembers = guildMembers.filter((member) => member.toLowerCase().includes(adminSearch.toLowerCase().trim()))
  const isAuctionClosed = !isAuctionStarted || countdown !== null || timeLeft <= 0
  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(timeLeft % 60).padStart(2, '0')}`

  useEffect(() => {
    if (!isAuctionStarted || countdown !== null || timeLeft <= 0) return
    const timer = window.setInterval(() => setTimeLeft((time) => Math.max(0, time - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown, isAuctionStarted, timeLeft])

  useEffect(() => {
    if (countdown === null) return
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value === null || value <= 1) {
          window.clearInterval(timer)
          setIsAuctionStarted(true)
          setTimeLeft(durationMinutes * 60)
          setNotice('Auction started.')
          return null
        }
        return value - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [countdown, durationMinutes])

  function signIn() {
    setIsAuthenticated(true)
    setUserName('Mew')
    setIgn('Mew')
    setIsAdmin(true)
  }

  function claimItem(itemId: number) {
    if (!isAuthenticated) {
      setNotice('Sign in with Discord before reserving an item.')
      return
    }
    const selectedItem = itemList.find((item) => item.id === itemId)
    if (!selectedItem) return

    if (selectedItem.status === 'claimed') {
      if (selectedItem.claimedBy !== ign.trim()) return

      setItemList((currentItems) =>
        currentItems.map((item) =>
          item.id === itemId ? { ...item, status: 'available', claimedBy: undefined } : item,
        ),
      )
      setReservations((currentReservations) => currentReservations
        .map((reservation) => reservation.member === ign.trim()
          ? { ...reservation, items: reservation.items.filter((item) => item !== selectedItem.name) }
          : reservation,
        )
        .filter((reservation) => reservation.items.length > 0))
      setNotice(`${selectedItem.name} reservation removed.`)
      return
    }

    const itemPage = Math.ceil(selectedItem.id / 4)
    const pageIsLocked = heldPagesRound ? !lockedPages.has(itemPage) : lockedPages.has(itemPage)
    if (pageIsLocked) {
      setNotice(`Page ${itemPage} is locked for this round.`)
      return
    }

    if (isAuctionClosed) {
      setNotice(!isAuctionStarted ? 'The admin has not started this round yet.' : 'This round has ended.')
      return
    }

    setItemList((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId ? { ...item, status: 'claimed', claimedBy: ign.trim() } : item,
      ),
    )
    setReservations((currentReservations) => {
      const existing = currentReservations.find((reservation) => reservation.member === ign.trim())
      if (existing) {
        return currentReservations.map((reservation) =>
          reservation.member === ign.trim()
            ? { ...reservation, items: [...reservation.items, selectedItem.name] }
            : reservation,
        )
      }
      return [...currentReservations, { member: ign.trim(), items: [selectedItem.name] }]
    })
    setNotice(`${selectedItem.name} is reserved for ${ign.trim()}.`)
  }

  function copySummary() {
    const summary = reservations.map((reservation) => `${reservation.member}: ${reservation.items.join(', ')}`).join('\n')
    navigator.clipboard?.writeText(summary)
    setNotice('Reservation summary copied to clipboard.')
  }

  function toggleAdminMember(member: string) {
    setAdminMembers((members) => members.includes(member)
      ? members.filter((currentMember) => currentMember !== member)
      : [...members, member])
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Clover TH home">
          <span className="brand-mark"><Crown size={17} /></span>
          <span><strong>Clover</strong><small>GUILD CONTROL</small></span>
        </a>
        <div className="topbar-meta">
          <span className="season-label">Ragnarok: The New World</span>
          <div className="profile">
              {isAuthenticated ? <><span className="avatar">{userName.charAt(0)}</span><span>{userName}</span>{isAdmin ? <><span className="top-admin-badge">ADMIN</span><button className="admin-menu-button" type="button" onClick={() => setAdminConfigOpen((open) => !open)}><Settings size={14} /> Admin menu</button></> : <span className="top-user-badge">USER</span>}<ChevronDown size={14} /><button className="logout-button" type="button" onClick={() => { setIsAuthenticated(false); setIsAdmin(false) }} title="Sign out"><LogOut size={14} /></button></> : <button className="top-login-button" type="button" onClick={signIn}><Hash size={15} /> Sign in with Discord</button>}
          </div>
        </div>
      </header>

      <div id="top" className="content">
        <section className="intro-row">
          <div>
            <p className="eyebrow"><span className="live-dot" /> LIVE RESERVATION BOARD</p>
            <h1>Guild item queue<span>.</span></h1>
            <p className="intro-copy">Reserve your auction drops in a fair, visible queue for <strong>Clover_TH</strong>.</p>
          </div>
          <div className="season-card"><span>ROUND {String(roundNumber).padStart(2, '0')}</span><strong>Guild auction</strong><small>{isAuctionClosed ? 'Round closed' : `${formattedTime} remaining`}</small></div>
        </section>

        <section className={`round-panel ${isAuctionClosed ? 'closed' : ''}`}>
          <div className="round-status"><span className="timer-icon">{isAuctionClosed ? <Lock size={17} /> : <LockOpen size={17} />}</span><div><strong>{!isAuctionStarted ? 'Waiting for admin to start' : timeLeft <= 0 ? 'Round time is over' : 'Auction is open'}</strong><small>{isAuctionClosed ? 'Reservations are paused' : 'Reserve before the timer reaches zero'}</small></div></div>
          <div className="timer"><span>TIME LEFT</span><strong>{formattedTime}</strong></div>
        </section>

          {adminConfigOpen && <section className="admin-config-page"><div className="config-header"><div><p className="eyebrow"><Settings size={12} /> ADMIN MENU / CONFIG</p><h2>Manage administrators</h2><p>Choose which guild members can manage rounds, locks, and page settings.</p></div><button className="config-close" type="button" onClick={() => setAdminConfigOpen(false)}>Close</button></div><label className="admin-search"><span>SEARCH MEMBERS</span><input type="search" placeholder="Search by name..." value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} /></label><div className="member-admin-list">{filteredGuildMembers.map((member) => <label className="member-admin-row" key={member}><span className="member-avatar">{member.charAt(0)}</span><span><strong>{member}</strong><small>Discord guild member</small></span><input type="checkbox" checked={adminMembers.includes(member)} onChange={() => toggleAdminMember(member)} /></label>)}{filteredGuildMembers.length === 0 && <p className="empty-search">No guild members found.</p>}</div><div className="config-footer"><span>{adminMembers.length} admin{adminMembers.length === 1 ? '' : 's'} selected</span><button className="admin-button" type="button" onClick={() => { setAdminConfigOpen(false); setNotice('Admin configuration saved.') }}>Save configuration</button></div></section>}

        <section className="section-heading"><div><p className="eyebrow">THE DROP LIST</p><h2>Available items</h2></div><div className="top-page-nav"><span>Pages <strong>{currentPage === 1 ? '1 - 25' : '26 - 50'}</strong></span><button className="page-group-button" type="button" onClick={() => setCurrentPage((page) => page === 1 ? 2 : 1)}>{currentPage === 1 ? <>Next <ArrowRight size={14} /></> : <><ArrowLeft size={14} /> Previous</>}</button></div></section>
        <section className="page-blocks" aria-label="Auction item pages">{pageBlocks.map((pageBlock) => { const pageIsLocked = heldPagesRound ? !lockedPages.has(pageBlock.page) : lockedPages.has(pageBlock.page); return <section className={`page-block ${pageIsLocked ? 'page-locked' : ''}`} key={pageBlock.page} aria-label={`Page ${pageBlock.page}`}><div className="page-label">Page <strong>{pageBlock.page}</strong>{pageIsLocked && <small><Lock size={11} /> Locked</small>}</div><div className="item-grid">{pageBlock.items.map((item, itemIndex) => { const isMine = item.status === 'claimed' && item.claimedBy === ign.trim(); return <article className={`item-card ${item.status}`} key={item.id}><div className="item-info"><h3>Item {itemIndex + 1}</h3>{item.status === 'claimed' && <small className="reserved-by">Reserved by {item.claimedBy}</small>}</div><button className="claim-button" type="button" disabled={!isAuthenticated || pageIsLocked || (isAuctionClosed && !isMine) || (item.status === 'claimed' && !isMine)} onClick={() => claimItem(item.id)}>{isMine ? <><Trash2 size={14} /> Remove</> : <><Package size={14} /> Reserve</>}</button></article> })}</div></section> })}</section>

        <div className="page-group-bottom"><span>Pages <strong>{currentPage === 1 ? '1 - 25' : '26 - 50'}</strong></span><button className="page-group-button" type="button" onClick={() => setCurrentPage((page) => page === 1 ? 2 : 1)}>{currentPage === 1 ? <>Next <ArrowRight size={14} /></> : <><ArrowLeft size={14} /> Previous</>}</button></div>

        <section className="summary-section">
          <div className="section-heading summary-heading"><div><p className="eyebrow">THE PAPER TRAIL</p><h2>Reservation summary</h2></div><button className="copy-button" type="button" onClick={copySummary}><Copy size={15} /> Copy list</button></div>
          <div className="summary-meta"><span><Users size={15} /> {reservations.length} members</span><span><Package size={15} /> {claimedCount} items reserved</span></div>
          <div className="summary-grid">{reservations.map((reservation) => <article className="summary-card" key={reservation.member}><div className="member-heading"><span className="member-avatar">{reservation.member.charAt(0).toUpperCase()}</span><strong>{reservation.member}</strong><span className="item-count">{reservation.items.length} {reservation.items.length === 1 ? 'item' : 'items'}</span></div>{reservation.items.map((item) => <div className="reserved-item" key={item}><span />{item}</div>)}</article>)}</div>
        </section>
        <footer><span>CLOVER_TH</span><span>Built for fair drops · <CircleHelp size={13} /> Need help?</span></footer>
      </div>

      {notice && <div className="toast"><Check size={16} /> {notice}<button type="button" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {countdown !== null && <div className="countdown-backdrop" role="status" aria-live="assertive"><div className="countdown-modal"><span>ROUND {String(roundNumber).padStart(2, '0')}</span><strong>{countdown}</strong><small>Auction starting</small></div></div>}
    </main>
  )
}

export default App
