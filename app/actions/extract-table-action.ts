"use server"

import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import type { Chunk } from "@/app/page"

interface FormState {
  success: boolean
  data: Record<string, any>[] | null
  error: string | null
}

function cleanChunks(data: Chunk[]): { chunk_type: string; text: string }[] {
  return data.map((item) => ({
    chunk_type: item.chunk_type,
    text: item.text,
  }))
}

function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split("\n")
  if (lines.length < 2) return []

  const headers = lines[0].split(",").map((h) => h.trim().replace(/["']/g, ""))

  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""))
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      row[header] = values[i] !== undefined ? values[i] : "-" // Ensure value exists
    })
    return row
  })
  return rows
}

export async function extractTableData(prevState: FormState, formData: FormData): Promise<FormState> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in environment variables.")
    return {
      success: false,
      data: null,
      error:
        "OpenAI API key is not configured on the server. Please set the OPENAI_API_KEY environment variable in your Vercel project settings.",
    }
  }

  const schema = formData.get("schema") as string
  const chunksString = formData.get("chunks") as string
  const imageBase64 = formData.get("imageBase64") as string

  if (!schema || !chunksString) {
    // imageBase64 can be empty if no preview
    return { success: false, data: null, error: "Missing required data: schema or chunks." }
  }

  if (!imageBase64) {
    console.warn(
      "Image base64 string is empty. Proceeding without image context for AI if model supports it, but this is not ideal for OCR extraction.",
    )
    // Depending on the model, you might want to return an error here or adjust the prompt.
    // For now, we'll let it proceed, but the AI might not perform well.
  }

  try {
    const chunks = JSON.parse(chunksString) as Chunk[]
    const cleanedData = cleanChunks(chunks)
    const proprocessData = JSON.stringify(cleanedData, null, 2)

    const botInstructionText = "You are a data-extraction assistant."
    const taskText = `
TASK  
1. Read the raw OCR JSON (an array of chunks, each with chunk_type and text).
2. Locate and extract these header, footer and line-item fields based on the provided schema:
`
    const rulesText = `
- Split each table row into its own CSV row, repeating all header/footer/summary fields on every row.
- Remove thousands separators (commas) and convert all numeric strings to numbers where appropriate for the schema type (e.g. float, integer).
- If any field is missing or blank based on the OCR content, output a single dash (-) for that field in the CSV.
- Preserve all Thai text exactly as in the OCR.
- Return only the CSV text, with a header row matching the column names derived from the schema. Do not include any other text, explanations, or markdown formatting.
- Ensure the CSV output is clean and strictly follows the CSV format. Each field should be a simple value.
`
    const ocrJsonText = `
--- OCR JSON START ---
${proprocessData}
--- OCR JSON END ---
`
    const promptText = botInstructionText + taskText + schema + rulesText + ocrJsonText

    const messages: any = [
      {
        role: "user",
        content: [{ type: "text", text: promptText }],
      },
    ]

    if (imageBase64) {
      messages[0].content.push({ type: "image", image: Buffer.from(imageBase64, "base64") })
    }

    const { text } = await generateText({
      model: openai("gpt-4o-mini"), // Ensure your API key supports this model
      messages: messages,
      temperature: 0.1, // Lower temperature for more deterministic output
    })

    if (!text || text.trim() === "") {
      return {
        success: false,
        data: null,
        error:
          "The AI returned an empty response. The document might not contain the requested information or the schema might be too restrictive.",
      }
    }

    const parsedData = parseCsv(text)

    if (parsedData.length === 0 && text.trim() !== "-") {
      // Allow single dash as valid empty data
      console.warn("CSV parsing resulted in empty data. Raw AI response:", text)
      return {
        success: false,
        data: null,
        error:
          "Failed to parse the CSV response from the AI. The response might be malformed or not in the expected CSV format. Raw response: " +
          text.substring(0, 200) +
          "...",
      }
    }

    return { success: true, data: parsedData, error: null }
  } catch (error: any) {
    console.error("Error extracting table data:", error) // Server-side log
    let errorMessage = "An unknown error occurred during table extraction."
    if (error.message) {
      errorMessage = error.message
    }
    // Check for specific OpenAI API error structures if available
    if (error.status === 401) {
      errorMessage = "OpenAI API authentication failed. Please check your API key."
    } else if (error.status === 429) {
      errorMessage = "OpenAI API rate limit exceeded. Please try again later."
    } else if (error.name === "AIError") {
      // From Vercel AI SDK
      errorMessage = `AI SDK Error: ${error.message} (Type: ${error.type}, Code: ${error.code})`
    }

    return { success: false, data: null, error: errorMessage }
  }
}
