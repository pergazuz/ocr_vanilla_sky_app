"use client"

import type React from "react"
import { useState, useEffect, useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Wand2, XCircle, Download, Copy, PlusCircle, Trash2, BookOpen } from "lucide-react"
import type { Chunk } from "@/app/page"
import { extractTableData } from "@/app/actions/extract-table-action"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface TableExtractionTabProps {
  ocrResult: { chunks: Chunk[] } | null
  file: File | null
  imagePreviewUrl: string | null
  pdfPagePreviewUrl: string | null
}

interface SchemaField {
  id: string
  name: string
  type: "string" | "integer" | "float" | "date"
  description?: string
}

interface SchemaTemplate {
  name: string
  fields: Omit<SchemaField, "id">[]
}

const schemaTemplates: SchemaTemplate[] = [
  {
    name: "Standard Invoice",
    fields: [
      { name: "invoice_id", type: "string", description: "The unique identifier for the invoice" },
      { name: "issue_date", type: "date", description: "The date the invoice was issued" },
      { name: "due_date", type: "date", description: "The date the payment is due" },
      { name: "seller_name", type: "string" },
      { name: "seller_address", type: "string" },
      { name: "buyer_name", type: "string" },
      { name: "buyer_address", type: "string" },
      { name: "item_description", type: "string", description: "The description of a line item" },
      { name: "quantity", type: "integer" },
      { name: "unit_price", type: "float" },
      { name: "line_total", type: "float" },
      { name: "subtotal", type: "float", description: "The total amount before taxes" },
      { name: "tax_amount", type: "float" },
      { name: "grand_total", type: "float", description: "The final amount to be paid" },
    ],
  },
  {
    name: "Simple Receipt",
    fields: [
      { name: "store_name", type: "string" },
      { name: "store_address", type: "string" },
      { name: "transaction_date", type: "date" },
      { name: "transaction_time", type: "string" },
      { name: "item_name", type: "string" },
      { name: "price", type: "float" },
      { name: "total_amount", type: "float" },
      { name: "tax", type: "float" },
      { name: "payment_method", type: "string" },
    ],
  },
]

const actionInitialState = {
  success: false,
  data: null,
  error: null,
}

function generateMarkdownFromSchemaFields(fields: SchemaField[]): string {
  return fields
    .map((field) => {
      let line = `- **${field.name}** (${field.type})`
      if (field.description) {
        line += ` "${field.description}"`
      }
      return line
    })
    .join("\n")
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Extracting...
        </>
      ) : (
        <>
          <Wand2 className="mr-2 h-4 w-4" />
          Extract Table Data
        </>
      )}
    </Button>
  )
}

