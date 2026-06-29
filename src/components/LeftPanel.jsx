import { usePDF } from "../context/PDFContext"
import { extractTOC } from "../utils/pdfUtils"
import { cn } from "../lib/cn"

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

  return (
    <aside
      className="flex flex-col w-[300px] h-screen shrink-0 border-r transition-colors duration-300
        bg-white border-veda-border
        dark:bg-[#1a1a1a] dark:border-[#2a2a2a]"
    >
      <div className="flex items-center gap-2 p-4 border-b border-veda-border dark:border-[#2a2a2a]">
        <div className="w-3 h-3 rounded-sm bg-veda-accent dark:bg-veda-accent-dark" />
        <span className="veda-accent-text text-xs font-semibold tracking-widest uppercase">
          Contents
        </span>
      </div>

      <div className="p-3">
        <label
          className="block w-full py-2.5 px-3 rounded-lg text-center text-[0.8rem] font-semibold cursor-pointer
            bg-veda-accent text-white shadow-md shadow-veda-accent/25
            dark:bg-veda-accent-dark dark:text-veda-surface-dark dark:shadow-none"
        >
          Upload PDF
          <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {state.toc.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-[2rem]">📄</div>
            <p className="veda-text-muted text-xs text-center">
              Upload a PDF to see<br />the table of contents
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {(() => {
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
                    className={cn(
                      'flex items-start gap-3 w-full py-2.5 px-3 rounded-md border-none text-left mb-0.5 transition-all duration-200 cursor-pointer',
                      isActive
                        ? 'bg-veda-accent-soft border-l-2 border-veda-accent dark:bg-[#2a2a2a] dark:border-l-veda-accent-dark'
                        : 'bg-transparent border-l-2 border-transparent'
                    )}
                  >
                    <span className="veda-accent-text text-[0.7rem] font-semibold min-w-6 pt-0.5 shrink-0">
                      {item.printedPage ?? item.page}
                    </span>
                    <span
                      className={cn(
                        'text-[0.8rem] leading-relaxed break-words',
                        isActive
                          ? 'veda-text-primary font-semibold'
                          : 'text-[#6d6d6d] dark:text-[#aaaaaa] font-normal'
                      )}
                    >
                      {item.title}
                    </span>
                  </button>
                )
              })
            })()}
          </div>
        )}
      </div>
    </aside>
  )
}
