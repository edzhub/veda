import { usePDF } from "../context/PDFContext"
import { extractTOC } from "../utils/pdfUtils"

export default function LeftPanel() {
  const { state, dispatch } = usePDF()

  async function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const pdfjsLib = await import("pdfjs-dist")
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString()
      const arrayBuffer = await file.arrayBuffer()
      try {
        const UPLOAD_URL = import.meta.env.VITE_UPLOAD_API_URL || 'http://127.0.0.1:8765/upload_pdf'
        await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
          },
          body: arrayBuffer,
        })
        console.log('PDF successfully uploaded to backend for layout analysis.')
      } catch (uploadErr) {
        console.warn('Backend PDF upload unavailable:', uploadErr)
      }
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      dispatch({ type: "SET_PDF", payload: pdfDoc })
      const { toc, offset } = await extractTOC(pdfDoc)
      dispatch({ type: "SET_TOC", payload: toc })
      dispatch({ type: "SET_PAGE_OFFSET", payload: offset })
    } catch (err) {
      console.error("Error:", err)
    }
  }

  function handleClick(item) {
    dispatch({ type: "SET_PAGE", payload: item.page })
  }

  const isLight = state.theme === 'light'

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "300px",
        height: "100vh",
        background: isLight ? "#ffffff" : "#1a1a1a",
        borderRight: isLight ? "1px solid #eaebed" : "1px solid #2a2a2a",
        flexShrink: 0,
        transition: "background 0.3s ease, border-color 0.3s ease"
      }}
    >
      
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1rem", borderBottom: isLight ? "1px solid #eaebed" : "1px solid #2a2a2a" }}>
        <div style={{ width: "12px", height: "12px", borderRadius: "2px", background: isLight ? "#d97706" : "#f5a623" }} />
        <span style={{ color: isLight ? "#d97706" : "#f5a623", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Contents</span>
      </div>

      <div style={{ padding: "0.75rem" }}>
        <label style={{ display: "block", width: "100%", padding: "0.6rem", borderRadius: "8px", background: isLight ? "#d97706" : "#f5a623", color: isLight ? "#ffffff" : "#0f0f0f", fontWeight: 600, fontSize: "0.8rem", textAlign: "center", cursor: "pointer", boxShadow: isLight ? "0 2px 8px rgba(217, 119, 6, 0.25)" : "none" }}>
          Upload PDF
          <input type="file" accept=".pdf" onChange={handleFileChange} style={{ display: "none" }} />
        </label>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
        {state.toc.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "0.75rem" }}>
            <div style={{ fontSize: "2rem" }}>📄</div>
            <p style={{ color: "#888880", fontSize: "0.75rem", textAlign: "center" }}>
              Upload a PDF to see<br />the table of contents
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {(() => {
              // Resolve active TOC entry (either exact page or closest preceding page)
              let activeItem = null
              if (state.toc && state.toc.length > 0) {
                const exact = state.toc.find((item) => item.page === state.selectedPage)
                if (exact) {
                  activeItem = exact
                } else {
                  let closest = null
                  for (const item of state.toc) {
                    if (item.page <= state.selectedPage) {
                      if (!closest || item.page > closest.page) {
                        closest = item
                      }
                    }
                  }
                  activeItem = closest
                }
              }

              return state.toc.map((item, i) => {
                const isActive = activeItem === item
                return (
                  <button
                    key={i}
                    onClick={() => handleClick(item)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.75rem",
                      width: "100%",
                      padding: "0.6rem 0.75rem",
                      borderRadius: "6px",
                      background: isActive 
                        ? (isLight ? "#fdf6e6" : "#2a2a2a") 
                        : "transparent",
                      border: "none",
                      borderLeft: isActive 
                        ? (isLight ? "2px solid #d97706" : "2px solid #f5a623") 
                        : "2px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      marginBottom: "2px",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <span style={{ color: isLight ? "#d97706" : "#f5a623", fontSize: "0.7rem", fontWeight: 600, minWidth: "24px", paddingTop: "2px", flexShrink: 0 }}>
                      {item.printedPage ?? item.page}
                    </span>
                    <span style={{ color: isActive ? (isLight ? "#2c2c2c" : "#e8e8e8") : (isLight ? "#6d6d6d" : "#aaaaaa"), fontSize: "0.8rem", lineHeight: 1.5, wordBreak: "break-word", fontWeight: isActive ? 600 : 400 }}>
                      {item.title}
                    </span>
                  </button>
                )
              })
            })()}
          </div>
        )}
      </div>

    </div>
  )
}
