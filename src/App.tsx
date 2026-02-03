import './App.css'
import { Routes, Route, Link } from 'react-router-dom'
import LibraryPage from './pages/LibraryPage'
import PaperPage from './pages/PaperPage'
import ThemeToggle from './components/ThemeToggle'

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="brand-mark" aria-hidden />
          <div>
            <Link to="/" className="brand-title">
              LLMPaperReader
            </Link>
            <p className="brand-subtitle">Upload, tag, and read papers with clarity.</p>
          </div>
        </div>
        <nav className="app-nav">
          <Link to="/" className="nav-link">
            Library
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/papers/:id" element={<PaperPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