function ExtractionFormContent({
  ocrResult,
  file,
  imageBase64,
}: {
  ocrResult: { chunks: Chunk[] }
  file: File | null
  imageBase64: string | null
}) {
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([])
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string>("")
  const [fileBase64, setFileBase64] = useState<string>("")
  const { toast } = useToast()

  const [formState, formAction, isActionPending] = useActionState(extractTableData, actionInitialState)

  useEffect(() => {
    if (!file) {
      setFileBase64("")
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      setFileBase64(result.split(",")[1] ?? "")
    }
    reader.readAsDataURL(file)
  }, [file])

  useEffect(() => {
    setGeneratedMarkdown(generateMarkdownFromSchemaFields(schemaFields))
  }, [schemaFields])

  const tableData = formState.success ? formState.data : null
  const tableHeaders = tableData && tableData.length > 0 ? Object.keys(tableData[0]) : []

  const handleAddField = () => {
    setSchemaFields([...schemaFields, { id: crypto.randomUUID(), name: "", type: "string", description: "" }])
  }

  const handleFieldChange = (id: string, property: keyof SchemaField, value: string) => {
    setSchemaFields(schemaFields.map((field) => (field.id === id ? { ...field, [property]: value } : field)))
  }

  const handleDeleteField = (id: string) => {
    setSchemaFields(schemaFields.filter((field) => field.id !== id))
  }

  const handleSelectTemplate = (template: SchemaTemplate) => {
    const newFields = template.fields.map((field) => ({ ...field, id: crypto.randomUUID() }))
    setSchemaFields(newFields)
    toast({ title: "Template Loaded", description: `The "${template.name}" template has been loaded.` })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault()
  }

  const handleDownloadCsv = () => {
    if (!tableData) return
    const headers = Object.keys(tableData[0]).join(",")
    const rows = tableData.map((row) =>
      Object.values(row)
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    )
    const csvContent = [headers, ...rows].join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${file?.name.split(".")[0] || "extraction"}_table.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast({ title: "Downloaded", description: "Table data downloaded as CSV." })
  }

  const handleCopyTsv = async () => {
    if (!tableData) return
    const headers = Object.keys(tableData[0]).join("\t")
    const rows = tableData.map((row) => Object.values(row).join("\t"))
    const tsvContent = [headers, ...rows].join("\n")
    try {
      await navigator.clipboard.writeText(tsvContent)
      toast({ title: "Copied", description: "Table data copied to clipboard (TSV)." })
    } catch (err) {
      toast({ title: "Copy Failed", variant: "destructive" })
    }
  }

  return (
    <form action={formAction} className="flex flex-col h-full">
      <div className="p-4 border-b dark:border-gray-800 space-y-4 flex-shrink-0">
        <input type="hidden" name="fileData" value={fileBase64} />
        <input type="hidden" name="filename" value={file?.name ?? "document.pdf"} />
        <input type="hidden" name="schema" value={generatedMarkdown} />
        <div>
          <div className="flex justify-between items-center mb-2">
            <Label className="text-sm font-medium">Extraction Schema</Label>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={isActionPending} className="flex items-center gap-1">
                    <BookOpen className="mr-2 h-4 w-4" /> Templates
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Select a Template</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {schemaTemplates.map((template) => (
                    <DropdownMenuItem key={template.name} onSelect={() => handleSelectTemplate(template)}>
                      {template.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSchemaFields([])} className="text-destructive">
                    Clear All Fields
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button type="button" variant="outline" size="sm" onClick={handleAddField} disabled={isActionPending}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Field
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Define the columns you want to extract.</p>
          <ScrollArea className="h-48 border rounded-md p-2 space-y-2 bg-muted/30 dark:bg-muted/20">
            {schemaFields.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No fields defined. Click "Add Field" or select a template.
              </p>
            )}
            {schemaFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center gap-2 p-2 bg-background dark:bg-gray-800 rounded-md shadow-sm"
              >
                <Input
                  type="text"
                  placeholder="Field Name (e.g., invoice_number)"
                  value={field.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleFieldChange(field.id, "name", e.target.value)
                  }
                  onKeyDown={handleKeyDown}
                  className="flex-grow"
                  disabled={isActionPending}
                />
                <Select
                  value={field.type}
                  onValueChange={(value: SchemaField["type"]) => handleFieldChange(field.id, "type", value)}
                  disabled={isActionPending}
                >
                  <SelectTrigger className="w-[120px] flex-shrink-0">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="integer">Integer</SelectItem>
                    <SelectItem value="float">Float</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  placeholder="Description (optional)"
                  value={field.description || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleFieldChange(field.id, "description", e.target.value)
                  }
                  onKeyDown={handleKeyDown}
                  className="flex-grow"
                  disabled={isActionPending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteField(field.id)}
                  className="text-destructive hover:text-destructive/80 flex-shrink-0"
                  disabled={isActionPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </ScrollArea>
        </div>
        <SubmitButton />
      </div>

      <div className="flex-grow overflow-y-auto">
        {isActionPending && (
          <div className="p-4 flex flex-col items-center justify-center h-full">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
            <p className="text-lg text-foreground dark:text-gray-300">Extracting and loading table...</p>
          </div>
        )}
        {!isActionPending && formState.error && (
          <div className="p-4">
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Extraction Failed</AlertTitle>
              <AlertDescription>{formState.error}</AlertDescription>
            </Alert>
          </div>
        )}
        {!isActionPending &&
          formState.success &&
          (tableData && tableData.length > 0 ? (
            <div className="p-4">
              <div className="flex justify-end gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Download CSV
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopyTsv}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy TSV
                </Button>
              </div>
              <div className="w-full overflow-x-auto border border-border dark:border-border rounded-lg shadow-md bg-card">
                <Table className="min-w-full">
                  <TableHeader className="bg-muted/50 dark:bg-muted/80">
                    <TableRow>
                      {tableHeaders.map((header) => (
                        <TableHead
                          key={header}
                          className="whitespace-nowrap px-4 py-3 text-left text-sm font-semibold text-foreground dark:text-gray-200"
                        >
                          {header.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, rowIndex) => (
                      <TableRow
                        key={rowIndex}
                        className={cn(
                          "transition-colors",
                          "even:bg-muted/20 dark:even:bg-muted/40",
                          "hover:bg-muted/40 dark:hover:bg-muted/60",
                        )}
                      >
                        {tableHeaders.map((header) => (
                          <TableCell
                            key={`${rowIndex}-${header}`}
                            className="whitespace-nowrap px-4 py-3 text-sm text-foreground dark:text-gray-300"
                          >
                            {String(row[header])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-muted-foreground h-full flex items-center justify-center">
              Extraction successful, but no data matching the schema was found or the extracted table is empty.
            </div>
          ))}
        {!isActionPending && !formState.success && !formState.error && (
          <div className="p-4 text-center text-muted-foreground h-full flex items-center justify-center">
            Define your schema and click "Extract Table Data" to see results.
          </div>
        )}
      </div>
    </form>
  )
}

export function TableExtractionTab({ ocrResult, file, imagePreviewUrl, pdfPagePreviewUrl }: TableExtractionTabProps) {
  const [imageBase64, setImageBase64] = useState<string | null>(null)

  useEffect(() => {
    const urlToConvert = imagePreviewUrl || pdfPagePreviewUrl
    if (!urlToConvert) {
      setImageBase64(null)
      return
    }
    if (urlToConvert.startsWith("data:")) {
      setImageBase64(urlToConvert.split(",")[1])
      return
    }
    const convertUrlToBase64 = async () => {
      try {
        const response = await fetch(urlToConvert!)
        const blob = await response.blob()
        const reader = new FileReader()
        reader.onloadend = () => {
          setImageBase64((reader.result as string).split(",")[1])
        }
        reader.readAsDataURL(blob)
      } catch (error) {
        console.error("Error converting image to base64:", error)
        setImageBase64(null)
      }
    }
    convertUrlToBase64()
  }, [imagePreviewUrl, pdfPagePreviewUrl])

  if (!ocrResult) {
    return (
      <div className="p-4 text-center text-muted-foreground h-full flex items-center justify-center">
        Parse a document first to enable table extraction.
      </div>
    )
  }

  return <ExtractionFormContent ocrResult={ocrResult} file={file} imageBase64={imageBase64} />
}
