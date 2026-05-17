"use client"

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface PDFViewerProps {
  file: File
  onPagesConverted: (pages: string[]) => void
  onPageChange: (page: number) => void
  onImageLoad?: (width: number, height: number) => void
  currentPage: number
}

declare global {
  interface Window {
    pdfjsLib: any
  }
}

export interface PDFViewerRef {
  getImageElement: () => HTMLImageElement | null
}

export const PDFViewer = forwardRef<PDFViewerRef, PDFViewerProps>(
  ({ file, onPagesConverted, onPageChange, onImageLoad, currentPage }, ref) => {
    const [isConverting, setIsConverting] = useState(false)
    const [pdfPages, setPdfPages] = useState<string[]>([])
    const [isLibLoaded, setIsLibLoaded] = useState(false)
    const { toast } = useToast()
    const imageRef = useRef<HTMLImageElement>(null)
    const lastLoadedPageRef = useRef<number | null>(null)

    useImperativeHandle(ref, () => ({
      getImageElement: () => imageRef.current,
    }))

    useEffect(() => {
      if (typeof window === "undefined") return
      if (window.pdfjsLib) {
        setIsLibLoaded(true)
        return
      }
      const script = document.createElement("script")
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
          setIsLibLoaded(true)
        }
      }
      script.onerror = () => {
        console.error("Failed to load PDF.js")
        toast({
          title: "Library Load Error",
          description: "Failed to load PDF.js library",
          variant: "destructive",
        })
      }
      document.head.appendChild(script)
      return () => {
        if (script.parentNode) {
          script.parentNode.removeChild(script)
        }
      }
    }, [toast])

    useEffect(() => {
      if (file.type === "application/pdf" && isLibLoaded) {
        lastLoadedPageRef.current = null // Reset when file changes
        convertPdfToImages()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, isLibLoaded])

    const convertPdfToImages = async () => {
      if (!window.pdfjsLib) {
        console.error("PDF.js not loaded")
        return
      }
      setIsConverting(true)
      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const numPages = pdf.numPages
        const pageImages: string[] = []
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)
          const viewport = page.getViewport({ scale: 2.0 })
          const canvas = document.createElement("canvas")
          const context = canvas.getContext("2d")
          if (!context) continue
          canvas.height = viewport.height
          canvas.width = viewport.width
          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise
          pageImages.push(canvas.toDataURL("image/png"))
        }
        setPdfPages(pageImages)
        onPagesConverted(pageImages)
        if (pageImages.length > 0) {
          onPageChange(0)
        }
      } catch (error) {
        console.error("Error converting PDF to images:", error)
        toast({
          title: "PDF Conversion Error",
          description: "Failed to convert PDF to images for preview",
          variant: "destructive",
        })
      } finally {
        setIsConverting(false)
      }
    }

    const handleImageLoad = () => {
      if (imageRef.current && onImageLoad && lastLoadedPageRef.current !== currentPage) {
        const img = imageRef.current
        onImageLoad(img.naturalWidth, img.naturalHeight)
        lastLoadedPageRef.current = currentPage
      }
    }

    useEffect(() => {
      if (imageRef.current && onImageLoad && pdfPages[currentPage] && lastLoadedPageRef.current !== currentPage) {
        const img = imageRef.current
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          onImageLoad(img.naturalWidth, img.naturalHeight)
          lastLoadedPageRef.current = currentPage
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, pdfPages, onImageLoad])

    if (!isLibLoaded) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
          <p className="text-lg text-gray-600 dark:text-gray-300">Loading PDF library...</p>
        </div>
      )
    }

    if (isConverting) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
          <p className="text-lg text-gray-600 dark:text-gray-300">Converting PDF to images...</p>
        </div>
      )
    }

    if (pdfPages.length === 0 || !pdfPages[currentPage]) {
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-gray-500">No PDF pages available or current page is invalid.</p>
        </div>
      )
    }

    return (
      <div className="w-full h-full flex items-center justify-center">
        <img
          ref={imageRef}
          src={pdfPages[currentPage] || "/placeholder.svg"}
          alt={`PDF Page ${currentPage + 1}`}
          className="max-w-full max-h-full object-contain"
          onLoad={handleImageLoad}
          key={currentPage}
        />
      </div>
    )
  },
)

PDFViewer.displayName = "PDFViewer"
