import { useState } from 'react'
import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import NotificationBanner from './components/NotificationBanner'
import { PDFProvider } from './context/PDFContext'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <PDFProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-veda-surface dark:bg-veda-surface-dark">
        <NotificationBanner />
        <LeftPanel isOpen={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
        <RightPanel sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      </div>
    </PDFProvider>
  )
}
