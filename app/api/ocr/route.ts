import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer()
    const base64File = Buffer.from(arrayBuffer).toString("base64")

    // Get backend URL from environment or use default
    const backendUrl = process.env.OCR_BACKEND_URL || "url"
    console.log(backendUrl)

    // Prepare request for LitServe backend
    const requestData = {
      file_data: base64File,
      filename: file.name,
    }

    console.log(`Making request to backend: ${backendUrl}`)
    console.log(`File: ${file.name}, Size: ${file.size} bytes`)

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No authorization headers needed for our own backend
      },
      body: JSON.stringify(requestData),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Backend Error Response:", errorText)

      // Try to parse as JSON
      try {
        const errorJson = JSON.parse(errorText)
        return NextResponse.json(
          {
            error: errorJson.error || `Backend request failed`,
            details: errorJson.details || errorText,
          },
          { status: response.status },
        )
      } catch {
        return NextResponse.json(
          {
            error: `Backend request failed with status ${response.status}`,
            details: errorText,
          },
          { status: response.status },
        )
      }
    }

    const data = await response.json()

    if (!data.success) {
      return NextResponse.json(
        {
          error: data.error || "Backend processing failed",
          details: data,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("OCR API Error:", error)

    // Check if it's a connection error
    if (error instanceof Error && error.message.includes("fetch failed")) {
      return NextResponse.json(
        {
          error: "Cannot connect to OCR backend",
          details: "Make sure the LitServe backend is running on port 8000",
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        error: "Failed to process document",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
