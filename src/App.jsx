import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import { PDFProvider } from './context/PDFContext'

export default function App() {
  return (
    <PDFProvider>
      <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#0f0f0f', overflow: 'hidden' }}>
        <LeftPanel />
        <RightPanel />
      </div>
    </PDFProvider>
  )
}