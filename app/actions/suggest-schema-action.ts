"use server"

import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import type { Chunk } from "@/app/page"

function cleanChunks(data: Chunk[]): { chunk_type: string; text: string }[] {
  return data.map((item) => ({
    chunk_type: item.chunk_type,
    text: item.text,
  }))
}

// Define the schema for a single field
const fieldSchema = z.object({
  name: z.string().describe("The field name in snake_case, e.g., 'invoice_total' or 'item_description'."),
  type: z
    .enum(["string", "integer", "float", "date"])
    .describe("The data type of the field. Must be one of 'string', 'integer', 'float', 'date'."),
  description: z.string().describe("A brief, helpful description of what the field represents."),
})

// Define the root schema as an object containing an array of fields
const schemaSuggestionRootSchema = z.object({
  suggestedFields: z.array(fieldSchema).describe("An array of suggested schema fields for the document."),
})

export async function suggestSchemaAction(chunksString: string, imageBase64: string | null) {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: "OpenAI API key is not configured on the server." }
  }

  if (!chunksString) {
    return { success: false, error: "Missing OCR chunk data." }
  }

  try {
    const chunks = JSON.parse(chunksString) as Chunk[]
    const proprocessData = JSON.stringify(cleanChunks(chunks), null, 2)

    const systemPrompt = `You are an expert data analyst. Your task is to analyze the provided OCR text and document image to suggest a structured data schema for extracting information.
Identify all key fields, including header information, line items, and summary totals.
Return your response as a JSON object. This object must have a single key 'suggestedFields', which contains an array of field objects.
Each field object MUST have the following keys:
- 'name' (string, in snake_case, e.g., 'invoice_total', 'item_description').
- 'type' (string, STRICTLY one of: 'string', 'integer', 'float', 'date'). You MUST NOT use 'array' or any other types for the 'type' field.
- 'description' (string, a brief explanation of the field).

VERY IMPORTANT: For fields representing lists, repeating items, or tables (like line items in an invoice or entries in a log), do NOT use 'array' as a type.
Instead, you MUST suggest individual, flat fields for each distinct piece of information that would typically form a column in such a table.
For example, if an invoice has line items, instead of one 'items' field of type 'array', you should suggest separate fields like:
  - 'item_description' (type: string, description: "Description of the product or service")
  - 'item_quantity' (type: integer, description: "Quantity of the item")
  - 'item_unit_price' (type: float, description: "Price per unit of the item")
  - 'item_total_amount' (type: float, description: "Total amount for the line item (quantity * unit price)")
These fields will represent the columns for the line items. The extraction process will handle creating multiple rows.

Ensure your entire response is a single JSON object strictly conforming to this structure and these rules. Do not include any other text, explanations, or markdown formatting outside the JSON object.
The 'type' property for every field in 'suggestedFields' must be one of 'string', 'integer', 'float', or 'date'.`

    const userPrompt = `
--- OCR JSON START ---
${proprocessData}
--- OCR JSON END ---

Based on the OCR data and the document image, suggest a schema following all the rules above. Remember, no 'array' types.`

    const messages: any = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [{ type: "text", text: userPrompt }],
      },
    ]

    if (imageBase64) {
      messages[1].content.push({ type: "image", image: Buffer.from(imageBase64, "base64") })
    }

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: schemaSuggestionRootSchema,
      messages: messages,
      maxTokens: 2500, // Increased maxTokens further
      temperature: 0.05, // Lowered temperature for stricter adherence
    })

    return { success: true, data: object.suggestedFields }
  } catch (error: any) {
    console.error("Error suggesting schema:", error) // Full error object for server logs

    let errorMessage = "An unknown error occurred while suggesting the schema."
    if (error.message) {
      errorMessage = error.message
    }

    // Check if it's an AI SDK error and try to extract more details
    // The structure of AI SDK errors can vary, so we check for common properties.
    if (error.name?.includes("AIError") || error.constructor?.name?.includes("AIError")) {
      const aiError = error as any // Cast to any to access potential properties
      errorMessage = `AI SDK Error: ${aiError.message || "No message"}`
      if (aiError.type) errorMessage += ` (Type: ${aiError.type})`
      if (aiError.code) errorMessage += ` (Code: ${aiError.code})`

      // Attempt to get underlying Zod validation error if present in cause
      let cause = aiError.cause
      while (cause) {
        if (cause.constructor?.name === "ZodError") {
          const zodError = cause as z.ZodError
          const zodIssues = zodError.errors
            .map((e) => `${e.path.join(".")} - ${e.message} (received: ${JSON.stringify((e as any).received)})`)
            .join("; ")
          errorMessage += `\nUnderlying Zod validation issue: ${zodIssues}`
          break
        }
        cause = cause.cause
      }

      if (aiError.text) {
        // If raw text from AI is available in the error
        errorMessage += `\nAI Raw Response Text (first 500 chars): ${String(aiError.text).substring(0, 500)}...`
      }
    } else if (error instanceof z.ZodError) {
      // This case might not be hit if generateObject wraps ZodErrors in AIError
      const zodIssues = error.errors
        .map((e) => `${e.path.join(".")} - ${e.message} (received: ${JSON.stringify((e as any).received)})`)
        .join("; ")
      errorMessage = `Zod validation error directly caught: ${zodIssues}`
    }

    return { success: false, error: errorMessage }
  }
}
