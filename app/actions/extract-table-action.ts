"use server"

interface FormState {
  success: boolean
  data: Record<string, any>[] | null
  error: string | null
}

interface SchemaFieldDef {
  name: string
  type: string
  description?: string
}

function parseMarkdownSchema(markdown: string): SchemaFieldDef[] {
  const lines = markdown.trim().split("\n")
  const fields: SchemaFieldDef[] = []

  for (const line of lines) {
    const match = line.match(/^-\s+\*\*([^*]+)\*\*\s+\(([^)]+)\)(?:\s+"([^"]*)")?/)
    if (match) {
      fields.push({
        name: match[1].trim(),
        type: match[2].trim(),
        description: match[3]?.trim() || undefined,
      })
    }
  }

  return fields
}

export async function extractTableData(prevState: FormState, formData: FormData): Promise<FormState> {
  const backendUrl = process.env.OCR_BACKEND_URL?.replace("/predict", "") ?? "http://localhost:8000"

  const schema = formData.get("schema") as string
  const fileData = formData.get("fileData") as string
  const filename = formData.get("filename") as string

  if (!schema || !fileData) {
    return { success: false, data: null, error: "Missing required data: schema or file." }
  }

  const schemaFields = parseMarkdownSchema(schema)
  if (schemaFields.length === 0) {
    return { success: false, data: null, error: "No valid schema fields found. Please define at least one field." }
  }

  try {
    const response = await fetch(`${backendUrl}/extract-table`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_data: fileData,
        filename: filename || "document.pdf",
        schema_fields: schemaFields,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { success: false, data: null, error: `Backend error (${response.status}): ${text}` }
    }

    const result = await response.json()

    if (!result.success) {
      return { success: false, data: null, error: result.error || "Extraction failed." }
    }

    if (!result.data || result.data.length === 0) {
      return {
        success: false,
        data: null,
        error: "The document extraction returned no data. Try adjusting your schema fields.",
      }
    }

    return { success: true, data: result.data, error: null }
  } catch (error: any) {
    console.error("Error extracting table data:", error)
    return {
      success: false,
      data: null,
      error: error.message || "Failed to connect to the extraction backend.",
    }
  }
}
