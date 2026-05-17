"use client"

import { useState, useCallback, type ChangeEvent, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Upload,
  FileText,
  Download,
  Copy,
  Share2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  XCircle,
  FileType,
  Eye,
  EyeOff,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"
import type { PDFViewerRef } from "@/components/pdf-viewer-cdn"
import { TableExtractionTab } from "@/components/table-extraction-tab"
import { ScrollArea } from "@/components/ui/scroll-area"

const PDFViewer = dynamic(() => import("@/components/pdf-viewer-cdn").then((mod) => ({ default: mod.PDFViewer })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
})

interface BoundingBox {
  l: number
  t: number
  r: number
  b: number
}

interface Grounding {
  box: BoundingBox
  page: number
}

export interface Chunk {
  text: string
  chunk_type: string
  chunk_id: string
  grounding?: Grounding[]
}

interface OCRResult {
  markdown: string
  chunks: Chunk[]
}

export default function OCRPage() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [showBboxes, setShowBboxes] = useState<boolean>(true)
  const [hoveredChunk, setHoveredChunk] = useState<string | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [pdfPages, setPdfPages] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState<number>(0)
  const [totalPages, setTotalPages] = useState<number>(0)
  const [isMounted, setIsMounted] = useState(false)
  const [isHoveringPreview, setIsHoveringPreview] = useState(false)
  const [activeTab, setActiveTab] = useState("markdown")

  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PDFViewerRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const resetStateForNewFile = () => {
    setFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    setPreviewMimeType(null)
    setOcrResult(null)
    setError(null)
    setHoveredChunk(null)
    setSelectedChunk(null)
    setImageSize(null)
    setPdfPages([])
    setCurrentPage(0)
    setTotalPages(0)
    setIsLoading(false)
  }

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    resetStateForNewFile()

    if (selectedFile) {
      setFile(selectedFile)
      setPreviewUrl(URL.createObjectURL(selectedFile))
      setPreviewMimeType(selectedFile.type)
    }
    if (event.target) {
      event.target.value = ""
    }
  }

  const handlePagesConverted = (pages: string[]) => {
    setPdfPages(pages)
    setTotalPages(pages.length)
  }

  const handleImageLoad = () => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageSize({
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      }
    }
  }

  const handlePdfImageLoad = useCallback((width: number, height: number) => {
    if (width > 0 && height > 0) {
      setImageSize({ width, height })
    }
  }, [])

  const calculateBboxPosition = (box: BoundingBox, pageIndex = 0) => {
    if (!containerRef.current || !imageSize || imageSize.width === 0 || imageSize.height === 0) {
      return null
    }

    if (previewMimeType === "application/pdf" && pageIndex !== currentPage) {
      return null
    }

    let imgElement: HTMLImageElement | null = null
    if (previewMimeType === "application/pdf" && pdfViewerRef.current) {
      imgElement = pdfViewerRef.current.getImageElement()
    } else {
      imgElement = imageRef.current
    }

    if (!imgElement) return null

    const container = containerRef.current
    const displayWidth = imgElement.clientWidth
    const displayHeight = imgElement.clientHeight

    if (displayWidth === 0 || displayHeight === 0) return null

    const imgRect = imgElement.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const offsetX = imgRect.left - containerRect.left
    const offsetY = imgRect.top - containerRect.top

    const scaleX = displayWidth / imageSize.width
    const scaleY = displayHeight / imageSize.height

    const left = offsetX + box.l * imageSize.width * scaleX
    const top = offsetY + box.t * imageSize.height * scaleY
    const width = (box.r - box.l) * imageSize.width * scaleX
    const height = (box.b - box.t) * imageSize.height * scaleY

    return { left, top, width, height }
  }

  const handleParseDocument = useCallback(async () => {
    if (!file) {
      setError("Please select a file first.")
      toast({
        title: "Error",
        description: "Please select a file first.",
        variant: "destructive",
      })
      return
    }
    setIsLoading(true)
    setError(null)
    setOcrResult(null)
    setHoveredChunk(null)
    setSelectedChunk(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/ocr", {
        method: "POST",
        body: formData,
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        const errorMessage = result.error || result.details || "An unknown error occurred."
        throw new Error(errorMessage)
      }
      if (result.data) {
        setOcrResult(result.data)
        toast({
          title: "Success",
          description: "Document parsed successfully.",
        })
      } else {
        throw new Error("No data returned from API.")
      }
    } catch (err: any) {
      const displayError = err.message || "Failed to process document. Please check the backend server."
      setError(displayError)
      setOcrResult(null)
      toast({
        title: "Processing Error",
        description: displayError,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [file, toast])

  const handleDownload = (format: "markdown" | "json") => {
    if (!ocrResult) return
    let content = ""
    let filename = ""
    if (format === "markdown") {
      content = ocrResult.markdown
      filename = `${file?.name.split(".")[0] || "document"}_ocr.md`
    } else if (format === "json") {
      content = JSON.stringify(ocrResult.chunks, null, 2)
      filename = `${file?.name.split(".")[0] || "document"}_ocr.json`
    }
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast({ title: "Downloaded", description: `${filename} downloaded.` })
  }

  const handleCopy = async (format: "markdown" | "json") => {
    if (!ocrResult) return
    let content = ""
    if (format === "markdown") {
      content = ocrResult.markdown
    } else if (format === "json") {
      content = JSON.stringify(ocrResult.chunks, null, 2)
    }
    try {
      await navigator.clipboard.writeText(content)
      toast({ title: "Copied", description: `${format.toUpperCase()} content copied to clipboard.` })
    } catch (err) {
      toast({ title: "Copy Failed", description: `Could not copy content.`, variant: "destructive" })
    }
  }

  const scrollToChunk = (chunkId: string) => {
    const element = document.getElementById(`chunk-${chunkId}`)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" })
      element.classList.add("highlight-chunk")
      setTimeout(() => {
        element.classList.remove("highlight-chunk")
      }, 2000)
    }
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage)
    }
  }

  const renderPreview = () => {
    const noFileSelectedContent = (
      <div
        className="flex flex-col items-center justify-center h-full cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors rounded-md"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={48} className="mx-auto mb-3 text-gray-400 dark:text-gray-500" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">Upload an image or PDF to see the preview</p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Click here to select a file</p>
      </div>
    )

    if (!file || !previewUrl || !previewMimeType || !isMounted) {
      return noFileSelectedContent
    }

    const isImage = previewMimeType.startsWith("image/")
    const isPdf = previewMimeType === "application/pdf"

    const loadingOverlay = isLoading && (
      <div className="absolute inset-0 bg-background/80 dark:bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-md">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
        <p className="text-lg font-medium text-foreground dark:text-gray-300">Processing document...</p>
      </div>
    )

    if (isImage) {
      return (
        <div className="relative w-full h-full flex items-center justify-center" ref={containerRef}>
          {loadingOverlay}
          <img
            ref={imageRef}
            src={previewUrl || "/placeholder.svg"}
            alt="Document Preview"
            className={cn("max-w-full max-h-full object-contain", isLoading && "opacity-50")}
            onLoad={handleImageLoad}
          />
          {showBboxes && ocrResult && imageSize && !isLoading && (
            <div className="absolute inset-0 pointer-events-none">
              {ocrResult.chunks.map((chunk) => {
                if (!chunk.grounding || chunk.grounding.length === 0) return null
                return chunk.grounding.map((ground, idx) => {
                  const position = calculateBboxPosition(ground.box, ground.page || 0)
                  if (!position) return null
                  const isHovered = hoveredChunk === chunk.chunk_id
                  const isSelected = selectedChunk === chunk.chunk_id
                  return (
                    <div
                      key={`${chunk.chunk_id}-${idx}`}
                      className={cn(
                        "absolute border-2 transition-all duration-200 pointer-events-auto cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/20 z-20"
                          : isHovered
                            ? "border-yellow-500 bg-yellow-500/20 z-10"
                            : "border-green-500 bg-green-500/10 hover:bg-green-500/20",
                      )}
                      style={{
                        left: `${position.left}px`,
                        top: `${position.top}px`,
                        width: `${position.width}px`,
                        height: `${position.height}px`,
                      }}
                      onMouseEnter={() => setHoveredChunk(chunk.chunk_id)}
                      onMouseLeave={() => setHoveredChunk(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedChunk(chunk.chunk_id)
                        scrollToChunk(chunk.chunk_id)
                      }}
                      title={chunk.text.substring(0, 100) + (chunk.text.length > 100 ? "..." : "")}
                    />
                  )
                })
              })}
            </div>
          )}
        </div>
      )
    }

    if (isPdf && file) {
      return (
        <div className="relative w-full h-full flex items-center justify-center" ref={containerRef}>
          {loadingOverlay}
          <div className={cn("w-full h-full", isLoading && "opacity-50")}>
            <PDFViewer
              ref={pdfViewerRef}
              file={file}
              onPagesConverted={handlePagesConverted}
              onPageChange={setCurrentPage}
              onImageLoad={handlePdfImageLoad}
              currentPage={currentPage}
            />
          </div>
          {showBboxes && ocrResult && imageSize && pdfPages.length > 0 && !isLoading && (
            <div className="absolute inset-0 pointer-events-none">
              {ocrResult.chunks.map((chunk) => {
                if (!chunk.grounding || chunk.grounding.length === 0) return null
                return chunk.grounding.map((ground, idx) => {
                  const groundPage = ground.page === undefined ? 0 : ground.page
                  if (groundPage !== currentPage) return null
                  const position = calculateBboxPosition(ground.box, groundPage)
                  if (!position) return null
                  const isHovered = hoveredChunk === chunk.chunk_id
                  const isSelected = selectedChunk === chunk.chunk_id
                  return (
                    <div
                      key={`${chunk.chunk_id}-${idx}`}
                      className={cn(
                        "absolute border-2 transition-all duration-200 pointer-events-auto cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/20 z-20"
                          : isHovered
                            ? "border-yellow-500 bg-yellow-500/20 z-10"
                            : "border-green-500 bg-green-500/10 hover:bg-green-500/20",
                      )}
                      style={{
                        left: `${position.left}px`,
                        top: `${position.top}px`,
                        width: `${position.width}px`,
                        height: `${position.height}px`,
                      }}
                      onMouseEnter={() => setHoveredChunk(chunk.chunk_id)}
                      onMouseLeave={() => setHoveredChunk(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedChunk(chunk.chunk_id)
                        scrollToChunk(chunk.chunk_id)
                      }}
                      title={chunk.text.substring(0, 100) + (chunk.text.length > 100 ? "..." : "")}
                    />
                  )
                })
              })}
            </div>
          )}
        </div>
      )
    }

    if (file) {
      return (
        <div className="text-center text-gray-500 dark:text-gray-400 p-4">
          <FileType size={48} className="mx-auto mb-2 text-gray-400 dark:text-gray-500" />
          <p>Unsupported file type for preview: {file.name}</p>
          <p className="text-sm">Try images (JPEG, PNG) or PDF files.</p>
        </div>
      )
    }

    return noFileSelectedContent
  }

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950">
      <style jsx global>{`
        .highlight-chunk {
          background-color: rgba(var(--color-primary-rgb), 0.1);
          transition: background-color 0.3s ease;
        }
        :root {
          --color-primary-rgb: 30, 58, 138;
        }
        .dark {
          --color-primary-rgb: 96, 165, 250;
        }
      `}</style>
      <header className="bg-background dark:bg-gray-900 shadow-sm p-4 flex justify-between items-center border-b dark:border-gray-800">
        <h1 className="text-xl font-semibold text-foreground dark:text-gray-100">Document OCR</h1>
        <div className="flex items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            id="fileInput"
            className="hidden"
            onChange={handleFileSelected}
            accept="image/*,.pdf"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {file ? "Change File" : "Upload File"}
          </Button>
          <Button onClick={handleParseDocument} disabled={isLoading || !file}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Parse Document
          </Button>
          {ocrResult && (previewMimeType?.startsWith("image/") || pdfPages.length > 0) && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowBboxes(!showBboxes)}
              title={showBboxes ? "Hide bounding boxes" : "Show bounding boxes"}
            >
              {showBboxes ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" disabled>
            <Share2 className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <main className="flex-grow flex p-4 gap-4 overflow-hidden">
        <Card className="w-1/2 flex flex-col bg-background dark:bg-gray-900 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between py-2 px-4 border-b dark:border-gray-800">
            <CardTitle className="text-lg text-foreground dark:text-gray-100">
              {file ? file.name : "Document Preview"}
            </CardTitle>
            <div className="flex items-center space-x-1 text-sm text-muted-foreground dark:text-gray-400">
              <Button
                variant="ghost"
                size="icon"
                disabled={currentPage === 0 || totalPages === 0 || !file || !previewMimeType?.includes("pdf")}
                onClick={() => handlePageChange(currentPage - 1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span>
                {totalPages > 0 && file && previewMimeType?.includes("pdf")
                  ? `${currentPage + 1} / ${totalPages}`
                  : "- / -"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                disabled={
                  currentPage === totalPages - 1 || totalPages === 0 || !file || !previewMimeType?.includes("pdf")
                }
                onClick={() => handlePageChange(currentPage + 1)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-grow p-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800/30 overflow-hidden relative">
            {renderPreview()}
          </CardContent>
        </Card>
        <Card className="w-1/2 flex flex-col bg-background dark:bg-gray-900 shadow-lg">
          <Tabs defaultValue="markdown" className="w-full" onValueChange={setActiveTab} value={activeTab}>
            <CardHeader className="py-2 px-4 border-b dark:border-gray-800">
              <div className="flex justify-between items-center">
                <TabsList>
                  <TabsTrigger value="markdown">Markdown</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                  <TabsTrigger value="table">Table</TabsTrigger>
                </TabsList>
                <div className="flex items-center space-x-1">
                  {activeTab !== "table" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(activeTab as "markdown" | "json")}
                        disabled={!ocrResult || isLoading}
                      >
                        <Download className="h-5 w-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(activeTab as "markdown" | "json")}
                        disabled={!ocrResult || isLoading}
                      >
                        <Copy className="h-5 w-5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <TabsContent value="markdown" className="mt-0">
              <ScrollArea className="relative h-[calc(100vh-180px)] p-1 border-t-0 rounded-t-none border dark:border-gray-700 rounded-md bg-background dark:bg-gray-800/50">
                {isLoading && !ocrResult && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
                      <p className="text-lg text-foreground dark:text-gray-300">Processing document...</p>
                    </div>
                  </div>
                )}
                {error && !isLoading && (
                  <Alert variant="destructive" className="m-4">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {ocrResult && !isLoading && !error && (
                  <div className="prose prose-sm dark:prose-invert max-w-none p-4">
                    {ocrResult.chunks.map((chunk) => (
                      <div
                        key={chunk.chunk_id}
                        id={`chunk-${chunk.chunk_id}`}
                        className={cn(
                          "mb-4 p-2 rounded transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700/50",
                          hoveredChunk === chunk.chunk_id && "bg-yellow-100 dark:bg-yellow-700/30",
                          selectedChunk === chunk.chunk_id && "bg-blue-100 dark:bg-blue-700/30 ring-2 ring-primary",
                        )}
                        onMouseEnter={() => setHoveredChunk(chunk.chunk_id)}
                        onMouseLeave={() => setHoveredChunk(null)}
                        onClick={() => {
                          setSelectedChunk(chunk.chunk_id === selectedChunk ? null : chunk.chunk_id)
                          if (
                            chunk.grounding &&
                            chunk.grounding[0]?.page !== undefined &&
                            chunk.grounding[0].page !== currentPage
                          ) {
                            handlePageChange(chunk.grounding[0].page)
                          }
                        }}
                      >
                        <div className="text-xs text-muted-foreground dark:text-gray-400 mb-1">
                          {chunk.chunk_type}
                          {chunk.grounding && chunk.grounding[0]?.page !== undefined && (
                            <span className="ml-2">• Page {(chunk.grounding[0].page || 0) + 1}</span>
                          )}
                        </div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                          components={{
                            table: ({ children, ...props }) => (
                              <div className="w-full overflow-x-auto my-4 border border-gray-300 dark:border-gray-600 rounded">
                                <table
                                  className="w-full border-collapse text-sm"
                                  style={{ tableLayout: "auto", minWidth: "max-content" }}
                                  {...props}
                                >
                                  {children}
                                </table>
                              </div>
                            ),
                          }}
                        >
                          {chunk.text}
                        </ReactMarkdown>
                      </div>
                    ))}
                  </div>
                )}
                {!ocrResult && !isLoading && !error && (
                  <div className="p-4 text-center text-muted-foreground dark:text-gray-500">
                    No results to display. Parse a document to see the output.
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="json" className="mt-0">
              <ScrollArea className="relative h-[calc(100vh-180px)] p-1 border-t-0 rounded-t-none border dark:border-gray-700 rounded-md bg-background dark:bg-gray-800/50">
                {ocrResult && !isLoading && !error && (
                  <pre className="p-4 text-sm whitespace-pre-wrap break-all text-foreground dark:text-gray-200">
                    {JSON.stringify(ocrResult.chunks, null, 2)}
                  </pre>
                )}
                {!ocrResult && !isLoading && !error && (
                  <div className="p-4 text-center text-muted-foreground dark:text-gray-500">
                    No results to display. Parse a document to see the output.
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="table" className="mt-0 h-[calc(100vh-180px)]">
              <TableExtractionTab
                ocrResult={ocrResult}
                file={file}
                imagePreviewUrl={previewMimeType?.startsWith("image/") ? previewUrl : null}
                pdfPagePreviewUrl={
                  previewMimeType === "application/pdf" && pdfPages[currentPage] ? pdfPages[currentPage] : null
                }
              />
            </TabsContent>
          </Tabs>
        </Card>
      </main>
    </div>
  )
}
